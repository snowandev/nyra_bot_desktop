//! What Nyra reads from Git, with the git installed on the computer: the branch and the commits not pushed yet. It
//! never writes to a repository, except `git init` when the user asks for it.

use std::ffi::{OsStr, OsString};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::OnceLock;
use std::time::Duration;

use crate::i18n::{t, t_with};
use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GitState {
    /// ahead: commits not pushed yet; None when the branch follows no remote one
    Repo {
        branch: String,
        ahead: Option<u32>,
    },
    NotRepo,
    /// Git refuses the folder because it belongs to another user (an external disk, a network share)
    NotTrusted,
    /// Git isn't installed, or can't be found
    Unavailable,
}

/// The longest git may take to read: a repository on a network disk that stopped answering would hold the panel
const READ_TIMEOUT: Duration = Duration::from_secs(20);
/// A commit runs the repository's hooks, which may run the tests
const COMMIT_TIMEOUT: Duration = Duration::from_secs(300);

static PROGRAM: OnceLock<Option<PathBuf>> = OnceLock::new();

fn program() -> Option<&'static Path> {
    PROGRAM.get_or_init(find_program).as_deref()
}

/// An app opened from the Dock doesn't get the PATH of the user's shell, so Homebrew's (or MacPorts') git is looked
/// for by hand.
/// /usr/bin/git is only a stub that asks to install the developer tools when they are missing, so it is used only
/// once they are there.
#[cfg(target_os = "macos")]
fn find_program() -> Option<PathBuf> {
    let homebrew = [
        "/opt/homebrew/bin/git",
        "/usr/local/bin/git",
        "/opt/local/bin/git",
    ]
    .into_iter()
    .map(PathBuf::from)
    .find(|path| path.is_file());
    if homebrew.is_some() {
        return homebrew;
    }
    let tools = Command::new("/usr/bin/xcode-select")
        .arg("-p")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()?;
    let system = PathBuf::from("/usr/bin/git");
    (tools.success() && system.is_file()).then_some(system)
}

#[cfg(not(target_os = "macos"))]
fn find_program() -> Option<PathBuf> {
    let mut command = Command::new("git");
    command.arg("--version");
    let found = quiet(&mut command).status().ok()?.success();
    found.then(|| PathBuf::from("git"))
}

/// Without a console window popping up on Windows, and without waiting for input that never comes
fn quiet(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(crate::util::CREATE_NO_WINDOW);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
}

/// What git printed, as it printed it (the status starts some lines with a space)
/// git with the folder's repository, never running a program its config names: a downloaded repository could bring
/// a .git/config whose fsmonitor or diff tools would run with just reading its status
fn git_in(program: &Path, root: &Path) -> Command {
    let mut command = Command::new(program);
    command
        .args(["-c", "core.fsmonitor=false", "-c", "diff.external="])
        .arg("-C")
        .arg(root)
        // Reading the status must not take the repository's lock away from the user's own git
        .env("GIT_OPTIONAL_LOCKS", "0")
        // A path is always a file's path, never a pattern ("*" would be every file)
        .env("GIT_LITERAL_PATHSPECS", "1");
    command
}

/// The filters the repository's own config defines, and those of the files it includes. A downloaded repository may
/// bring a .git/config with one, and `git status` and `git diff` run a filter on the files they compare. Reading the
/// config runs nothing. The user's own config (Git LFS, set up by them) isn't read here, so its filters keep working.
/// None when a name couldn't be turned off safely (an "=" in it would be read as the value).
fn local_filters(program: &Path, root: &Path) -> Option<Vec<String>> {
    let mut command = git_in(program, root);
    command.args([
        "config",
        "--local",
        "--includes",
        "--get-regexp",
        r"^filter\.",
    ]);
    let output = output_within(&mut command, READ_TIMEOUT).ok()?;
    filter_drivers(&String::from_utf8_lossy(&output.stdout))
}

fn filter_drivers(config: &str) -> Option<Vec<String>> {
    let mut drivers: Vec<String> = Vec::new();
    for line in config.lines() {
        let key = line.split_whitespace().next().unwrap_or_default();
        let Some((driver, _)) = key
            .strip_prefix("filter.")
            .and_then(|rest| rest.rsplit_once('.'))
        else {
            continue;
        };
        if driver.contains('=') {
            return None;
        }
        if !drivers.iter().any(|d| d == driver) {
            drivers.push(driver.to_string());
        }
    }
    Some(drivers)
}

/// git to read the folder's state: what git_in turns off, and the repository's own filters too. None when they
/// can't all be turned off: then it isn't read.
fn reading_git(program: &Path, root: &Path) -> Option<Command> {
    let mut command = git_in(program, root);
    for driver in local_filters(program, root)? {
        for setting in ["clean", "smudge", "process"] {
            command.arg("-c").arg(format!("filter.{driver}.{setting}="));
        }
        command
            .arg("-c")
            .arg(format!("filter.{driver}.required=false"));
    }
    Some(command)
}

/// What git printed, or the end of its run past the time limit (it is stopped then)
fn output_within(command: &mut Command, limit: Duration) -> std::io::Result<Output> {
    let child = quiet(command).spawn()?;
    crate::util::output_within(child, limit)?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::TimedOut, t("native.git.timedOut")))
}

/// What git printed when it worked, as bytes (a file's name may not be text), or what it said when it didn't
fn run_bytes<S: AsRef<OsStr>>(root: &Path, args: &[S]) -> Result<Vec<u8>, String> {
    let program = program().ok_or_else(String::new)?;
    let mut command = reading_git(program, root).ok_or_else(|| t("native.git.unsafeConfig"))?;
    command.args(args);
    let output = output_within(&mut command, READ_TIMEOUT).map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

fn run_checked<S: AsRef<OsStr>>(root: &Path, args: &[S]) -> Result<String, String> {
    run_bytes(root, args).map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

fn run_raw<S: AsRef<OsStr>>(root: &Path, args: &[S]) -> Option<String> {
    run_checked(root, args).ok()
}

fn run<S: AsRef<OsStr>>(root: &Path, args: &[S]) -> Option<String> {
    run_raw(root, args).map(|text| text.trim().to_string())
}

pub fn state(root: &Path) -> GitState {
    if program().is_none() {
        return GitState::Unavailable;
    }
    match run_checked(root, &["rev-parse", "--is-inside-work-tree"]) {
        Ok(answer) if answer.trim() == "true" => {}
        // git's message is in the user's language, but the name of the setting that allows the folder isn't
        Err(said) if said.contains("safe.directory") => return GitState::NotTrusted,
        _ => return GitState::NotRepo,
    }
    // symbolic-ref also names the branch of a repository without commits; a detached HEAD shows its commit
    let branch = run(root, &["symbolic-ref", "--short", "-q", "HEAD"])
        .filter(|b| !b.is_empty())
        .or_else(|| run(root, &["rev-parse", "--short", "HEAD"]))
        .unwrap_or_default();
    let ahead =
        run(root, &["rev-list", "--count", "@{upstream}..HEAD"]).and_then(|n| n.parse().ok());
    GitState::Repo { branch, ahead }
}

#[derive(Serialize, Debug, PartialEq)]
pub struct GitChange {
    /// Relative to the project's folder, with forward slashes as git writes them
    pub path: String,
    /// A (added, also a file git doesn't track yet), M (modified) or D (deleted)
    pub status: char,
    /// Lines added and removed; None for a binary file or one too large to count
    pub added: Option<u32>,
    pub removed: Option<u32>,
}

/// Past this a file git doesn't track yet isn't read to count its lines, nor shown whole
const MAX_SHOWN_BYTES: u64 = 512 * 1024;

/// A path git gave, as text the frontend can carry and send back: as it is when it is UTF-8 (every path on Windows
/// and macOS, nearly all on Linux). Linux allows any bytes in a name: then the bytes that aren't plain ASCII are
/// escaped (%E9) after a NUL, which no real path can start with, so the path is never confused or lost.
pub(crate) fn path_text(bytes: &[u8]) -> String {
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_string();
    }
    let mut text = String::from("\0");
    for &byte in bytes {
        if byte.is_ascii_graphic() && byte != b'%' || byte == b' ' {
            text.push(byte as char);
        } else {
            text.push_str(&format!("%{byte:02X}"));
        }
    }
    text
}

/// The path back as the system names it, from what path_text gave; None if it would leave the folder
pub(crate) fn path_from_text(text: &str) -> Option<PathBuf> {
    let Some(escaped) = text.strip_prefix('\0') else {
        return crate::workspace::safe_relative(text).map(|(relative, _)| relative);
    };
    let mut bytes = Vec::new();
    let mut rest = escaped.as_bytes();
    while let Some((&byte, after)) = rest.split_first() {
        if byte == b'%' {
            let hex = std::str::from_utf8(after.get(..2)?).ok()?;
            bytes.push(u8::from_str_radix(hex, 16).ok()?);
            rest = &after[2..];
        } else {
            bytes.push(byte);
            rest = after;
        }
    }
    let path = path_of_bytes(bytes)?;
    let plain = path.components().count() > 0
        && path.components().all(|c| matches!(c, Component::Normal(_)));
    plain.then_some(path)
}

#[cfg(unix)]
fn path_of_bytes(bytes: Vec<u8>) -> Option<PathBuf> {
    use std::os::unix::ffi::OsStringExt;
    Some(PathBuf::from(OsString::from_vec(bytes)))
}

// Elsewhere git always gives UTF-8, so an escaped path can't come from it
#[cfg(not(unix))]
fn path_of_bytes(bytes: Vec<u8>) -> Option<PathBuf> {
    String::from_utf8(bytes).ok().map(PathBuf::from)
}

/// Text of a file inside the folder, if it is small enough and not binary. Never through a link, which could lead
/// out of the folder, nor anything that isn't a plain file (a pipe would wait forever).
fn small_text(root: &Path, relative: &Path) -> Option<String> {
    let file = root.join(relative);
    let metadata = std::fs::symlink_metadata(&file).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_SHOWN_BYTES {
        return None;
    }
    let bytes = std::fs::read(file).ok()?;
    (!bytes.contains(&0)).then(|| String::from_utf8_lossy(&bytes).into_owned())
}

fn has_commits(root: &Path) -> bool {
    run(root, &["rev-parse", "--verify", "-q", "HEAD"]).is_some()
}

/// Past this the list stops: a build folder nobody ignored can hold thousands of new files
const MAX_CHANGES: usize = 500;
/// New files are read to count their lines, but only this many each time the list is read
const MAX_COUNTED_NEW: usize = 100;

#[derive(Serialize, Debug, PartialEq)]
pub struct GitChanges {
    pub files: Vec<GitChange>,
    /// All the files that changed, also those left out of the list
    pub total: usize,
}

/// What changed in the folder since the last commit. The folder may be a part of a larger repository: only its own
/// files count, with their paths relative to it.
pub fn changes(root: &Path) -> GitChanges {
    let prefix = run_bytes(root, &["rev-parse", "--show-prefix"]).unwrap_or_default();
    let prefix = prefix.strip_suffix(b"\n").unwrap_or(&prefix);
    let Ok(status) = run_bytes(
        root,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--no-renames",
            "--untracked-files=all",
            "--",
            ".",
        ],
    ) else {
        return GitChanges {
            files: Vec::new(),
            total: 0,
        };
    };
    let base = if has_commits(root) {
        "HEAD"
    } else {
        "--cached"
    };
    let counts = run_bytes(
        root,
        &[
            "diff",
            base,
            "--numstat",
            "-z",
            "--no-renames",
            "--no-textconv",
            "--no-ext-diff",
            "--relative",
            "--",
            ".",
        ],
    )
    .unwrap_or_default();
    let counted: std::collections::HashMap<&[u8], (Option<u32>, Option<u32>)> = counts
        .split(|&byte| byte == 0)
        .filter_map(|entry| {
            let mut fields = entry.splitn(3, |&byte| byte == b'\t');
            let number = |field: &[u8]| std::str::from_utf8(field).ok()?.parse().ok();
            let added = number(fields.next()?);
            let removed = number(fields.next()?);
            Some((fields.next()?, (added, removed)))
        })
        .collect();
    let entries: Vec<&[u8]> = status
        .split(|&byte| byte == 0)
        .filter(|entry| entry.len() > 3)
        .collect();
    let mut counted_new = 0;
    let files = entries
        .iter()
        .take(MAX_CHANGES)
        .map(|entry| {
            let (code, path) = entry.split_at(3);
            let path = path.strip_prefix(prefix).unwrap_or(path);
            let status = match String::from_utf8_lossy(code).trim() {
                "??" => 'A',
                c if c.contains('A') => 'A',
                c if c.contains('D') => 'D',
                _ => 'M',
            };
            let text = path_text(path);
            let (added, removed) = match counted.get(path) {
                Some(&count) => count,
                // A file git doesn't track yet: all its lines are new
                None if status == 'A' && counted_new < MAX_COUNTED_NEW => {
                    counted_new += 1;
                    let lines = path_from_text(&text)
                        .and_then(|relative| small_text(root, &relative))
                        .map(|content| content.lines().count() as u32);
                    (lines, Some(0))
                }
                None => (None, None),
            };
            GitChange {
                path: text,
                status,
                added,
                removed,
            }
        })
        .collect();
    GitChanges {
        files,
        total: entries.len(),
    }
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    /// A unified diff, or the whole file when it is new (every line added)
    text: String,
    whole_file: bool,
    /// Binary or too large to show
    unavailable: bool,
}

/// The difference of one file with the last commit, to read; never applied
pub fn diff(root: &Path, path: &str, status: char) -> Result<GitDiff, String> {
    let relative = path_from_text(path).ok_or_else(|| t("native.git.fileNotInFolder"))?;
    // The same rule as reading the folder: files that hold keys are never shown, nor git's own (.git/config may
    // keep a token in the remote's address)
    let key = relative.to_string_lossy().replace('\\', "/");
    if crate::workspace::is_secret(&key) || crate::workspace::is_in_vcs_dir(&key) {
        return Err(t("native.git.secretFile"));
    }
    let file = relative.as_os_str();
    // A file git doesn't track yet has no difference to show: all of it is new
    let untracked = status == 'A'
        && (!has_commits(root)
            || run(root, &[OsStr::new("ls-files"), OsStr::new("--"), file])
                .is_none_or(|tracked| tracked.is_empty()));
    if untracked {
        return Ok(match small_text(root, &relative) {
            Some(text) => GitDiff {
                text,
                whole_file: true,
                unavailable: false,
            },
            None => GitDiff {
                text: String::new(),
                whole_file: true,
                unavailable: true,
            },
        });
    }
    let arguments = [
        "diff",
        "HEAD",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--",
    ];
    let arguments: Vec<&OsStr> = arguments.iter().map(OsStr::new).chain([file]).collect();
    let text = run_raw(root, &arguments).ok_or_else(|| t("native.git.diffFailed"))?;
    let unavailable = text.len() as u64 > MAX_SHOWN_BYTES || text.contains("\nBinary files ");
    Ok(GitDiff {
        text: if unavailable { String::new() } else { text },
        whole_file: false,
        unavailable,
    })
}

/// Past these the commit is refused: a message is a few lines, and the files are those of the Git tab's list
const MAX_COMMIT_MESSAGE: usize = 10_000;
const MAX_COMMIT_FILES: usize = 500;

/// The user's commit, approved on its card: only the files they left marked, with their message. It runs the
/// repository's own hooks, as the user's git does, and never pushes. Returns the commit's short id.
pub fn commit(root: &Path, message: &str, paths: &[String]) -> Result<String, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err(t("native.git.emptyMessage"));
    }
    if message.len() > MAX_COMMIT_MESSAGE || paths.is_empty() || paths.len() > MAX_COMMIT_FILES {
        return Err(t("native.git.tooMuch"));
    }
    let keys = paths
        .iter()
        .map(|p| path_from_text(p))
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| t("native.git.fileOutside"))?;
    let program = program().ok_or_else(|| t("native.git.notInstalled"))?;
    let run_git = |args: &[&str]| -> Result<String, String> {
        let mut command = git_in(program, root);
        command.args(args).args(&keys);
        let output = output_within(&mut command, COMMIT_TIMEOUT)
            .map_err(|e| t_with("native.git.commitFailed", &[("error", &e.to_string())]))?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).into_owned())
        } else {
            let said = String::from_utf8_lossy(&output.stderr);
            let said = if said.trim().is_empty() {
                String::from_utf8_lossy(&output.stdout)
            } else {
                said
            };
            Err(t_with("native.git.commitFailed", &[("error", said.trim())]))
        }
    };
    // Added first so new and deleted files go in too; then only these files are committed, whatever else is staged
    run_git(&["add", "-A", "--"])?;
    run_git(&["commit", "-m", message, "--"])?;
    run(root, &["rev-parse", "--short", "HEAD"]).ok_or_else(|| t("native.git.noCommitId"))
}

pub fn init(root: &Path) -> Result<(), String> {
    let program = program().ok_or_else(|| t("native.git.notInstalled"))?;
    let mut command = git_in(program, root);
    command.arg("init");
    let output = output_within(&mut command, READ_TIMEOUT)
        .map_err(|e| t_with("native.git.initFailed", &[("error", &e.to_string())]))?;
    if output.status.success() {
        Ok(())
    } else {
        let said = String::from_utf8_lossy(&output.stderr);
        Err(t_with("native.git.initFailed", &[("error", said.trim())]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn finds_the_filters_a_repository_defines() {
        let config = "filter.lfs.clean git-lfs clean -- %f\nfilter.lfs.process git-lfs filter-process\nfilter.my.driver.smudge cat\n";
        assert_eq!(
            filter_drivers(config),
            Some(vec!["lfs".to_string(), "my.driver".to_string()])
        );
        assert_eq!(filter_drivers(""), Some(vec![]));
        // A name "-c" would split at its "=": the folder isn't read then
        assert_eq!(filter_drivers("filter.x=y.clean evil\n"), None);
    }

    // A repository brought with a .git/config whose filter would run on `git status`: with Nyra's reading it doesn't
    #[test]
    #[ignore = "needs git installed"]
    fn never_runs_a_filter_the_repository_defines() {
        let dir =
            std::env::temp_dir().join(format!("nyra-git-filter-{}", crate::storage::now_millis()));
        let repo = dir.join("repo");
        fs::create_dir_all(&repo).unwrap();
        let marker = dir.join("ran");
        let git = |args: &[&str]| {
            std::process::Command::new("git")
                .arg("-C")
                .arg(&repo)
                .args(args)
                .output()
                .unwrap();
        };
        git(&["init", "-q"]);
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "t"]);
        fs::write(repo.join("a.txt"), "hola\n").unwrap();
        git(&["add", "a.txt"]);
        git(&["commit", "-qm", "init"]);
        fs::write(repo.join(".gitattributes"), "* filter=evil\n").unwrap();
        let clean = format!("sh -c 'touch {}; cat'", marker.display());
        git(&["config", "filter.evil.clean", &clean]);
        fs::write(repo.join("a.txt"), "hola\ncambio\n").unwrap();
        let found = changes(&repo);
        assert!(!marker.exists(), "the repository's filter ran");
        assert!(found.total > 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_name_that_isnt_text_goes_and_comes_back_whole() {
        assert_eq!(path_text(b"src/app.ts"), "src/app.ts");
        let text = path_text(b"docs/caf\xe9 100%.txt");
        assert_eq!(text, "\0docs/caf%E9 100%25.txt");
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStrExt;
            let back = path_from_text(&text).unwrap();
            assert_eq!(back.as_os_str().as_bytes(), b"docs/caf\xe9 100%.txt");
        }
        assert!(path_from_text("\0../fuera%E9").is_none());
        assert!(path_from_text("\0%E").is_none());
        assert!(path_from_text("../fuera.txt").is_none());
    }

    // Only Linux lets a name hold bytes that aren't UTF-8; macOS refuses to create the file
    #[cfg(target_os = "linux")]
    #[test]
    fn a_file_whose_name_isnt_text_can_be_seen_and_committed() {
        use std::os::unix::ffi::OsStrExt;
        if program().is_none() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("nyra-test-{}-git-bytes", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        init(&dir).unwrap();
        for (key, value) in [("user.name", "Marta"), ("user.email", "marta@example.com")] {
            run(&dir, &["config", key, value]).unwrap();
        }
        std::fs::write(dir.join(OsStr::from_bytes(b"caf\xe9.txt")), "uno\n").unwrap();
        let found = changes(&dir);
        assert_eq!(found.files[0].path, "\0caf%E9.txt");
        assert_eq!(found.files[0].added, Some(1));
        let shown = diff(&dir, &found.files[0].path, 'A').unwrap();
        assert_eq!(shown.text, "uno\n");
        assert!(commit(&dir, "Add the file", &[found.files[0].path.clone()]).is_ok());
        assert!(changes(&dir).files.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_process_that_takes_too_long_is_stopped() {
        let mut command = Command::new("sleep");
        command.arg("5");
        let started = std::time::Instant::now();
        let error = output_within(&mut command, Duration::from_millis(100)).unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn lists_new_and_changed_files_with_their_lines() {
        if program().is_none() {
            return;
        }
        let dir =
            std::env::temp_dir().join(format!("nyra-test-{}-git-changes", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        init(&dir).unwrap();
        std::fs::write(dir.join("src/app.ts"), "uno\ndos\n").unwrap();
        let found = changes(&dir);
        assert_eq!(found.total, 1);
        assert_eq!(
            found.files,
            [GitChange {
                path: "src/app.ts".to_string(),
                status: 'A',
                added: Some(2),
                removed: Some(0),
            }]
        );
        let shown = diff(&dir, "src/app.ts", 'A').unwrap();
        assert_eq!(shown.text, "uno\ndos\n");
        assert!(shown.whole_file && shown.text == "uno\ndos\n");
        assert!(diff(&dir, "../fuera.txt", 'A').is_err());
        // git's own files may keep a token in the remote's address
        assert!(diff(&dir, ".git/config", 'A').is_err());
        assert!(diff(&dir, "sub/.git/config", 'M').is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn commits_only_the_marked_files() {
        if program().is_none() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("nyra-test-{}-git-commit", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        init(&dir).unwrap();
        // A test machine may have no identity set up
        for (key, value) in [("user.name", "Marta"), ("user.email", "marta@example.com")] {
            run(&dir, &["config", key, value]).unwrap();
        }
        std::fs::write(dir.join("a.txt"), "uno\n").unwrap();
        std::fs::write(dir.join("b.txt"), "dos\n").unwrap();
        assert!(commit(&dir, "  ", &["a.txt".to_string()]).is_err());
        assert!(commit(&dir, "Add a", &["../fuera.txt".to_string()]).is_err());
        let id = commit(&dir, "Add a", &["a.txt".to_string()]).unwrap();
        assert!(!id.is_empty());
        let left = changes(&dir);
        assert_eq!(
            left.files
                .iter()
                .map(|c| c.path.as_str())
                .collect::<Vec<_>>(),
            ["b.txt"]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_new_repository_has_its_branch_and_no_remote() {
        if program().is_none() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("nyra-test-{}-git", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // The temporary directory may itself be inside a repository on some machines
        let before = state(&dir);
        if before == GitState::NotRepo {
            init(&dir).unwrap();
        }
        match state(&dir) {
            GitState::Repo { branch, ahead } => {
                assert!(!branch.is_empty());
                assert_eq!(ahead, None);
            }
            other => panic!("expected a repository, got {other:?}"),
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
