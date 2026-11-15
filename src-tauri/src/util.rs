//! Small helpers shared by the commands.

use std::path::{Component, Path, PathBuf};

use crate::i18n::t_with;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

/// Commands return their errors as text the frontend can show.
pub fn to_message(error: impl ToString) -> String {
    error.to_string()
}

/// A relative path as plain names joined by "/", the way the frontend and the database name files. None for "..", an
/// absolute path, a drive or nothing at all, which could reach outside the folder it is read against.
pub fn plain_key(path: &Path) -> Option<String> {
    let parts: Vec<String> = path
        .components()
        .map(|component| match component {
            Component::Normal(part) => part.to_str().map(str::to_string),
            _ => None,
        })
        .collect::<Option<_>>()?;
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// Where the user wants a file saved, asked with the system's dialog, offering a name and, if given, a type with
/// its extensions. None when they close it without choosing.
pub fn ask_where_to_save(
    app: &AppHandle,
    name: impl Into<String>,
    filter: Option<(&str, &[&str])>,
) -> Result<Option<PathBuf>, String> {
    let mut dialog = app.dialog().file().set_file_name(name);
    if let Some((label, extensions)) = filter {
        dialog = dialog.add_filter(label, extensions);
    }
    dialog
        .blocking_save_file()
        .map(|path| path.into_path().map_err(to_message))
        .transpose()
}

/// The app's data folder (conversations, skills, the API keys file), where each system keeps app data.
pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(to_message)
}

/// Ids come from the frontend (`crypto.randomUUID`, `cmd-…`), so only a plain short token is accepted: never
/// anything that could form a path or a query
pub fn is_plain_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// A conversation's id: Nyra's own, or an imported one with its source and parts before ":"
/// ("claude-code:<session>", or "claude-code:<session>:<ms>" for a later copy)
pub fn is_conversation_id(id: &str) -> bool {
    let parts: Vec<&str> = id.split(':').collect();
    parts.len() <= 3 && parts.iter().all(|part| is_plain_id(part))
}

/// A conversation's id as part of a file name; Windows doesn't allow ":" in one
pub fn conversation_file_name(id: &str) -> Option<String> {
    is_conversation_id(id).then(|| id.replace(':', "_"))
}

/// A name written by the user (a folder's, a project's): trimmed, not empty and not too long, each told in the
/// interface's language
pub fn limited_name(name: &str, max: usize, empty: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(empty.to_string());
    }
    let length = name.chars().count();
    if length > max {
        let (max, extra) = (max.to_string(), (length - max).to_string());
        return Err(t_with(
            "native.util.tooLong",
            &[("max", &max), ("extra", &extra)],
        ));
    }
    Ok(name.to_string())
}

/// Windows gives a folder's real path as \\?\C:\…, which PowerShell, git and many tools handle badly: the plain form
/// names the same folder. Only for a disk or a network share; anything else stays as it is.
fn plain_text(path: &str) -> Option<String> {
    if let Some(share) = path.strip_prefix(r"\\?\UNC\") {
        return Some(format!(r"\\{share}"));
    }
    let rest = path.strip_prefix(r"\\?\")?;
    (rest.as_bytes().get(1) == Some(&b':')).then(|| rest.to_string())
}

pub fn plain_path(path: PathBuf) -> PathBuf {
    if cfg!(windows) {
        if let Some(plain) = path.to_str().and_then(plain_text) {
            return PathBuf::from(plain);
        }
    }
    path
}

/// Written whole to a temporary file beside it and then put in its place, so a failure never leaves it half written.
/// The temporary file gets a random name created new, so a link planted under a guessed name is never followed, and
/// goes away if anything fails. On Unix it is readable only by the user unless `permissions` says otherwise.
pub fn write_atomically(
    path: &Path,
    bytes: &[u8],
    permissions: Option<std::fs::Permissions>,
) -> std::io::Result<()> {
    use std::io::Write;
    let dir = path
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut file = tempfile::Builder::new()
        .prefix(".nyra-")
        .suffix(".tmp")
        .tempfile_in(dir)?;
    if let Some(permissions) = permissions {
        file.as_file().set_permissions(permissions)?;
    }
    file.write_all(bytes)?;
    file.as_file().sync_all()?;
    file.persist(path).map(|_| ()).map_err(|e| e.error)
}

/// What a program printed, run with a time limit; None when it passed it, and then it is stopped. Its output is read
/// while it runs, so a full pipe never leaves it waiting.
pub fn output_within(
    child: std::process::Child,
    limit: std::time::Duration,
) -> std::io::Result<Option<std::process::Output>> {
    use process_control::{ChildExt, Control};
    let output = child
        .controlled_with_output()
        .time_limit(limit)
        .terminate_for_timeout()
        .wait()?;
    Ok(output.map(|output| output.into_std_lossy()))
}

/// Where a path really leads, links followed, in the plain form
pub fn real_path(path: &Path) -> std::io::Result<PathBuf> {
    path.canonicalize().map(plain_path)
}

/// The user's shell and what makes it run `script` as their terminal would: as an interactive login shell, so it
/// finds what their terminal finds (Homebrew, nvm, pyenv…), which an app opened from the Dock or a launcher doesn't
/// get. Only the shells known to take -l and -i together get them; any other gets a plain -c.
#[cfg(unix)]
pub fn user_shell(script: &str) -> (String, Vec<String>) {
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "/bin/sh".into());
    let login = ["zsh", "bash", "fish"]
        .iter()
        .any(|name| shell.ends_with(name));
    let flags: &[&str] = if login { &["-l", "-i", "-c"] } else { &["-c"] };
    let args = flags
        .iter()
        .map(|f| f.to_string())
        .chain([script.to_string()])
        .collect();
    (shell, args)
}

/// A lock that a panic elsewhere left poisoned still gives its data: everything Nyra keeps behind one stays usable
pub fn lock<T>(mutex: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// For a program Nyra starts on Windows: without it, a console window flashes up
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// When a file was last written, in milliseconds since 1970; 0 when the system won't say
pub fn modified_millis(metadata: &std::fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Where Claude Code keeps its data: CLAUDE_CONFIG_DIR when set, otherwise ~/.claude
pub fn claude_dir(app: &AppHandle) -> Result<PathBuf, String> {
    match std::env::var_os("CLAUDE_CONFIG_DIR") {
        Some(dir) => Ok(PathBuf::from(dir)),
        None => Ok(app.path().home_dir().map_err(to_message)?.join(".claude")),
    }
}

#[cfg(test)]
mod path_tests {
    use super::plain_text;

    #[test]
    fn windows_verbatim_paths_get_their_plain_form() {
        assert_eq!(
            plain_text(r"\\?\C:\Users\marta\web").as_deref(),
            Some(r"C:\Users\marta\web")
        );
        assert_eq!(
            plain_text(r"\\?\UNC\nas\proyectos").as_deref(),
            Some(r"\\nas\proyectos")
        );
        assert_eq!(plain_text(r"\\?\Volume{1234}\x"), None);
        assert_eq!(plain_text("/Users/marta/web"), None);
    }
}

#[cfg(test)]
mod write_tests {
    use super::write_atomically;
    use std::path::Path;

    #[test]
    fn writes_a_file_whole_and_leaves_nothing_behind() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("datos.json");
        write_atomically(&path, b"uno", None).unwrap();
        write_atomically(&path, b"dos", None).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"dos");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
            // Only the user's unless asked otherwise, as API keys need
            assert_eq!(mode(&path), 0o600);
            let script = dir.path().join("script.sh");
            let executable = Some(std::fs::Permissions::from_mode(0o755));
            write_atomically(&script, b"#!/bin/sh", executable).unwrap();
            assert_eq!(mode(&script), 0o755);
        }
    }
}
