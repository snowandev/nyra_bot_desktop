//! Programs the model writes and runs once the user approves them. Each conversation has a folder of its own in the
//! app's cache, with the files attached to it: the programs are saved and run there (or in the connected folder),
//! and what they create stays there for the user to see or save.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::i18n::{t, t_with};
use crate::storage::now_millis;
use crate::util::{conversation_file_name, to_message, where_to_save};

const RUNS_DIR: &str = "code-runs";
// The files a conversation hands its programs, and the largest file a program's result can be shown from
const MAX_INPUT_BYTES: usize = 50 * 1024 * 1024;
const MAX_SHOWN_BYTES: u64 = 10 * 1024 * 1024;
const MAX_LISTED_FILES: usize = 200;
// How far the folder is walked to find them: a program could leave a huge tree
const MAX_WALKED_FILES: usize = 5000;
// Looking for the interpreters goes through the user's shell, which may take a moment to start
const RUNTIMES_TIMEOUT: Duration = Duration::from_secs(8);
const RUNTIMES_FRESH: Duration = Duration::from_secs(60);
// A conversation's folder left untouched this long is cleared when Nyra starts
const STALE_AFTER: Duration = Duration::from_secs(30 * 24 * 60 * 60);
// Python packages for charts, tables and documents: the model is told which are installed and which not, so it
// doesn't guess. Python prints them after a mark, apart from what a shell's startup may print.
const PACKAGES: [&str; 9] = [
    "numpy",
    "pandas",
    "matplotlib",
    "openpyxl",
    "PIL",
    "scipy",
    "docx",
    "pypdf",
    "reportlab",
];
const PACKAGES_MARK: &str = "nyra-packages:";
const PACKAGES_PROBE: &str =
    "import importlib.util as u,sys;print('nyra-packages:'+','.join(m for m in sys.argv[1:] \
if u.find_spec(m)))";

/// The interpreters found on this computer, by language, as each is started from a terminal
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Runtimes {
    python: Option<String>,
    javascript: Option<String>,
    // Of PACKAGES, those Python can import and those it can't; both empty when it couldn't be asked
    packages: Vec<String>,
    missing_packages: Vec<String>,
}

type RuntimesCache = Arc<Mutex<Option<(Instant, Runtimes)>>>;

#[derive(Default)]
pub struct CodeRuns {
    runtimes: RuntimesCache,
}

#[derive(Deserialize)]
pub struct InputFile {
    name: String,
    // Base64, so any kind of file survives the trip from the WebView
    data: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeFile {
    path: String,
    size: u64,
    modified: u64,
}

fn runs_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(to_message)?
        .join(RUNS_DIR))
}

/// The conversation's folder name
fn valid_conversation(id: &str) -> Result<String, String> {
    conversation_file_name(id).ok_or_else(|| t("native.code.invalidConversation"))
}

fn space_of(app: &AppHandle, conversation: &str) -> Result<PathBuf, String> {
    let name = valid_conversation(conversation)?;
    let dir = runs_root(app)?.join(name);
    fs::create_dir_all(&dir).map_err(to_message)?;
    Ok(dir)
}

/// Whether a folder is one of the conversations' own, where their programs may run
pub fn is_space(app: &AppHandle, path: &Path) -> bool {
    let (Ok(root), Ok(path)) = (runs_root(app), path.canonicalize()) else {
        return false;
    };
    root.canonicalize()
        .is_ok_and(|root| path.starts_with(&root) && path != root)
}

/// A path inside a conversation's folder, relative and without "..", so nothing reaches outside it
fn inside(dir: &Path, path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(path);
    let plain = !path.is_empty()
        && !relative.is_absolute()
        && relative
            .components()
            .all(|c| matches!(c, Component::Normal(_)));
    plain
        .then(|| dir.join(relative))
        .ok_or_else(|| t("native.code.invalidPath"))
}

/// Only the name of an attached file, whatever path it came with
fn input_name(name: &str) -> Option<String> {
    let base = name.rsplit(['/', '\\']).next()?.trim();
    (!base.is_empty() && base != "." && base != "..").then(|| base.to_string())
}

/// The conversation's folder, with its attached files written in by their names; resolves with its path
#[tauri::command]
pub async fn code_space(
    app: AppHandle,
    conversation_id: String,
    inputs: Vec<InputFile>,
) -> Result<String, String> {
    let dir = space_of(&app, &conversation_id)?;
    // Up to tens of megabytes decoded and written: off the async threads
    crate::workspace::blocking(move || write_inputs(dir, inputs)).await?
}

fn write_inputs(dir: PathBuf, inputs: Vec<InputFile>) -> Result<String, String> {
    use base64::Engine;
    let mut total = 0;
    for input in inputs {
        let Some(name) = input_name(&input.name) else {
            continue;
        };
        // One file that can't be read or written leaves the rest, so the programs still run
        let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(&input.data) else {
            continue;
        };
        total += bytes.len();
        if total > MAX_INPUT_BYTES {
            return Err(t("native.code.inputsTooLarge"));
        }
        let _ = fs::write(dir.join(name), bytes);
    }
    Ok(dir.to_string_lossy().into_owned())
}

/// Runs what a terminal would and gives what it printed, ending it if it takes too long
fn output_of(mut command: Command) -> Option<String> {
    let child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let output = crate::util::output_within(child, RUNTIMES_TIMEOUT).ok()??;
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// A command in the user's own shell, so it finds what their terminal finds
#[cfg(unix)]
fn in_shell(script: &str) -> String {
    let (shell, args) = crate::util::user_shell(script);
    let mut command = Command::new(shell);
    command.args(args);
    output_of(command).unwrap_or_default()
}

/// macOS ships /usr/bin/python3 as a stub that opens the installer of the developer tools until they're installed
#[cfg(unix)]
fn is_installer_stub(path: &str) -> bool {
    cfg!(target_os = "macos")
        && path == "/usr/bin/python3"
        && !Command::new("xcode-select")
            .arg("-p")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
}

#[cfg(unix)]
fn find_runtimes() -> Runtimes {
    let found = in_shell("command -v python3; command -v node");
    // Only lines that are paths: a shell's startup may print other things
    let path_of = |name: &str| {
        found
            .lines()
            .map(str::trim)
            .find(|line| line.starts_with('/') && line.ends_with(&format!("/{name}")))
    };
    // Python counts only once it has answered: a broken one isn't offered to the model
    let packages = path_of("python3")
        .filter(|path| !is_installer_stub(path))
        .and_then(|_| {
            packages_in(&in_shell(&format!(
                "python3 -c \"{PACKAGES_PROBE}\" {} 2>/dev/null",
                PACKAGES.join(" ")
            )))
        });
    let python = packages.is_some();
    let (packages, missing_packages) = packages.unwrap_or_default();
    Runtimes {
        python: python.then(|| "python3".into()),
        javascript: path_of("node").map(|_| "node".into()),
        packages,
        missing_packages,
    }
}

/// The installed packages and the missing ones, from what Python printed after the mark; None if it didn't answer
fn packages_in(output: &str) -> Option<(Vec<String>, Vec<String>)> {
    let list = output
        .lines()
        .find_map(|line| line.trim().strip_prefix(PACKAGES_MARK))?;
    let installed: Vec<&str> = list.split(',').collect();
    let (has, lacks): (Vec<&str>, Vec<&str>) = PACKAGES.iter().partition(|p| installed.contains(p));
    let owned = |names: Vec<&str>| names.into_iter().map(String::from).collect();
    Some((owned(has), owned(lacks)))
}

/// The py launcher first; a python.exe under WindowsApps is the Store's placeholder, which opens the Store instead
#[cfg(windows)]
fn find_runtimes() -> Runtimes {
    use std::os::windows::process::CommandExt;
    let paths = |name: &str| {
        let mut command = Command::new("where.exe");
        command
            .arg(name)
            .creation_flags(crate::util::CREATE_NO_WINDOW);
        output_of(command).unwrap_or_default()
    };
    let real = |text: String| {
        text.lines()
            .any(|line| !line.trim().is_empty() && !line.to_lowercase().contains("windowsapps"))
    };
    let python: Option<&[&str]> = if real(paths("py")) {
        Some(&["py", "-3"])
    } else if real(paths("python")) {
        Some(&["python"])
    } else {
        None
    };
    // Python counts only once it has answered: a broken one isn't offered to the model
    let packages = python.and_then(|launcher| {
        let mut command = Command::new(launcher[0]);
        command
            .args(&launcher[1..])
            .args(["-c", PACKAGES_PROBE])
            .args(PACKAGES)
            .creation_flags(crate::util::CREATE_NO_WINDOW);
        packages_in(&output_of(command).unwrap_or_default())
    });
    let python = python.filter(|_| packages.is_some());
    let (packages, missing_packages) = packages.unwrap_or_default();
    Runtimes {
        python: python.map(|launcher| launcher.join(" ")),
        javascript: real(paths("node")).then(|| "node".into()),
        packages,
        missing_packages,
    }
}

// Blocking: the shell may take a few seconds to start, so it runs on a thread of its own
async fn runtimes(cache: &RuntimesCache) -> Result<Runtimes, String> {
    if let Some((at, found)) = cache.lock().map_err(to_message)?.clone() {
        if at.elapsed() < RUNTIMES_FRESH {
            return Ok(found);
        }
    }
    let found = tauri::async_runtime::spawn_blocking(find_runtimes)
        .await
        .map_err(to_message)?;
    *cache.lock().map_err(to_message)? = Some((Instant::now(), found.clone()));
    Ok(found)
}

/// Which languages can run here, looked for again at most once a minute (the user may install one meanwhile)
#[tauri::command]
pub async fn code_runtimes(state: State<'_, CodeRuns>) -> Result<Runtimes, String> {
    let cache = Arc::clone(&state.runtimes);
    runtimes(&cache).await
}

fn launch_command(runtimes: &Runtimes, language: &str, file: &Path) -> Result<String, String> {
    let launcher = match language {
        "python" => runtimes.python.as_ref(),
        "javascript" => runtimes.javascript.as_ref(),
        _ => None,
    }
    .ok_or_else(|| t_with("native.code.noRuntime", &[("language", language)]))?;
    Ok(format!("{launcher} \"{}\"", file.to_string_lossy()))
}

/// Saves the program in the conversation's folder and gives the command that runs it
#[tauri::command]
pub async fn prepare_code(
    app: AppHandle,
    state: State<'_, CodeRuns>,
    conversation_id: String,
    language: String,
    source: String,
) -> Result<String, String> {
    let extension = match language.as_str() {
        "python" => "py",
        "javascript" => "js",
        _ => return Err(t_with("native.code.noRuntime", &[("language", &language)])),
    };
    let found = runtimes(&Arc::clone(&state.runtimes)).await?;
    let dir = space_of(&app, &conversation_id)?;
    let file = dir.join(format!("nyra-{}.{extension}", now_millis()));
    fs::write(&file, source).map_err(to_message)?;
    launch_command(&found, &language, &file)
}

/// The programs Nyra saved to run them, which aren't what they created
fn is_program_file(path: &str) -> bool {
    path.strip_prefix("nyra-")
        .and_then(|rest| {
            rest.strip_suffix(".py")
                .or_else(|| rest.strip_suffix(".js"))
        })
        .is_some_and(|millis| !millis.is_empty() && millis.bytes().all(|b| b.is_ascii_digit()))
}

fn list(dir: &Path, base: &Path, out: &mut Vec<CodeFile>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= MAX_WALKED_FILES {
            return;
        }
        let Ok(meta) = fs::symlink_metadata(entry.path()) else {
            continue;
        };
        if meta.is_dir() {
            list(&entry.path(), base, out);
        } else if meta.is_file() {
            let Ok(relative) = entry.path().strip_prefix(base).map(Path::to_path_buf) else {
                continue;
            };
            let modified = meta
                .modified()
                .ok()
                .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or_default();
            let path = relative
                .components()
                .map(|c| c.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            if is_program_file(&path) {
                continue;
            }
            out.push(CodeFile {
                path,
                size: meta.len(),
                modified,
            });
        }
    }
}

/// The files in the conversation's folder, to tell which ones a program created or changed
#[tauri::command]
pub async fn code_files(app: AppHandle, conversation_id: String) -> Result<Vec<CodeFile>, String> {
    let dir = space_of(&app, &conversation_id)?;
    // Thousands of entries may be walked: off the async threads
    crate::workspace::blocking(move || {
        let mut files = Vec::new();
        list(&dir, &dir, &mut files);
        // The newest first, so a long conversation's old files never push out what a program just made
        files.sort_by_key(|file| std::cmp::Reverse(file.modified));
        files.truncate(MAX_LISTED_FILES);
        files
    })
    .await
}

/// A file a program created, to show it (an image) in its card
#[tauri::command]
pub async fn read_code_file(
    app: AppHandle,
    conversation_id: String,
    path: String,
) -> Result<String, String> {
    use base64::Engine;
    let file = inside(&space_of(&app, &conversation_id)?, &path)?;
    crate::workspace::blocking(move || {
        let meta = fs::symlink_metadata(&file).map_err(|_| t("native.code.fileGone"))?;
        if !meta.is_file() || meta.len() > MAX_SHOWN_BYTES {
            return Err(t("native.code.fileTooLarge"));
        }
        let bytes = fs::read(file).map_err(to_message)?;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    })
    .await?
}

/// "Guardar…" on a file a program created: a copy wherever the user chooses. false when they close the dialog.
#[tauri::command]
pub async fn save_code_file(
    app: AppHandle,
    conversation_id: String,
    path: String,
) -> Result<bool, String> {
    let file = inside(&space_of(&app, &conversation_id)?, &path)?;
    if !fs::symlink_metadata(&file).is_ok_and(|m| m.is_file()) {
        return Err(t("native.code.fileGone"));
    }
    let name = file
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let Some(destination) = where_to_save(&app, name, None).await? else {
        return Ok(false);
    };
    fs::copy(file, destination).map_err(|_| t("native.code.saveFailed"))?;
    Ok(true)
}

/// A deleted conversation takes its folder with it
pub fn forget(app: &AppHandle, conversation: &str) {
    let Ok(name) = valid_conversation(conversation) else {
        return;
    };
    if let Ok(root) = runs_root(app) {
        let _ = fs::remove_dir_all(root.join(name));
    }
}

pub fn forget_all(app: &AppHandle) {
    if let Ok(root) = runs_root(app) {
        let _ = fs::remove_dir_all(root);
    }
}

/// On start: the folders of conversations nobody has touched in a month
pub fn clear_stale(app: &AppHandle) {
    let Ok(entries) = runs_root(app).and_then(|root| fs::read_dir(root).map_err(to_message)) else {
        return;
    };
    for entry in entries.flatten() {
        let stale = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|m| m.elapsed().ok())
            .is_some_and(|age| age > STALE_AFTER);
        if stale {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_attached_files_to_their_names() {
        assert_eq!(input_name("ventas.csv").as_deref(), Some("ventas.csv"));
        assert_eq!(
            input_name("../../secreto.txt").as_deref(),
            Some("secreto.txt")
        );
        assert_eq!(
            input_name("C:\\datos\\informe.xlsx").as_deref(),
            Some("informe.xlsx")
        );
        assert_eq!(input_name(".."), None);
        assert_eq!(input_name(""), None);
    }

    #[test]
    fn reaches_only_inside_the_conversation_folder() {
        let dir = Path::new("/cache/code-runs/abc");
        assert!(inside(dir, "grafico.png").is_ok());
        assert!(inside(dir, "salida/tabla.csv").is_ok());
        for refused in ["", "../otra/x", "/etc/hosts", "a/../../b"] {
            assert!(inside(dir, refused).is_err(), "{refused}");
        }
    }

    #[test]
    fn runs_each_language_with_its_interpreter_and_the_file_quoted() {
        let found = Runtimes {
            python: Some("python3".into()),
            javascript: None,
            packages: Vec::new(),
            missing_packages: Vec::new(),
        };
        let file = Path::new("/cache/Application Support/nyra-1.py");
        assert_eq!(
            launch_command(&found, "python", file).unwrap(),
            "python3 \"/cache/Application Support/nyra-1.py\""
        );
        assert!(launch_command(&found, "javascript", file).is_err());
        assert!(launch_command(&found, "ruby", file).is_err());
    }

    #[test]
    fn reads_the_packages_past_what_the_shell_prints() {
        let output = "Bienvenida\n/usr/bin/python3\nnyra-packages:numpy,matplotlib\n";
        let (installed, missing) = packages_in(output).unwrap();
        assert_eq!(installed, ["numpy", "matplotlib"]);
        assert!(missing.contains(&"pandas".to_string()) && !missing.contains(&"numpy".to_string()));
        assert_eq!(
            packages_in("nyra-packages:\n").unwrap().1.len(),
            PACKAGES.len()
        );
        assert_eq!(packages_in("/usr/bin/python3\n"), None);
    }

    #[test]
    fn tells_the_saved_programs_from_what_they_created() {
        assert!(is_program_file("nyra-1761400000000.py"));
        assert!(is_program_file("nyra-1761400000000.js"));
        assert!(!is_program_file("nyra-grafico.py"));
        assert!(!is_program_file("salida/nyra-1.py"));
        assert!(!is_program_file("grafico.png"));
    }

    #[test]
    fn accepts_only_plain_conversation_ids() {
        assert!(valid_conversation("4f2d8512-4415-cf80").is_ok());
        assert!(valid_conversation("../x").is_err());
        assert!(valid_conversation("").is_err());
        assert_eq!(
            valid_conversation("claude-code:4f2d").unwrap(),
            "claude-code_4f2d"
        );
        assert!(valid_conversation("claude-code:4f2d:1700").is_ok());
        assert!(valid_conversation("a:b:c:d").is_err());
        assert!(valid_conversation("claude-code:").is_err());
    }
}
