//! Changes the model proposed to the files of a connected folder, written only when the user applies them. Each write
//! keeps a copy of what was there so it can be undone. Nothing is ever deleted or renamed, and the rules of reading
//! still hold: only inside the folder, never secrets, binaries or ignored files.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::i18n::t;
use crate::spreadsheet::cells::{edit_workbook, CellEdit, EditError};
use crate::spreadsheet::{is_spreadsheet, workbook_view, WorkbookView, MAX_FILE_BYTES};
use crate::storage::{now_millis, Database};
use crate::util::{data_dir, real_path};
use crate::workspace::{
    allowed_root, blocking, decode_text, encode_text, is_binary_name, is_secret, modified_millis,
    safe_relative, SkipReason, TextEncoding, Workspaces, MAX_READ_BYTES, SKIPPED_DIRS,
};

const BACKUPS_DIR: &str = "workspace-backups";
/// A copy older than this can't be needed for "Deshacer" any more
const BACKUP_MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);

static NEXT_BACKUP: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileState {
    /// The text with "\n" line ends; crlf says the file uses "\r\n", and encoding how its bytes are stored, to write
    /// it back the same way
    File {
        content: String,
        modified: i64,
        crlf: bool,
        encoding: TextEncoding,
    },
    Missing,
    Protected {
        reason: SkipReason,
    },
}

#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ApplyOutcome {
    Applied {
        backup: String,
        modified: i64,
    },
    /// Changed (or created) on disk since the model looked at it: writing would overwrite the user's work
    Conflict,
    /// A spreadsheet without the sheet or cell the change names
    NoMatch,
    /// The changes went into a new .xlsx next to a workbook Nyra can only read; undoing removes it
    Copied {
        backup: String,
        modified: i64,
        path: String,
    },
    Protected {
        reason: SkipReason,
    },
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UndoOutcome {
    /// modified: the restored file's time, so it can be applied again; None when the file was removed
    Undone { modified: Option<i64> },
    /// Changed again after being applied: undoing would lose that
    Conflict,
    /// The copy is no longer there (older than 30 days)
    Gone,
}

struct Target {
    key: String,
    path: PathBuf,
}

/// Where a change would write, if it may. An existing file must be in the folder's index (as for reading); a new
/// one must land inside the folder, out of hidden folders and dependencies. Spreadsheets are only written cell by
/// cell (or restored when undoing), never with text.
fn target(
    root: &Path,
    indexed: Option<&HashSet<String>>,
    requested: &str,
    spreadsheet: bool,
) -> Result<Target, SkipReason> {
    let (relative, key) = safe_relative(requested).ok_or(SkipReason::Outside)?;
    if is_secret(&key) {
        return Err(SkipReason::Secret);
    }
    if is_binary_name(&key) && !(spreadsheet && is_spreadsheet(&key)) {
        return Err(SkipReason::Binary);
    }
    if key
        .split('/')
        .any(|p| p.starts_with('.') || SKIPPED_DIRS.contains(&p))
    {
        return Err(SkipReason::Ignored);
    }
    let path = root.join(&relative);
    if fs::symlink_metadata(&path).is_ok() {
        let real = real_path(&path).map_err(|_| SkipReason::Outside)?;
        if !real.starts_with(root) || !real.is_file() {
            return Err(SkipReason::Outside);
        }
        // A link under a harmless name may lead to a secret
        if crate::workspace::relative(root, &real).is_none_or(|real_key| is_secret(&real_key)) {
            return Err(SkipReason::Secret);
        }
        if indexed.is_some_and(|set| !set.contains(&key)) {
            return Err(SkipReason::Ignored);
        }
    } else {
        // A link among the folders that don't exist yet could still lead outside
        let existing = path
            .ancestors()
            .find(|a| a.exists())
            .ok_or(SkipReason::Outside)?;
        let real = real_path(existing).map_err(|_| SkipReason::Outside)?;
        if !real.starts_with(root) {
            return Err(SkipReason::Outside);
        }
    }
    Ok(Target { key, path })
}

fn modified_of(path: &Path) -> Option<i64> {
    fs::metadata(path).ok().map(|m| modified_millis(&m))
}

fn inspect(root: &Path, indexed: &HashSet<String>, requested: &str) -> FileState {
    let target = match target(root, Some(indexed), requested, false) {
        Ok(target) => target,
        Err(reason) => return FileState::Protected { reason },
    };
    let Ok(metadata) = fs::metadata(&target.path) else {
        return FileState::Missing;
    };
    if metadata.len() > MAX_READ_BYTES {
        return FileState::Protected {
            reason: SkipReason::TooLarge,
        };
    }
    let decoded = fs::read(&target.path)
        .map_err(|_| SkipReason::Missing)
        .and_then(|bytes| decode_text(&bytes));
    match decoded {
        Ok((text, encoding)) => FileState::File {
            crlf: mostly_crlf(&text),
            content: text.replace("\r\n", "\n"),
            modified: modified_millis(&metadata),
            encoding,
        },
        Err(reason) => FileState::Protected { reason },
    }
}

/// Whether the file ends its lines with "\r\n": by most of them, so one stray line doesn't turn the whole file over
fn mostly_crlf(text: &str) -> bool {
    let lines = text.matches('\n').count();
    let crlf = text.matches("\r\n").count();
    crlf * 2 > lines
}

/// Through a temporary file and a rename, so a failure never leaves a file half written. A script edited stays
/// executable, and a new file gets the usual permissions rather than the temporary file's, only the user's. On
/// Windows there is no execute bit, and copying the read-only flag would make the swap fail.
fn write_atomically(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    #[cfg(unix)]
    let permissions = {
        use std::os::unix::fs::PermissionsExt;
        Some(
            fs::metadata(path)
                .map_or_else(|_| fs::Permissions::from_mode(0o644), |m| m.permissions()),
        )
    };
    #[cfg(not(unix))]
    let permissions = None;
    crate::util::write_atomically(path, bytes, permissions)
}

/// A new copy's id, with a note of the file it belongs to: undoing only restores a copy onto its own file
fn start_backup(backups: &Path, root: &Path, key: &str) -> Result<String, String> {
    fs::create_dir_all(backups).map_err(|e| e.to_string())?;
    let backup = next_backup_id();
    fs::write(backups.join(format!("{backup}.for")), owner_of(root, key))
        .map_err(|e| e.to_string())?;
    Ok(backup)
}

fn owner_of(root: &Path, key: &str) -> String {
    format!("{}\n{key}", root.display())
}

fn next_backup_id() -> String {
    format!(
        "{}-{}",
        now_millis(),
        NEXT_BACKUP.fetch_add(1, Ordering::Relaxed)
    )
}

fn valid_backup(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_digit() || c == '-')
}

/// How a text file is written back: its line ends and its encoding, as it had them
#[derive(Clone, Copy, Debug, Default)]
struct TextFormat {
    crlf: bool,
    encoding: TextEncoding,
}

/// expected is the file's modification time when the model looked at it, or None for a file it creates
fn apply(
    root: &Path,
    indexed: &HashSet<String>,
    backups: &Path,
    requested: &str,
    content: &str,
    format: TextFormat,
    expected: Option<i64>,
) -> Result<(ApplyOutcome, Option<String>), String> {
    let target = match target(root, Some(indexed), requested, false) {
        Ok(target) => target,
        Err(reason) => return Ok((ApplyOutcome::Protected { reason }, None)),
    };
    let current = modified_of(&target.path);
    if current != expected {
        return Ok((ApplyOutcome::Conflict, None));
    }
    let text = if format.crlf {
        content.replace('\n', "\r\n")
    } else {
        content.to_string()
    };
    // Before anything is written: a character the file's encoding can't hold stops the change
    let bytes = encode_text(&text, format.encoding)?;
    let backup = start_backup(backups, root, &target.key)?;
    match current {
        Some(_) => fs::copy(&target.path, backups.join(format!("{backup}.orig"))).map(|_| ()),
        None => fs::write(backups.join(format!("{backup}.new")), b""),
    }
    .map_err(|e| e.to_string())?;
    if let Some(parent) = target.path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    write_atomically(&target.path, &bytes).map_err(|e| e.to_string())?;
    let modified = modified_of(&target.path).unwrap_or(0);
    Ok((ApplyOutcome::Applied { backup, modified }, Some(target.key)))
}

/// expected is the file's modification time right after it was applied
fn undo(
    root: &Path,
    backups: &Path,
    requested: &str,
    backup: &str,
    expected: i64,
) -> Result<UndoOutcome, String> {
    if !valid_backup(backup) {
        return Err(t("native.workspace.invalidCopy"));
    }
    // A file Nyra created may not be in the index yet
    let target =
        target(root, None, requested, true).map_err(|_| t("native.workspace.cantChange"))?;
    if modified_of(&target.path) != Some(expected) {
        return Ok(UndoOutcome::Conflict);
    }
    // Copies made before the note existed have none, and are still restored
    let owner = backups.join(format!("{backup}.for"));
    if let Ok(noted) = fs::read_to_string(&owner) {
        if noted != owner_of(root, &target.key) {
            return Err(t("native.workspace.copyOfAnother"));
        }
    }
    let created = backups.join(format!("{backup}.new"));
    let original = backups.join(format!("{backup}.orig"));
    if created.exists() {
        fs::remove_file(&target.path).map_err(|e| e.to_string())?;
        let _ = fs::remove_file(created);
    } else if original.exists() {
        let bytes = fs::read(&original).map_err(|e| e.to_string())?;
        write_atomically(&target.path, &bytes).map_err(|e| e.to_string())?;
        let _ = fs::remove_file(original);
    } else {
        return Ok(UndoOutcome::Gone);
    }
    let _ = fs::remove_file(owner);
    Ok(UndoOutcome::Undone {
        modified: modified_of(&target.path),
    })
}

#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WorkbookState {
    Workbook {
        modified: i64,
        #[serde(flatten)]
        view: WorkbookView,
    },
    Missing,
    Protected {
        reason: SkipReason,
    },
}

fn read_workbook(target: &Target) -> Result<(Vec<u8>, i64), SkipReason> {
    let metadata = fs::metadata(&target.path).map_err(|_| SkipReason::Missing)?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err(SkipReason::TooLarge);
    }
    let bytes = fs::read(&target.path).map_err(|_| SkipReason::Missing)?;
    Ok((bytes, modified_millis(&metadata)))
}

/// The workbook as it is now, with the cells of one sheet the review asks for
fn inspect_workbook(
    root: &Path,
    indexed: &HashSet<String>,
    requested: &str,
    sheet: Option<&str>,
    cells: &[String],
) -> WorkbookState {
    let target = match target(root, Some(indexed), requested, true) {
        Ok(target) if is_spreadsheet(&target.key) => target,
        Ok(_) => {
            return WorkbookState::Protected {
                reason: SkipReason::Binary,
            }
        }
        Err(reason) => return WorkbookState::Protected { reason },
    };
    let (bytes, modified) = match read_workbook(&target) {
        Ok(read) => read,
        Err(SkipReason::Missing) => return WorkbookState::Missing,
        Err(reason) => return WorkbookState::Protected { reason },
    };
    match workbook_view(&bytes, sheet, cells) {
        Ok(view) => WorkbookState::Workbook { modified, view },
        Err(_) => WorkbookState::Protected {
            reason: SkipReason::Unreadable,
        },
    }
}

/// expected is the workbook's modification time when the model looked at it
fn apply_cells(
    root: &Path,
    indexed: &HashSet<String>,
    backups: &Path,
    requested: &str,
    edits: &[CellEdit],
    expected: i64,
) -> Result<ApplyOutcome, String> {
    let target = match target(root, Some(indexed), requested, true) {
        Ok(target) if is_spreadsheet(&target.key) => target,
        Ok(_) => {
            return Ok(ApplyOutcome::Protected {
                reason: SkipReason::Binary,
            })
        }
        Err(reason) => return Ok(ApplyOutcome::Protected { reason }),
    };
    let (bytes, modified) = match read_workbook(&target) {
        Ok(read) => read,
        Err(reason) => return Ok(ApplyOutcome::Protected { reason }),
    };
    if modified != expected {
        return Ok(ApplyOutcome::Conflict);
    }
    let written = match edit_workbook(&bytes, edits) {
        Ok(written) => written,
        Err(EditError::ReadOnly) => {
            return Ok(ApplyOutcome::Protected {
                reason: SkipReason::ReadOnly,
            })
        }
        Err(EditError::SheetProtected { .. }) => {
            return Ok(ApplyOutcome::Protected {
                reason: SkipReason::SheetProtected,
            })
        }
        Err(EditError::SheetMissing { .. } | EditError::BadCell { .. }) => {
            return Ok(ApplyOutcome::NoMatch)
        }
        Err(EditError::Damaged) => {
            return Ok(ApplyOutcome::Protected {
                reason: SkipReason::Unreadable,
            })
        }
    };
    let backup = start_backup(backups, root, &target.key)?;
    fs::write(backups.join(format!("{backup}.orig")), &bytes).map_err(|e| e.to_string())?;
    write_atomically(&target.path, &written).map_err(|e| e.to_string())?;
    Ok(ApplyOutcome::Applied {
        backup,
        modified: modified_of(&target.path).unwrap_or(0),
    })
}

/// "presupuesto-2019.xlsx" next to "presupuesto-2019.xls", or "presupuesto-2019 (copia).xlsx" if that is taken
fn copy_name(root: &Path, key: &str) -> Option<String> {
    let stem = key.rsplit_once('.').map_or(key, |(stem, _)| stem);
    (0..100).find_map(|n| {
        let name = match n {
            0 => format!("{stem}.xlsx"),
            1 => format!("{stem} (copia).xlsx"),
            n => format!("{stem} (copia {n}).xlsx"),
        };
        (!root.join(&name).exists()).then_some(name)
    })
}

/// The changes of a workbook Nyra only reads (.xls, .ods), written into a new .xlsx next to it. The original stays.
fn copy_cells_as_xlsx(
    root: &Path,
    indexed: &HashSet<String>,
    backups: &Path,
    requested: &str,
    edits: &[CellEdit],
) -> Result<(ApplyOutcome, Option<String>), String> {
    let source = match target(root, Some(indexed), requested, true) {
        Ok(target) if is_spreadsheet(&target.key) => target,
        Ok(_) => {
            return Ok((
                ApplyOutcome::Protected {
                    reason: SkipReason::Binary,
                },
                None,
            ))
        }
        Err(reason) => return Ok((ApplyOutcome::Protected { reason }, None)),
    };
    let (bytes, _) = match read_workbook(&source) {
        Ok(read) => read,
        Err(reason) => return Ok((ApplyOutcome::Protected { reason }, None)),
    };
    let written =
        crate::spreadsheet::convert::to_xlsx(&bytes).and_then(|copy| edit_workbook(&copy, edits));
    let written = match written {
        Ok(written) => written,
        Err(EditError::SheetMissing { .. } | EditError::BadCell { .. }) => {
            return Ok((ApplyOutcome::NoMatch, None))
        }
        Err(_) => {
            return Ok((
                ApplyOutcome::Protected {
                    reason: SkipReason::Unreadable,
                },
                None,
            ))
        }
    };
    let Some(name) = copy_name(root, &source.key) else {
        return Err(t("native.workspace.noFreeName"));
    };
    let destination = match target(root, None, &name, true) {
        Ok(destination) => destination,
        Err(reason) => return Ok((ApplyOutcome::Protected { reason }, None)),
    };
    let backup = start_backup(backups, root, &destination.key)?;
    // Undoing a created file removes it, as for a file Nyra creates from text
    fs::write(backups.join(format!("{backup}.new")), b"").map_err(|e| e.to_string())?;
    write_atomically(&destination.path, &written).map_err(|e| e.to_string())?;
    let modified = modified_of(&destination.path).unwrap_or(0);
    let path = destination.key.clone();
    Ok((
        ApplyOutcome::Copied {
            backup,
            modified,
            path,
        },
        Some(destination.key),
    ))
}

/// On start: copies older than a month go. A failure only leaves them a little longer.
pub fn prune_backups(app: &AppHandle) {
    let Ok(dir) = data_dir(app).map(|d| d.join(BACKUPS_DIR)) else {
        return;
    };
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| now.duration_since(t).ok())
            .is_some_and(|age| age > BACKUP_MAX_AGE);
        if old {
            let _ = fs::remove_file(entry.path());
        }
    }
}

#[tauri::command]
pub async fn inspect_workspace_file(
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    root: String,
    path: String,
) -> Result<FileState, String> {
    let root = allowed_root(&db, &workspaces, &root)?;
    let indexed = workspaces.indexed(&root)?;
    blocking(move || inspect(&root, &indexed, &path)).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn apply_workspace_change(
    app: AppHandle,
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    root: String,
    path: String,
    content: String,
    crlf: bool,
    encoding: Option<TextEncoding>,
    expected_modified: Option<i64>,
) -> Result<ApplyOutcome, String> {
    let root = allowed_root(&db, &workspaces, &root)?;
    let indexed = workspaces.indexed(&root)?;
    let backups = data_dir(&app)?.join(BACKUPS_DIR);
    let folder = root.clone();
    let (outcome, written) = blocking(move || {
        apply(
            &folder,
            &indexed,
            &backups,
            &path,
            &content,
            TextFormat {
                crlf,
                encoding: encoding.unwrap_or_default(),
            },
            expected_modified,
        )
    })
    .await??;
    if let Some(key) = written {
        workspaces.add_indexed(&root, key)?;
    }
    Ok(outcome)
}

#[tauri::command]
pub async fn undo_workspace_change(
    app: AppHandle,
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    root: String,
    path: String,
    backup: String,
    expected_modified: i64,
) -> Result<UndoOutcome, String> {
    let root = allowed_root(&db, &workspaces, &root)?;
    let backups = data_dir(&app)?.join(BACKUPS_DIR);
    blocking(move || undo(&root, &backups, &path, &backup, expected_modified)).await?
}

#[tauri::command]
pub async fn inspect_workspace_workbook(
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    root: String,
    path: String,
    sheet: Option<String>,
    cells: Vec<String>,
) -> Result<WorkbookState, String> {
    let root = allowed_root(&db, &workspaces, &root)?;
    let indexed = workspaces.indexed(&root)?;
    blocking(move || inspect_workbook(&root, &indexed, &path, sheet.as_deref(), &cells)).await
}

#[tauri::command]
pub async fn apply_workspace_cells(
    app: AppHandle,
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    root: String,
    path: String,
    edits: Vec<CellEdit>,
    expected_modified: i64,
) -> Result<ApplyOutcome, String> {
    let root = allowed_root(&db, &workspaces, &root)?;
    let indexed = workspaces.indexed(&root)?;
    let backups = data_dir(&app)?.join(BACKUPS_DIR);
    blocking(move || apply_cells(&root, &indexed, &backups, &path, &edits, expected_modified))
        .await?
}

#[tauri::command]
pub async fn copy_workspace_cells_as_xlsx(
    app: AppHandle,
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    root: String,
    path: String,
    edits: Vec<CellEdit>,
) -> Result<ApplyOutcome, String> {
    let root = allowed_root(&db, &workspaces, &root)?;
    let indexed = workspaces.indexed(&root)?;
    let backups = data_dir(&app)?.join(BACKUPS_DIR);
    let folder = root.clone();
    let (outcome, written) =
        blocking(move || copy_cells_as_xlsx(&folder, &indexed, &backups, &path, &edits)).await??;
    if let Some(key) = written {
        workspaces.add_indexed(&root, key)?;
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_ends_follow_most_of_the_file() {
        assert!(mostly_crlf("a\r\nb\r\nc\n"));
        assert!(!mostly_crlf("a\nb\nc\r\nd\n"));
        assert!(!mostly_crlf("una sola línea"));
    }

    #[cfg(unix)]
    #[test]
    fn a_changed_script_stays_executable() {
        use std::os::unix::fs::PermissionsExt;
        let dir =
            std::env::temp_dir().join(format!("nyra-test-{}-changes-mode", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let script = dir.join("build.sh");
        fs::write(&script, "echo uno\n").unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        write_atomically(&script, b"echo dos\n").unwrap();
        assert_eq!(
            fs::metadata(&script).unwrap().permissions().mode() & 0o777,
            0o755
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    fn folder(label: &str) -> (PathBuf, PathBuf, HashSet<String>) {
        let base =
            std::env::temp_dir().join(format!("nyra-test-{}-changes-{label}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let root = base.join("project");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/App.tsx"), "uno\r\ndos\r\n").unwrap();
        fs::write(root.join(".env"), "KEY=1").unwrap();
        let root = root.canonicalize().unwrap();
        let indexed = ["src/App.tsx".to_string()].into_iter().collect();
        (root, base.join("backups"), indexed)
    }

    fn file(state: FileState) -> (String, i64, bool) {
        match state {
            FileState::File {
                content,
                modified,
                crlf,
                ..
            } => (content, modified, crlf),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn writes_cells_of_a_workbook_and_undoes() {
        let (root, backups, _) = folder("cells");
        fs::write(
            root.join("ventas.xlsx"),
            crate::spreadsheet::tests::sample_xlsx(),
        )
        .unwrap();
        let indexed: HashSet<String> = ["ventas.xlsx".to_string()].into_iter().collect();
        let cells = ["B2".to_string(), "E2".to_string()];
        let WorkbookState::Workbook { modified, view } =
            inspect_workbook(&root, &indexed, "ventas.xlsx", Some("Ventas"), &cells)
        else {
            panic!("not a workbook")
        };
        let shown = serde_json::to_value(&view).unwrap();
        assert_eq!(shown["writable"], true);
        assert_eq!(shown["sheets"][0]["rows"], 4);
        assert_eq!(shown["cells"][0]["value"], "10");
        assert_eq!(shown["cells"][1]["value"], "");

        let edit = |cell: &str, value: &str| CellEdit {
            sheet: "Ventas".into(),
            cell: cell.into(),
            value: value.into(),
        };
        assert!(matches!(
            apply_cells(
                &root,
                &indexed,
                &backups,
                "ventas.xlsx",
                &[edit("B2", "12")],
                modified - 1
            )
            .unwrap(),
            ApplyOutcome::Conflict
        ));
        let missing = CellEdit {
            sheet: "Otra".into(),
            cell: "A1".into(),
            value: "1".into(),
        };
        assert!(matches!(
            apply_cells(
                &root,
                &indexed,
                &backups,
                "ventas.xlsx",
                &[missing],
                modified
            )
            .unwrap(),
            ApplyOutcome::NoMatch
        ));
        let ApplyOutcome::Applied { backup, modified } = apply_cells(
            &root,
            &indexed,
            &backups,
            "ventas.xlsx",
            &[edit("B2", "12")],
            modified,
        )
        .unwrap() else {
            panic!("not applied")
        };
        let after = fs::read(root.join("ventas.xlsx")).unwrap();
        assert!(crate::spreadsheet::workbook_text(&after, 10_000)
            .unwrap()
            .contains("| 2 | Manzana | 12 |"));

        assert!(matches!(
            undo(&root, &backups, "ventas.xlsx", &backup, modified).unwrap(),
            UndoOutcome::Undone { .. }
        ));
        assert_eq!(
            fs::read(root.join("ventas.xlsx")).unwrap(),
            crate::spreadsheet::tests::sample_xlsx()
        );
    }

    #[test]
    fn writes_the_changes_of_a_read_only_workbook_into_a_copy_next_to_it() {
        let (root, backups, _) = folder("copy-xlsx");
        let ods = crate::spreadsheet::convert::tests::sample_ods();
        fs::write(root.join("socios.ods"), &ods).unwrap();
        fs::write(root.join("socios.xlsx"), b"taken").unwrap();
        let indexed: HashSet<String> = ["socios.ods".to_string()].into_iter().collect();
        let edits = [CellEdit {
            sheet: "Socios".into(),
            cell: "B2".into(),
            value: "25".into(),
        }];
        let (outcome, _) =
            copy_cells_as_xlsx(&root, &indexed, &backups, "socios.ods", &edits).unwrap();
        let ApplyOutcome::Copied {
            backup,
            modified,
            path,
        } = outcome
        else {
            panic!("{outcome:?}")
        };
        assert_eq!(path, "socios (copia).xlsx");
        assert_eq!(fs::read(root.join("socios.ods")).unwrap(), ods);
        let copy = fs::read(root.join(&path)).unwrap();
        assert!(crate::spreadsheet::workbook_text(&copy, 10_000)
            .unwrap()
            .contains("| 2 | Marta | 25 |"));
        assert!(matches!(
            undo(&root, &backups, &path, &backup, modified).unwrap(),
            UndoOutcome::Undone { modified: None }
        ));
        assert!(!root.join(&path).exists());
    }

    #[test]
    fn never_writes_text_into_a_spreadsheet() {
        let (root, _, _) = folder("text-into-sheet");
        assert!(matches!(
            target(&root, None, "nuevo.xlsx", false),
            Err(SkipReason::Binary)
        ));
        assert!(target(&root, None, "nuevo.xlsx", true).is_ok());
    }

    #[test]
    fn keeps_a_windows_1252_file_in_its_encoding() {
        let (root, backups, _) = folder("encoding");
        // "Año;Importe" and "Café;3" as Excel writes a CSV on Windows
        fs::write(root.join("datos.csv"), b"A\xf1o;Importe\r\nCaf\xe9;3\r\n").unwrap();
        let indexed: HashSet<String> = ["datos.csv".to_string()].into_iter().collect();
        let FileState::File {
            content,
            modified,
            crlf,
            encoding,
        } = inspect(&root, &indexed, "datos.csv")
        else {
            panic!("not a file")
        };
        assert_eq!(
            (content.as_str(), crlf, encoding),
            ("Año;Importe\nCafé;3\n", true, TextEncoding::Windows1252)
        );
        let edited = content.replace("3", "4");
        apply(
            &root,
            &indexed,
            &backups,
            "datos.csv",
            &edited,
            TextFormat { crlf, encoding },
            Some(modified),
        )
        .unwrap();
        assert_eq!(
            fs::read(root.join("datos.csv")).unwrap(),
            b"A\xf1o;Importe\r\nCaf\xe9;4\r\n"
        );
        // A character Windows-1252 can't hold stops the change instead of writing it wrong
        let modified = modified_of(&root.join("datos.csv"));
        assert!(apply(
            &root,
            &indexed,
            &backups,
            "datos.csv",
            "Año;€\n日本",
            TextFormat { crlf, encoding },
            modified
        )
        .is_err());
    }

    #[test]
    fn applies_with_the_files_line_ends_and_undoes() {
        let (root, backups, indexed) = folder("apply");
        let (content, modified, crlf) = file(inspect(&root, &indexed, "src/App.tsx"));
        assert_eq!((content.as_str(), crlf), ("uno\ndos\n", true));

        let (outcome, _) = apply(
            &root,
            &indexed,
            &backups,
            "src/App.tsx",
            "uno\ntres\n",
            TextFormat {
                crlf: true,
                encoding: TextEncoding::Utf8,
            },
            Some(modified),
        )
        .unwrap();
        let ApplyOutcome::Applied { backup, modified } = outcome else {
            panic!("{outcome:?}")
        };
        assert_eq!(
            fs::read_to_string(root.join("src/App.tsx")).unwrap(),
            "uno\r\ntres\r\n"
        );

        assert!(matches!(
            undo(&root, &backups, "src/App.tsx", &backup, modified).unwrap(),
            UndoOutcome::Undone { .. }
        ));
        assert_eq!(
            fs::read_to_string(root.join("src/App.tsx")).unwrap(),
            "uno\r\ndos\r\n"
        );
    }

    #[test]
    fn refuses_to_overwrite_a_file_that_changed() {
        let (root, backups, indexed) = folder("conflict");
        let outcome = apply(
            &root,
            &indexed,
            &backups,
            "src/App.tsx",
            "x",
            TextFormat {
                crlf: false,
                encoding: TextEncoding::Utf8,
            },
            Some(1),
        )
        .unwrap()
        .0;
        assert!(matches!(outcome, ApplyOutcome::Conflict));
        // Creating a file that already exists is the same
        let outcome = apply(
            &root,
            &indexed,
            &backups,
            "src/App.tsx",
            "x",
            TextFormat {
                crlf: false,
                encoding: TextEncoding::Utf8,
            },
            None,
        )
        .unwrap()
        .0;
        assert!(matches!(outcome, ApplyOutcome::Conflict));
        assert_eq!(
            fs::read_to_string(root.join("src/App.tsx")).unwrap(),
            "uno\r\ndos\r\n"
        );
    }

    #[test]
    fn creates_a_new_file_and_undoing_removes_it() {
        let (root, backups, indexed) = folder("create");
        let (outcome, key) = apply(
            &root,
            &indexed,
            &backups,
            "src/hooks/useHistory.ts",
            "x\n",
            TextFormat {
                crlf: false,
                encoding: TextEncoding::Utf8,
            },
            None,
        )
        .unwrap();
        let ApplyOutcome::Applied { backup, modified } = outcome else {
            panic!("{outcome:?}")
        };
        assert_eq!(key.as_deref(), Some("src/hooks/useHistory.ts"));
        assert!(root.join("src/hooks/useHistory.ts").is_file());
        assert!(matches!(
            undo(
                &root,
                &backups,
                "src/hooks/useHistory.ts",
                &backup,
                modified
            )
            .unwrap(),
            UndoOutcome::Undone { .. }
        ));
        assert!(!root.join("src/hooks/useHistory.ts").exists());
    }

    #[test]
    fn never_writes_secrets_ignored_files_or_outside() {
        let (root, backups, indexed) = folder("protected");
        let reason = |path: &str| match apply(
            &root,
            &indexed,
            &backups,
            path,
            "x",
            TextFormat::default(),
            None,
        )
        .unwrap()
        .0
        {
            ApplyOutcome::Protected { reason } => reason,
            other => panic!("{other:?}"),
        };
        assert_eq!(reason(".env"), SkipReason::Secret);
        assert_eq!(reason("../fuera.txt"), SkipReason::Outside);
        assert_eq!(reason("node_modules/x.js"), SkipReason::Ignored);
        assert_eq!(reason(".github/ci.yml"), SkipReason::Ignored);
        assert_eq!(reason("logo.png"), SkipReason::Binary);
        assert!(!root.join("node_modules").exists());
    }

    #[test]
    fn undo_keeps_later_changes_and_checks_the_copy_id() {
        let (root, backups, indexed) = folder("undo");
        let (_, modified, _) = file(inspect(&root, &indexed, "src/App.tsx"));
        let (outcome, _) = apply(
            &root,
            &indexed,
            &backups,
            "src/App.tsx",
            "nuevo\n",
            TextFormat {
                crlf: false,
                encoding: TextEncoding::Utf8,
            },
            Some(modified),
        )
        .unwrap();
        let ApplyOutcome::Applied { backup, modified } = outcome else {
            panic!("{outcome:?}")
        };
        assert_eq!(
            undo(&root, &backups, "src/App.tsx", &backup, modified - 1000).unwrap(),
            UndoOutcome::Conflict
        );
        assert!(undo(&root, &backups, "src/App.tsx", "../../etc", modified).is_err());
        // The copy of App.tsx never goes onto another file, even one with the same time
        fs::write(root.join("src/other.ts"), "otro\n").unwrap();
        let other = modified_of(&root.join("src/other.ts")).unwrap();
        assert_eq!(
            undo(&root, &backups, "src/other.ts", &backup, other).unwrap_err(),
            t("native.workspace.copyOfAnother")
        );
        assert_eq!(
            fs::read_to_string(root.join("src/other.ts")).unwrap(),
            "otro\n"
        );
    }
}
