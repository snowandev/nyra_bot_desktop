//! The files of an installed skill: read to show a script, and added or removed from its form.

use super::*;

// A script shown before it runs is read whole, but never a large file
pub(super) const MAX_SHOWN_FILE_BYTES: u64 = 512 * 1024;

/// A path inside a skill: relative, without "..", and nothing that could step out of its folder
pub(super) fn plain_relative(path: &str) -> bool {
    let relative = Path::new(path);
    !path.is_empty()
        && !relative.is_absolute()
        && relative
            .components()
            .all(|c| matches!(c, std::path::Component::Normal(_)))
}

/// A file the user may add, replace or remove from Nyra: anything but its SKILL.md and Nyra's own record
pub(super) fn editable_file(path: &str) -> bool {
    plain_relative(path) && path != SKILL_FILE && !is_ignored(path)
}

/// A file of an installed skill, only by a plain relative path that stays inside it and isn't a link elsewhere
pub(super) fn skill_file_path(dir: &Path, path: &str) -> Result<PathBuf, String> {
    let refused = || t("native.skills.notSkillFile");
    if !plain_relative(path) {
        return Err(refused());
    }
    let full = dir.join(path);
    let meta = fs::symlink_metadata(&full).map_err(|_| t("native.skills.fileGone"))?;
    if !meta.is_file() {
        return Err(refused());
    }
    if meta.len() > MAX_SHOWN_FILE_BYTES {
        return Err(t("native.skills.fileTooBig"));
    }
    Ok(full)
}

/// The files added and removed in the skill's form, within the same limits as an imported skill
pub(super) fn apply_file_changes(
    dir: &Path,
    added: Vec<DroppedFile>,
    removed: &[String],
) -> Result<(), String> {
    use base64::Engine;
    let refused = |path: &str| t_with("native.skills.invalidFileName", &[("path", path)]);
    let mut decoded = Vec::with_capacity(added.len());
    for file in added {
        if !editable_file(&file.path) {
            return Err(refused(&file.path));
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&file.data)
            .map_err(|_| t_with("native.skills.unreadableFile", &[("path", &file.path)]))?;
        decoded.push((file.path, bytes));
    }
    if let Some(path) = removed.iter().find(|path| !editable_file(path)) {
        return Err(refused(path));
    }
    // What the skill will hold: what stays plus what comes, replacing a file of the same path
    let mut limits = Limits::new();
    for (path, bytes) in files_in_dir(dir)? {
        if !removed.contains(&path) && !decoded.iter().any(|(added, _)| added == &path) {
            limits.take(bytes.len() as u64)?;
        }
    }
    for (_, bytes) in &decoded {
        limits.take(bytes.len() as u64)?;
    }
    for path in removed {
        let full = dir.join(path);
        if fs::symlink_metadata(&full).is_ok_and(|m| m.is_file()) {
            fs::remove_file(full).map_err(to_message)?;
        }
    }
    for (path, bytes) in decoded {
        let full = dir.join(&path);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).map_err(to_message)?;
        }
        fs::write(&full, bytes).map_err(to_message)?;
        // A shell script in scripts/ can then also run as ./scripts/name.sh
        #[cfg(unix)]
        if path.starts_with("scripts/") {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&full, fs::Permissions::from_mode(0o755));
        }
    }
    Ok(())
}

/// Saves the files added or removed in the skill's form, after the skill itself is saved
#[tauri::command]
pub async fn update_skill_files(
    app: AppHandle,
    name: String,
    added: Vec<DroppedFile>,
    removed: Vec<String>,
) -> Result<(), String> {
    let dir = installed_dir(&app, &name)?;
    if is_builtin(&dir) {
        return Err(t("native.skills.builtinFilesLocked"));
    }
    tauri::async_runtime::spawn_blocking(move || apply_file_changes(&dir, added, &removed))
        .await
        .map_err(to_message)?
}

/// "Ver script" on a command that runs a skill's script: what it contains, before the user decides
#[tauri::command]
pub async fn read_skill_file(app: AppHandle, name: String, path: String) -> Result<String, String> {
    let dir = installed_dir(&app, &name)?;
    let full = skill_file_path(&dir, &path)?;
    fs::read_to_string(full).map_err(|_| t("native.skills.notText"))
}
