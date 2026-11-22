//! Projects of the Código space: a folder of the user's computer with its conversations inside. Removing one from
//! the list keeps its conversations, so adding the same folder again brings them back.

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::git::{self, GitState};
use crate::i18n::{t, t_with};
use crate::storage::{now_millis, Database};
use crate::util::{is_plain_id, limited_name, to_message};
use crate::workspace::{allowed_root, blocking, remember_root, remembered_root, Workspaces};

pub const SCHEMA: &str = "
    CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        model TEXT,
        added_at INTEGER NOT NULL,
        removed INTEGER NOT NULL DEFAULT 0
    );
    ALTER TABLE conversations ADD COLUMN project_id TEXT;
    CREATE INDEX conversations_project ON conversations (project_id);
";

/// The skills of the Código space turned off in the project, so any new one starts on
pub const SKILLS_SCHEMA: &str =
    "ALTER TABLE projects ADD COLUMN disabled_skills TEXT NOT NULL DEFAULT '[]';";

pub const NAME_MAX: usize = 60;
const SKILL_NAME_MAX: usize = 64;
const MODEL_MAX: usize = 300;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) path: String,
    /// The model new conversations start with; None uses the app's default
    model: Option<String>,
    disabled_skills: Vec<String>,
}

const COLUMNS: &str = "id, name, path, model, disabled_skills";

fn valid_name(name: &str) -> Result<String, String> {
    limited_name(name, NAME_MAX, &t("native.projects.nameEmpty"))
}

fn valid_id(id: &str) -> Result<(), String> {
    is_plain_id(id)
        .then_some(())
        .ok_or_else(|| t("native.projects.invalid"))
}

fn from_row(row: &rusqlite::Row) -> rusqlite::Result<Project> {
    let disabled: String = row.get(4)?;
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        model: row.get(3)?,
        // Written only by Nyra; a damaged value turns every skill on rather than losing the project
        disabled_skills: serde_json::from_str(&disabled).unwrap_or_default(),
    })
}

/// Skill names follow the standard: lowercase letters, digits and hyphens
fn valid_skill_names(names: &[String]) -> Result<(), String> {
    let plain = names.iter().all(|name| {
        !name.is_empty()
            && name.len() <= SKILL_NAME_MAX
            && name
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    });
    if plain {
        Ok(())
    } else {
        Err(t("native.projects.invalidSkill"))
    }
}

fn set_disabled_skills(connection: &Connection, id: &str, names: &[String]) -> Result<(), String> {
    valid_skill_names(names)?;
    let json = serde_json::to_string(names).map_err(|e| e.to_string())?;
    connection
        .execute(
            "UPDATE projects SET disabled_skills = ?2 WHERE id = ?1",
            params![id, json],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// The skills turned off in each project keep being off under the built-ins' English names
pub fn rename_builtin_skills(connection: &Connection) -> rusqlite::Result<()> {
    let rows: Vec<(String, String)> = {
        let mut statement = connection.prepare("SELECT id, disabled_skills FROM projects")?;
        let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for (id, disabled) in rows {
        let Ok(names) = serde_json::from_str::<Vec<String>>(&disabled) else {
            continue;
        };
        let renamed: Vec<&str> = names
            .iter()
            .map(|name| crate::skills::renamed_builtin(name).unwrap_or(name))
            .collect();
        let json = serde_json::to_string(&renamed).unwrap_or(disabled);
        connection.execute(
            "UPDATE projects SET disabled_skills = ?2 WHERE id = ?1",
            params![id, json],
        )?;
    }
    Ok(())
}

fn list(connection: &Connection) -> rusqlite::Result<Vec<Project>> {
    let mut statement =
        connection.prepare(&format!("SELECT {COLUMNS} FROM projects WHERE removed = 0"))?;
    let rows = statement.query_map([], from_row)?;
    rows.collect()
}

/// A folder that was a project before comes back with its id, so its conversations come back too
fn add(connection: &Connection, id: &str, path: &str, name: &str) -> Result<Project, String> {
    valid_id(id)?;
    let name = valid_name(name)?;
    let earlier = connection
        .query_row(
            &format!("SELECT {COLUMNS} FROM projects WHERE path = ?1"),
            params![path],
            from_row,
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(project) = earlier {
        connection
            .execute(
                "UPDATE projects SET removed = 0 WHERE id = ?1",
                params![project.id],
            )
            .map_err(|e| e.to_string())?;
        return Ok(project);
    }
    connection
        .execute(
            "INSERT INTO projects (id, name, path, added_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, name, path, now_millis()],
        )
        .map_err(|e| e.to_string())?;
    Ok(Project {
        id: id.to_string(),
        name,
        path: path.to_string(),
        model: None,
        disabled_skills: Vec::new(),
    })
}

/// Folders too general to become a project on their own when importing: one would give Nyra all of the user's files
/// (their personal folder, what holds it, a drive's root, Desktop, Documents, Downloads) or one made to be thrown
/// away (the temporary folder). The user can still add any of them by hand.
pub struct BroadFolders {
    home: Option<PathBuf>,
    temporary: Vec<PathBuf>,
    standard: Vec<PathBuf>,
}

impl BroadFolders {
    pub fn of(app: &AppHandle) -> Self {
        // Real paths, as the folders compared with them are (on macOS, /tmp is /private/tmp)
        let real = |path: PathBuf| crate::util::real_path(&path).unwrap_or(path);
        let paths = app.path();
        let mut temporary = vec![real(std::env::temp_dir())];
        if cfg!(unix) {
            temporary.push(real(PathBuf::from("/tmp")));
        }
        Self {
            home: paths.home_dir().ok().map(real),
            temporary,
            standard: [
                paths.desktop_dir(),
                paths.document_dir(),
                paths.download_dir(),
            ]
            .into_iter()
            .filter_map(Result::ok)
            .map(real)
            .collect(),
        }
    }

    pub fn contains(&self, folder: &Path) -> bool {
        folder.parent().is_none()
            || self
                .home
                .as_ref()
                .is_some_and(|home| home.starts_with(folder))
            || self.temporary.iter().any(|temp| folder.starts_with(temp))
            || self.standard.iter().any(|standard| standard == folder)
    }
}

/// Where a conversation imported from a folder goes
pub enum ImportedTo {
    Project(Project),
    /// The folder is too general to make a project of (BroadFolders): it stays in the chat
    Chat,
}

/// The project a conversation imported from `folder` belongs to: the listed one whose folder holds it (the closest),
/// or else one made for the folder, allowed as if the user had picked it, since importing it is what they asked. A
/// folder too general for that only goes to a project the user made of it before (listed, or removed from the list).
pub fn project_for_import(
    connection: &Connection,
    folder: &Path,
    new_id: &str,
    broad: &BroadFolders,
) -> Result<ImportedTo, String> {
    let holding = list(connection)
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|project| folder.starts_with(&project.path))
        .max_by_key(|project| project.path.len());
    if let Some(project) = holding {
        return Ok(ImportedTo::Project(project));
    }
    let path = folder.to_string_lossy();
    if broad.contains(folder) && !was_project(connection, &path)? {
        return Ok(ImportedTo::Chat);
    }
    remember_root(connection, &path).map_err(|e| e.to_string())?;
    let name: String = folder
        .file_name()
        .map_or_else(
            || path.to_string(),
            |name| name.to_string_lossy().into_owned(),
        )
        .chars()
        .take(NAME_MAX)
        .collect();
    add(connection, new_id, &path, &name).map(ImportedTo::Project)
}

fn was_project(connection: &Connection, path: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE path = ?1",
            params![path],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .map_err(|e| e.to_string())
}

fn rename(connection: &Connection, id: &str, name: &str) -> Result<String, String> {
    let name = valid_name(name)?;
    connection
        .execute(
            "UPDATE projects SET name = ?2 WHERE id = ?1",
            params![id, name],
        )
        .map_err(|e| e.to_string())?;
    Ok(name)
}

fn set_model(connection: &Connection, id: &str, model: Option<&str>) -> Result<(), String> {
    if model.is_some_and(|m| m.len() > MODEL_MAX) {
        return Err(t("native.projects.invalidModel"));
    }
    connection
        .execute(
            "UPDATE projects SET model = ?2 WHERE id = ?1",
            params![id, model],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// The folder was moved or renamed: the project and its conversations follow it to the new place
fn relocate(connection: &Connection, id: &str, path: &str) -> Result<Project, String> {
    let owner: Option<(String, String, bool)> = connection
        .query_row(
            "SELECT id, name, removed FROM projects WHERE path = ?1",
            params![path],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((owner_id, owner_name, removed)) = owner {
        if owner_id != id {
            let name = [("name", owner_name.as_str())];
            return Err(if removed {
                t_with("native.projects.folderWasRemoved", &name)
            } else {
                t_with("native.projects.folderTaken", &name)
            });
        }
    }
    let old: String = connection
        .query_row(
            "SELECT path FROM projects WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let transaction = connection
        .unchecked_transaction()
        .map_err(|e| e.to_string())?;
    // Its vectors for searching by meaning go with it, so they aren't made again; only if the new place has none
    transaction
        .execute(
            "UPDATE workspace_chunks SET root = ?2 WHERE root = ?1
             AND NOT EXISTS (SELECT 1 FROM workspace_chunks WHERE root = ?2)",
            params![old, path],
        )
        .map_err(|e| e.to_string())?;
    transaction
        .execute(
            "UPDATE projects SET path = ?2 WHERE id = ?1",
            params![id, path],
        )
        .map_err(|e| e.to_string())?;
    transaction
        .execute(
            "UPDATE conversations SET data = json_set(data, '$.workspace.path', ?2) WHERE project_id = ?1",
            params![id, path],
        )
        .map_err(|e| e.to_string())?;
    let project = transaction
        .query_row(
            &format!("SELECT {COLUMNS} FROM projects WHERE id = ?1"),
            params![id],
            from_row,
        )
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(project)
}

/// Undoing "Quitar de la lista" right after: the folder had been picked by the user, so it is allowed again
fn restore(connection: &Connection, id: &str) -> rusqlite::Result<Project> {
    let transaction = connection.unchecked_transaction()?;
    transaction.execute("UPDATE projects SET removed = 0 WHERE id = ?1", params![id])?;
    let project = transaction.query_row(
        &format!("SELECT {COLUMNS} FROM projects WHERE id = ?1"),
        params![id],
        from_row,
    )?;
    remember_root(&transaction, &project.path)?;
    transaction.commit()?;
    Ok(project)
}

/// Only out of the list: the folder and the conversations stay
fn remove(connection: &Connection, id: &str) -> rusqlite::Result<()> {
    connection
        .execute("UPDATE projects SET removed = 1 WHERE id = ?1", params![id])
        .map(|_| ())
}

/// Something in a project's conversation waiting for the user: a proposed change not reviewed yet, or a command
/// waiting for permission to run
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PendingItem {
    project_id: String,
    conversation_id: String,
    message_index: i64,
    /// "change", "command" or "commit" (a commit proposed and not done yet)
    kind: String,
    id: String,
    /// The file of a change, the command line of a command
    label: String,
    /// A change that creates the file
    is_new: bool,
}

/// Read from what is saved; the conversations open in Nyra are newer and replace these. A conversation whose text
/// doesn't even contain "pending" is skipped before its JSON is taken apart.
fn pending(connection: &Connection) -> rusqlite::Result<Vec<PendingItem>> {
    // Only conversations whose data is sound and messages that are objects: one damaged row (a JSON that doesn't
    // parse, a message that is a string) must not make the whole list fail. MATERIALIZED keeps that filter first.
    let mut statement = connection.prepare(
        "WITH message AS MATERIALIZED (
             SELECT c.project_id, c.id, m.key, m.value
             FROM conversations c
             JOIN projects p ON p.id = c.project_id AND p.removed = 0,
                  json_each(c.data, '$.messages') m
             WHERE instr(c.data, '\"pending\"') > 0
                   AND json_valid(c.data) AND json_type(c.data, '$.messages') = 'array' AND m.type = 'object'
         )
         SELECT message.project_id, message.id, message.key, 'change', json_extract(item.value, '$.id'),
                json_extract(item.value, '$.path'), json_extract(item.value, '$.kind') = 'create'
         FROM message, json_each(message.value, '$.workspaceChanges') item
         WHERE item.type = 'object' AND json_extract(item.value, '$.status') = 'pending'
         UNION ALL
         SELECT message.project_id, message.id, message.key, 'command', json_extract(item.value, '$.id'),
                json_extract(item.value, '$.command'), 0
         FROM message, json_each(message.value, '$.commands') item
         WHERE item.type = 'object' AND json_extract(item.value, '$.state') = 'pending'
         UNION ALL
         SELECT message.project_id, message.id, message.key, 'commit', 'commit-' || message.key,
                json_extract(message.value, '$.commitProposal.message'), 0
         FROM message
         WHERE json_extract(message.value, '$.commitProposal.status') = 'pending'",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(PendingItem {
            project_id: row.get(0)?,
            conversation_id: row.get(1)?,
            message_index: row.get(2)?,
            kind: row.get(3)?,
            id: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
            label: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
            is_new: row.get::<_, Option<bool>>(6)?.unwrap_or(false),
        })
    })?;
    rows.collect()
}

/// On a reader of its own, off the async threads: it walks every project conversation, and on the shared connection
/// each save would wait for it
#[tauri::command]
pub async fn projects_pending(app: AppHandle) -> Result<Vec<PendingItem>, String> {
    blocking(move || pending(&Database::open_reader(&app)?).map_err(to_message)).await?
}

#[tauri::command]
pub async fn project_git_changes(
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    root: String,
) -> Result<git::GitChanges, String> {
    let root = allowed_root(&db, &workspaces, &root)?;
    blocking(move || git::changes(&root)).await
}

/// The commit the user approved on its card
#[tauri::command]
pub async fn project_commit(
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    root: String,
    message: String,
    paths: Vec<String>,
) -> Result<String, String> {
    let root = allowed_root(&db, &workspaces, &root)?;
    blocking(move || git::commit(&root, &message, &paths)).await?
}

#[tauri::command]
pub async fn project_git_diff(
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    root: String,
    path: String,
    status: char,
) -> Result<git::GitDiff, String> {
    let root = allowed_root(&db, &workspaces, &root)?;
    blocking(move || git::diff(&root, &path, status)).await?
}

#[derive(Serialize, Debug)]
pub struct ProjectStatus {
    /// The folder isn't where it was: moved, renamed, deleted or on a disconnected disk
    missing: bool,
    /// None while the folder is missing
    git: Option<GitState>,
}

#[tauri::command]
pub async fn project_status(
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    root: String,
) -> Result<ProjectStatus, String> {
    let root = allowed_root(&db, &workspaces, &root)?;
    blocking(move || {
        if root.is_dir() {
            ProjectStatus {
                missing: false,
                git: Some(git::state(&root)),
            }
        } else {
            ProjectStatus {
                missing: true,
                git: None,
            }
        }
    })
    .await
}

/// «Iniciar repositorio» on a project's home
#[tauri::command]
pub async fn init_project_git(
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    root: String,
) -> Result<(), String> {
    let root = allowed_root(&db, &workspaces, &root)?;
    blocking(move || git::init(&root)).await?
}

/// The new place must have been picked by the user first (pick_workspace_folder).
#[tauri::command]
pub async fn relocate_project(
    db: State<'_, Database>,
    id: String,
    path: String,
) -> Result<Project, String> {
    remembered_root(&db, &path)?;
    db.try_with(|c| relocate(c, &id, &path))
}

#[tauri::command]
pub async fn restore_project(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    id: String,
) -> Result<Project, String> {
    let project = db.with(|c| restore(c, &id))?;
    // Its conversations come back to the icon's recent ones with it
    crate::tray::refresh_recent(&app);
    Ok(project)
}

#[tauri::command]
pub async fn list_projects(db: State<'_, Database>) -> Result<Vec<Project>, String> {
    db.with(list)
}

/// The folder must have been picked by the user first (pick_workspace_folder) and kept: never one of a private
/// conversation, which is only allowed until Nyra closes.
#[tauri::command]
pub async fn add_project(
    db: State<'_, Database>,
    id: String,
    path: String,
    name: String,
) -> Result<Project, String> {
    remembered_root(&db, &path)?;
    db.try_with(|c| add(c, &id, &path, &name))
}

/// Returns the name as stored (trimmed).
#[tauri::command]
pub async fn rename_project(
    db: State<'_, Database>,
    id: String,
    name: String,
) -> Result<String, String> {
    db.try_with(|c| rename(c, &id, &name))
}

#[tauri::command]
pub async fn set_project_model(
    db: State<'_, Database>,
    id: String,
    model: Option<String>,
) -> Result<(), String> {
    db.try_with(|c| set_model(c, &id, model.as_deref()))
}

#[tauri::command]
pub async fn set_project_disabled_skills(
    db: State<'_, Database>,
    id: String,
    names: Vec<String>,
) -> Result<(), String> {
    db.try_with(|c| set_disabled_skills(c, &id, &names))
}

#[tauri::command]
pub async fn remove_project(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    id: String,
) -> Result<(), String> {
    db.with(|c| remove(c, &id))?;
    crate::tray::refresh_recent(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, data TEXT);
                 CREATE TABLE workspace_roots (path TEXT PRIMARY KEY, added_at INTEGER NOT NULL);",
            )
            .unwrap();
        connection.execute_batch(SCHEMA).unwrap();
        connection.execute_batch(SKILLS_SCHEMA).unwrap();
        connection
            .execute_batch(crate::workspace::meaning::SCHEMA)
            .unwrap();
        connection
    }

    fn broad() -> BroadFolders {
        BroadFolders {
            home: Some(PathBuf::from("/Users/marta")),
            temporary: vec![PathBuf::from("/tmp")],
            standard: vec![PathBuf::from("/Users/marta/Documents")],
        }
    }

    fn project_of(imported: ImportedTo) -> Project {
        match imported {
            ImportedTo::Project(project) => project,
            ImportedTo::Chat => panic!("expected a project"),
        }
    }

    #[test]
    fn an_import_goes_to_the_project_holding_its_folder_or_makes_one() {
        let c = database();
        let broad = broad();
        add(&c, "p1", "/proyectos/tienda", "tienda").unwrap();
        let inside = project_of(
            project_for_import(&c, Path::new("/proyectos/tienda/web"), "nuevo", &broad).unwrap(),
        );
        assert_eq!(inside.id, "p1");
        // A sibling folder with the same start is not inside it
        let made = project_of(
            project_for_import(&c, Path::new("/proyectos/tiendas"), "nuevo", &broad).unwrap(),
        );
        assert_eq!((made.id.as_str(), made.name.as_str()), ("nuevo", "tiendas"));
        let allowed: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM workspace_roots WHERE path = '/proyectos/tiendas'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(allowed, 1);
        // A removed project of that same folder comes back instead of a new one
        remove(&c, "nuevo").unwrap();
        let back = project_of(
            project_for_import(&c, Path::new("/proyectos/tiendas"), "otro", &broad).unwrap(),
        );
        assert_eq!(back.id, "nuevo");
    }

    #[test]
    fn a_folder_too_general_stays_in_the_chat_unless_the_user_made_it_a_project() {
        let c = database();
        let broad = broad();
        for folder in [
            "/Users/marta",
            "/Users",
            "/",
            "/tmp/sesion",
            "/Users/marta/Documents",
        ] {
            assert!(
                matches!(
                    project_for_import(&c, Path::new(folder), "nuevo", &broad).unwrap(),
                    ImportedTo::Chat
                ),
                "{folder}"
            );
        }
        let none: i64 = c
            .query_row("SELECT COUNT(*) FROM workspace_roots", [], |row| row.get(0))
            .unwrap();
        assert_eq!(none, 0);
        // What is inside them is a project like any other
        let inside =
            project_for_import(&c, Path::new("/Users/marta/Documents/web"), "web", &broad).unwrap();
        assert!(matches!(inside, ImportedTo::Project(_)));
        // The personal folder made a project by hand, even removed from the list since
        add(&c, "casa", "/Users/marta", "marta").unwrap();
        remove(&c, "casa").unwrap();
        let home =
            project_of(project_for_import(&c, Path::new("/Users/marta"), "nuevo", &broad).unwrap());
        assert_eq!(home.id, "casa");
    }

    #[test]
    fn finds_what_waits_for_the_user_in_each_project() {
        let db = database();
        add(&db, "p1", "/a/web", "web").unwrap();
        db.execute_batch(
            r#"INSERT INTO conversations VALUES ('c1', 'Uno', '{"messages":[
                 {"role":"user","content":"a"},
                 {"role":"assistant","content":"b",
                  "workspaceChanges":[{"id":"x1","path":"src/a.ts","kind":"edit","status":"pending"},
                                      {"id":"x2","path":"src/b.ts","kind":"create","status":"applied"}],
                  "commands":[{"id":"r1","command":"npm test","state":"pending"},
                              {"id":"r2","command":"ls","state":"done"}],
                  "commitProposal":{"message":"Add prices","status":"pending"}}]}', 'p1');
               INSERT INTO conversations VALUES ('c2', 'Chat', '{"messages":[{"role":"assistant","content":"",
                 "workspaceChanges":[{"id":"y","path":"z","kind":"edit","status":"pending"}]}]}', NULL);"#,
        )
        .unwrap();
        let found = pending(&db).unwrap();
        assert_eq!(found.len(), 3);
        assert_eq!(found[2].kind, "commit");
        assert_eq!(found[2].label, "Add prices");
        assert_eq!(found[0].label, "src/a.ts");
        assert_eq!(found[0].message_index, 1);
        assert_eq!(found[1].kind, "command");
        assert_eq!(found[1].label, "npm test");
        // A damaged conversation of the project doesn't take the others' items with it
        db.execute_batch(
            r#"INSERT INTO conversations VALUES ('c3', 'Rota', '{"messages":["pending", 3, {"workspaceChanges":["x"]}', 'p1');
               INSERT INTO conversations VALUES ('c4', 'Rara', '{"messages":["pending", {"commands":[7, "pending"]}]}', 'p1');"#,
        )
        .unwrap();
        assert_eq!(pending(&db).unwrap().len(), 3);
        remove(&db, "p1").unwrap();
        assert!(pending(&db).unwrap().is_empty());
    }

    #[test]
    fn turned_off_skills_are_kept_and_names_checked() {
        let db = database();
        add(&db, "p1", "/a/web", "web").unwrap();
        assert!(list(&db).unwrap()[0].disabled_skills.is_empty());
        set_disabled_skills(&db, "p1", &["commit-and-pr".to_string()]).unwrap();
        assert_eq!(list(&db).unwrap()[0].disabled_skills, ["commit-and-pr"]);
        assert!(set_disabled_skills(&db, "p1", &["../x".to_string()]).is_err());
    }

    #[test]
    fn a_moved_folder_takes_the_project_and_its_conversations_along() {
        let db = database();
        add(&db, "p1", "/a/web", "web").unwrap();
        add(&db, "p2", "/a/api", "api").unwrap();
        db.execute_batch(
            "INSERT INTO conversations VALUES
                 ('c1', 'Uno', '{\"workspace\":{\"path\":\"/a/web\",\"name\":\"web\"}}', 'p1');",
        )
        .unwrap();
        db.execute_batch(
            "INSERT INTO workspace_chunks VALUES ('/a/web', 'src/a.ts', 1, 1, 9, 'm', x'00');",
        )
        .unwrap();
        assert!(relocate(&db, "p1", "/a/api").is_err());
        assert_eq!(relocate(&db, "p1", "/b/web").unwrap().path, "/b/web");
        let moved: String = db
            .query_row("SELECT root FROM workspace_chunks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(moved, "/b/web");
        remove(&db, "p2").unwrap();
        let taken = relocate(&db, "p1", "/a/api").unwrap_err();
        assert_eq!(
            taken,
            t_with("native.projects.folderWasRemoved", &[("name", "api")])
        );
        let path: String = db
            .query_row(
                "SELECT json_extract(data, '$.workspace.path') FROM conversations WHERE id = 'c1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(path, "/b/web");
    }

    #[test]
    fn restoring_brings_the_project_back_with_its_folder_allowed() {
        let db = database();
        add(&db, "p1", "/a/web", "web").unwrap();
        remove(&db, "p1").unwrap();
        assert_eq!(restore(&db, "p1").unwrap().path, "/a/web");
        assert_eq!(list(&db).unwrap().len(), 1);
        let allowed: i64 = db
            .query_row("SELECT COUNT(*) FROM workspace_roots", [], |row| row.get(0))
            .unwrap();
        assert_eq!(allowed, 1);
    }

    #[test]
    fn names_are_trimmed_and_limited() {
        let db = database();
        assert_eq!(add(&db, "p1", "/a/web", "  web ").unwrap().name, "web");
        assert!(rename(&db, "p1", "  ").is_err());
        assert!(rename(&db, "p1", &"a".repeat(61)).is_err());
        assert_eq!(rename(&db, "p1", "Tienda web").unwrap(), "Tienda web");
        assert!(add(&db, "../x", "/a/otra", "otra").is_err());
    }

    #[test]
    fn adding_a_removed_folder_again_brings_the_same_project_back() {
        let db = database();
        add(&db, "p1", "/a/web", "web").unwrap();
        set_model(&db, "p1", Some("ollama:qwen")).unwrap();
        remove(&db, "p1").unwrap();
        assert!(list(&db).unwrap().is_empty());
        let again = add(&db, "p2", "/a/web", "web").unwrap();
        assert_eq!(again.id, "p1");
        assert_eq!(again.model.as_deref(), Some("ollama:qwen"));
        assert_eq!(list(&db).unwrap().len(), 1);
    }
}
