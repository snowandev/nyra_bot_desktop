use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::attachments;
use crate::code_runs;
use crate::command_outputs;
use crate::folders;
use crate::i18n::{t, t_with};
use crate::memories;
use crate::projects;
use crate::search;
use crate::util::{data_dir, to_message};
use crate::workspace;

mod migrations;
use migrations::*;

/// Conversations live in a SQLite file inside the app's data directory.
/// The frontend only gets these commands, never raw SQL.
pub struct Database(Mutex<Connection>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMeta {
    id: String,
    title: String,
    updated_at: i64,
    pinned: bool,
    folder_id: Option<String>,
    project_id: Option<String>,
}

pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// How a conversation is being written: from the app, or brought in by an import.
enum Origin {
    App,
    Import { message_count: usize },
}

const DATABASE_FILE: &str = "nyra.db";

impl Database {
    pub fn open(app: &AppHandle) -> Result<Self, String> {
        let dir = data_dir(app)?;
        std::fs::create_dir_all(&dir).map_err(to_message)?;
        let connection = Connection::open(dir.join(DATABASE_FILE)).map_err(to_message)?;
        migrate(&connection)?;
        // With WAL a commit no longer waits for the disk on every save: a power cut can lose the last save, never
        // corrupt the database
        connection
            .execute_batch("PRAGMA synchronous = NORMAL;")
            .map_err(to_message)?;
        Ok(Self(Mutex::new(connection)))
    }

    /// A connection of its own for a long read, so it doesn't hold up saving; WAL lets it read while others write
    pub(crate) fn open_reader(app: &AppHandle) -> Result<Connection, String> {
        let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
        Connection::open_with_flags(data_dir(app)?.join(DATABASE_FILE), flags).map_err(to_message)
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>, String> {
        self.0.lock().map_err(|_| t("native.storage.unavailable"))
    }

    pub(crate) fn with<T>(
        &self,
        run: impl FnOnce(&Connection) -> rusqlite::Result<T>,
    ) -> Result<T, String> {
        run(&*self.lock()?).map_err(to_message)
    }

    /// For operations that already explain their own errors to the user
    pub(crate) fn try_with<T>(
        &self,
        run: impl FnOnce(&Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        run(&*self.lock()?)
    }

    fn set_pinned(&self, id: &str, pinned: bool) -> Result<(), String> {
        self.with(|c| {
            c.execute(
                "UPDATE conversations SET pinned = ?2 WHERE id = ?1",
                params![id, pinned],
            )
            .map(|_| ())
        })
    }

    fn rename(&self, id: &str, title: &str) -> Result<(), String> {
        let title = title.trim();
        if title.is_empty() {
            return Err(t("native.storage.titleEmpty"));
        }
        if title.chars().count() > TITLE_MAX {
            return Err(t_with(
                "native.storage.titleTooLong",
                &[("max", &TITLE_MAX.to_string())],
            ));
        }
        self.with(|c| {
            c.execute(
                "UPDATE conversations SET title = ?2, renamed = 1 WHERE id = ?1",
                params![id, title],
            )
            .map(|_| ())
        })
    }

    /// Writes the conversation and its attachments in one transaction, so they never get out of step.
    fn store(
        &self,
        id: &str,
        title: &str,
        updated_at: i64,
        data: &str,
        origin: Origin,
    ) -> Result<(), String> {
        let mut data: Value = serde_json::from_str(data).map_err(to_message)?;
        // A column, so the lists of each space are read without opening every conversation
        let project_id = data
            .as_object_mut()
            .and_then(|fields| fields.remove("projectId"))
            .and_then(|value| value.as_str().map(str::to_string));
        let connection = self.lock()?;
        let transaction = connection.unchecked_transaction().map_err(to_message)?;
        // Before the content moves to the attachments table, while new files still carry their text
        search::index_new_attachments(&transaction, id, &data).map_err(to_message)?;
        let used = attachments::move_out(&transaction, id, &mut data).map_err(to_message)?;
        attachments::delete_unused(&transaction, id, &used).map_err(to_message)?;
        let runs = command_outputs::move_out(&transaction, id, &mut data).map_err(to_message)?;
        command_outputs::delete_unused(&transaction, id, &runs).map_err(to_message)?;
        search::keep_attachments(&transaction, id, &used).map_err(to_message)?;
        search::index_messages(&transaction, id, &data).map_err(to_message)?;
        let data = data.to_string();
        match origin {
            // Any save from the app means the conversation changed here, which matters if it was imported.
            // A re-import keeps a title the user chose (renamed).
            Origin::App => transaction.execute(
                "INSERT INTO conversations (id, title, updated_at, data, edited, project_id)
                 VALUES (?1, ?2, ?3, ?4, 1, ?5)
                 ON CONFLICT(id) DO UPDATE SET title = ?2, updated_at = ?3, data = ?4, edited = 1,
                     project_id = COALESCE(?5, project_id)",
                params![id, title, updated_at, data, project_id],
            ),
            Origin::Import { message_count } => transaction.execute(
                "INSERT INTO conversations (id, title, updated_at, data, edited, imported_count, project_id)
                 VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET
                     title = CASE WHEN renamed THEN title ELSE ?2 END,
                     updated_at = ?3, data = ?4, edited = 0, imported_count = ?5,
                     project_id = COALESCE(?6, project_id)",
                params![id, title, updated_at, data, message_count as i64, project_id],
            ),
        }
        .map_err(to_message)?;
        transaction.commit().map_err(to_message)
    }

    pub fn save(&self, id: &str, title: &str, data: &str) -> Result<(), String> {
        self.store(id, title, now_millis(), data, Origin::App)
    }

    /// Stores an imported conversation as untouched, remembering how many messages came from the source.
    pub fn save_imported(&self, conversation: &ImportedConversation) -> Result<(), String> {
        let origin = Origin::Import {
            message_count: conversation.message_count,
        };
        self.store(
            &conversation.id,
            &conversation.title,
            conversation.updated_at,
            &conversation.data,
            origin,
        )
    }

    pub fn read_pdfs(&self, conversation_id: &str) -> Result<HashMap<String, Value>, String> {
        self.with(|c| attachments::read_pdfs(c, conversation_id))
    }

    /// Fills in an imported PDF stored before its text was read: only what reading it gives (text, pages, images)
    /// is taken, and the conversation itself isn't touched, so it still counts as not continued.
    pub fn complete_pending_pdf(&self, conversation_id: &str, read: &Value) -> Result<(), String> {
        let id = read["id"]
            .as_str()
            .ok_or_else(|| t("native.storage.attachmentGone"))?;
        let connection = self.lock()?;
        let stored: Option<String> = connection
            .query_row(
                "SELECT data FROM attachments WHERE conversation_id = ?1 AND id = ?2",
                params![conversation_id, id],
                |row| row.get(0),
            )
            .optional()
            .map_err(to_message)?;
        let mut attachment: Value = stored
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .ok_or_else(|| t("native.storage.attachmentGone"))?;
        let pending = attachment["kind"] == "pdf" && attachment.get("pageCount").is_none();
        if !pending {
            return Ok(());
        }
        for field in ["data", "pageCount", "visuals", "visualsUpToPage"] {
            if let Some(value) = read.get(field) {
                attachment[field] = value.clone();
            }
        }
        let transaction = connection.unchecked_transaction().map_err(to_message)?;
        transaction
            .execute(
                "UPDATE attachments SET data = ?3 WHERE conversation_id = ?1 AND id = ?2",
                params![conversation_id, id, attachment.to_string()],
            )
            .map_err(to_message)?;
        search::index_completed_attachment(&transaction, conversation_id, &attachment)
            .map_err(to_message)?;
        transaction.commit().map_err(to_message)
    }

    /// The latest conversations, newest first, for the icon's menu: those of a project taken out of the list stay out
    /// with it, as they do in the app
    pub fn recent(&self, limit: usize) -> Result<Vec<(String, String)>, String> {
        self.with(|c| {
            let mut statement = c.prepare(
                "SELECT id, title FROM conversations
                 WHERE project_id IS NULL OR project_id IN (SELECT id FROM projects WHERE removed = 0)
                 ORDER BY updated_at DESC LIMIT ?1",
            )?;
            let rows = statement.query_map(params![limit as i64], |row| Ok((row.get(0)?, row.get(1)?)))?;
            rows.collect()
        })
    }

    pub fn load(&self, id: &str) -> Result<Option<String>, String> {
        let connection = self.lock()?;
        let raw: Option<String> = connection
            .query_row(
                "SELECT data FROM conversations WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(to_message)?;
        let Some(raw) = raw else {
            return Ok(None);
        };
        let mut data: Value = serde_json::from_str(&raw).map_err(to_message)?;
        attachments::fill_in(&connection, id, &mut data).map_err(to_message)?;
        command_outputs::fill_in(&connection, id, &mut data).map_err(to_message)?;
        Ok(Some(data.to_string()))
    }

    /// All or nothing: a conversation left without its attachments would lose them for good
    pub fn delete(&self, id: &str) -> Result<(), String> {
        self.with(|c| {
            let transaction = c.unchecked_transaction()?;
            transaction.execute(
                "DELETE FROM attachments WHERE conversation_id = ?1",
                params![id],
            )?;
            command_outputs::forget(&transaction, id)?;
            search::forget(&transaction, id)?;
            transaction.execute("DELETE FROM conversations WHERE id = ?1", params![id])?;
            transaction.commit()
        })
    }

    /// How each imported conversation looks in Nyra, keyed by id.
    pub fn imported_states(&self, prefix: &str) -> Result<HashMap<String, ImportedState>, String> {
        self.with(|c| {
            let mut statement = c.prepare(
                "SELECT id, edited, imported_count, json_array_length(data, '$.messages')
                 FROM conversations WHERE substr(id, 1, length(?1)) = ?1",
            )?;
            let rows = statement.query_map(params![prefix], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    ImportedState {
                        edited: row.get(1)?,
                        imported_count: row.get::<_, Option<i64>>(2)?.unwrap_or(0) as usize,
                        message_count: row.get::<_, Option<i64>>(3)?.unwrap_or(0) as usize,
                    },
                ))
            })?;
            rows.collect()
        })
    }
}

pub struct ImportedConversation {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
    pub data: String,
    pub message_count: usize,
}

pub struct ImportedState {
    /// Saved from Nyra since it was imported, so re-importing must not overwrite it
    pub edited: bool,
    pub imported_count: usize,
    pub message_count: usize,
}

const TITLE_MAX: usize = 120;

#[tauri::command]
pub async fn list_conversations(db: State<'_, Database>) -> Result<Vec<ConversationMeta>, String> {
    db.with(|c| {
        let mut statement = c.prepare(
            "SELECT id, title, updated_at, pinned, folder_id, project_id FROM conversations
             ORDER BY updated_at DESC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(ConversationMeta {
                id: row.get(0)?,
                title: row.get(1)?,
                updated_at: row.get(2)?,
                pinned: row.get(3)?,
                folder_id: row.get(4)?,
                project_id: row.get(5)?,
            })
        })?;
        rows.collect()
    })
}

#[tauri::command]
pub async fn load_conversation(app: AppHandle, id: String) -> Result<Option<String>, String> {
    workspace::blocking(move || app.state::<Database>().load(&id)).await?
}

/// Attachments the app knows are stored can arrive as `{ id }`, so their content isn't sent again.
#[tauri::command]
pub async fn save_conversation(
    app: AppHandle,
    id: String,
    title: String,
    data: String,
) -> Result<(), String> {
    // A long conversation is megabytes of JSON to read, index and write, and it is saved while a reply streams
    workspace::blocking(move || {
        app.state::<Database>().save(&id, &title, &data)?;
        crate::tray::refresh_recent(&app);
        Ok(())
    })
    .await?
}

/// Only the flag changes: pinning must not move the conversation in the list (updated_at) nor count as
/// continuing an imported one (edited).
#[tauri::command]
pub async fn set_conversation_pinned(
    db: State<'_, Database>,
    id: String,
    pinned: bool,
) -> Result<(), String> {
    db.set_pinned(&id, pinned)
}

/// Like pinning, renaming keeps the conversation's place in the list and its import state.
#[tauri::command]
pub async fn rename_conversation(
    app: AppHandle,
    db: State<'_, Database>,
    id: String,
    title: String,
) -> Result<(), String> {
    db.rename(&id, &title)?;
    crate::tray::refresh_recent(&app);
    Ok(())
}

#[tauri::command]
pub async fn delete_conversation(
    app: AppHandle,
    db: State<'_, Database>,
    id: String,
) -> Result<(), String> {
    db.delete(&id)?;
    // The folder where its programs ran, with what they created
    code_runs::forget(&app, &id);
    crate::browser::close_for(&app, &id);
    crate::screen_look::forget(&app, &id);
    crate::transcription::sweep_audio(&app);
    crate::tray::refresh_recent(&app);
    Ok(())
}

/// Returns how many conversations were deleted.
#[tauri::command]
pub async fn delete_all_conversations(
    app: AppHandle,
    db: State<'_, Database>,
) -> Result<usize, String> {
    let deleted = db.with(|c| {
        let transaction = c.unchecked_transaction()?;
        transaction.execute("DELETE FROM attachments", [])?;
        transaction.execute("DELETE FROM command_outputs", [])?;
        search::forget_all(&transaction)?;
        let deleted = transaction.execute("DELETE FROM conversations", [])?;
        transaction.commit()?;
        Ok(deleted)
    })?;
    code_runs::forget_all(&app);
    crate::browser::close_all(&app);
    crate::transcription::sweep_audio(&app);
    crate::tray::refresh_recent(&app);
    Ok(deleted)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn in_memory() -> Database {
        let connection = Connection::open_in_memory().expect("in-memory database");
        migrate(&connection).expect("migrations");
        Database(Mutex::new(connection))
    }

    #[test]
    fn lists_the_latest_conversations_without_those_of_removed_projects() {
        let db = in_memory();
        db.with(|c| {
            c.execute_batch(
                "INSERT INTO projects (id, name, path, added_at) VALUES ('kept', 'Web', '/a', 0), ('gone', 'Old', '/b', 0);
                 UPDATE projects SET removed = 1 WHERE id = 'gone';",
            )
        })
        .unwrap();
        let empty = r#"{"messages":[]}"#;
        db.store("a", "Viaje", 1, empty, Origin::App).unwrap();
        db.store(
            "b",
            "Recetas",
            3,
            r#"{"messages":[],"projectId":"kept"}"#,
            Origin::App,
        )
        .unwrap();
        db.store(
            "c",
            "Oculta",
            4,
            r#"{"messages":[],"projectId":"gone"}"#,
            Origin::App,
        )
        .unwrap();
        db.store("d", "Notas", 2, empty, Origin::App).unwrap();
        let titles =
            |list: Vec<(String, String)>| list.into_iter().map(|(_, t)| t).collect::<Vec<_>>();
        assert_eq!(titles(db.recent(5).unwrap()), ["Recetas", "Notas", "Viaje"]);
        assert_eq!(titles(db.recent(2).unwrap()), ["Recetas", "Notas"]);
    }

    fn imported(id: &str, message_count: usize) -> ImportedConversation {
        ImportedConversation {
            id: id.to_string(),
            title: "Importada".to_string(),
            updated_at: 1,
            data:
                r#"{"messages":[{"role":"user","content":"a"},{"role":"assistant","content":"b"}]}"#
                    .to_string(),
            message_count,
        }
    }

    #[test]
    fn the_project_is_kept_in_its_column_and_never_lost_by_a_later_save() {
        let db = in_memory();
        db.save("c1", "Uno", r#"{"messages":[],"projectId":"p1"}"#)
            .unwrap();
        db.save("c1", "Uno", r#"{"messages":[]}"#).unwrap();
        let (project, data): (Option<String>, String) = db
            .with(|c| {
                c.query_row(
                    "SELECT project_id, data FROM conversations WHERE id = 'c1'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
            })
            .unwrap();
        assert_eq!(project.as_deref(), Some("p1"));
        assert!(!data.contains("projectId"));
    }

    #[test]
    fn migrations_run_once_and_can_run_again() {
        let connection = Connection::open_in_memory().unwrap();
        migrate(&connection).unwrap();
        migrate(&connection).unwrap();
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn renames_the_built_in_skills_a_conversation_refers_to_but_not_its_text() {
        let mut data: Value = serde_json::from_str(
            r#"{"skills":["resumir","mia"],"taskSkill":"commit-y-pr","messages":[
                {"role":"user","content":"resumir","skill":"explicar"},
                {"role":"assistant","content":"Hola","skillsUsed":["lluvia-de-ideas"],
                 "versions":[{"skillsUsed":["depurar"]}]}]}"#,
        )
        .unwrap();
        assert!(rename_skills_in(&mut data));
        assert_eq!(data["skills"], serde_json::json!(["summarize", "mia"]));
        assert_eq!(data["taskSkill"], "commit-and-pr");
        assert_eq!(data["messages"][0]["content"], "resumir");
        assert_eq!(data["messages"][0]["skill"], "explain");
        // No longer comes with Nyra, so it has no new name; a copy the user kept has the old one
        assert_eq!(data["messages"][1]["skillsUsed"][0], "lluvia-de-ideas");
        assert_eq!(data["messages"][1]["versions"][0]["skillsUsed"][0], "debug");
        assert!(!rename_skills_in(&mut data));
    }

    #[test]
    fn upgrades_a_database_created_before_the_import_columns() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL,
                 updated_at INTEGER NOT NULL, data TEXT NOT NULL);
                 INSERT INTO conversations VALUES ('old', 'Vieja', 1, '{\"messages\":[]}');",
            )
            .unwrap();
        migrate(&connection).unwrap();
        let edited: bool = connection
            .query_row(
                "SELECT edited FROM conversations WHERE id = 'old'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!edited);
    }

    #[test]
    fn saved_conversations_are_searchable_until_deleted() {
        let db = in_memory();
        let data = r#"{"messages":[{"role":"user","content":"x","attachments":[
            {"id":"f","kind":"text","name":"notas.txt","mimeType":"text/plain","data":"receta de paella"}]},
            {"role":"assistant","content":"Hola"}]}"#;
        db.save("c", "Cocina", data).unwrap();
        // The next save sends the stored file as just its id; its text must stay searchable
        db.save(
            "c",
            "Cocina",
            r#"{"messages":[{"role":"user","content":"x","attachments":[{"id":"f"}]},
            {"role":"assistant","content":"Hola"}]}"#,
        )
        .unwrap();
        assert_eq!(db.with(|c| search::search(c, "paella")).unwrap().len(), 1);
        db.delete("c").unwrap();
        assert!(db.with(|c| search::search(c, "paella")).unwrap().is_empty());
    }

    #[test]
    fn upgrading_moves_saved_outputs_to_their_table_and_loads_them_back() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL,
                 updated_at INTEGER NOT NULL, data TEXT NOT NULL);
                 PRAGMA user_version = 1;",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO conversations VALUES ('old', 'Vieja', 1, ?1)",
                params![r#"{"messages":[{"role":"assistant","content":"Hecho",
                    "commands":[{"id":"cmd-1","command":"npm test","state":"done","output":"3 tests pasan"}]}]}"#],
            )
            .unwrap();
        migrate(&connection).unwrap();
        let stored: String = connection
            .query_row(
                "SELECT data FROM conversations WHERE id = 'old'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!stored.contains("3 tests pasan"));
        let db = Database(Mutex::new(connection));
        // The app sends the command without its output from now on: it comes back from its table
        db.save(
            "old",
            "Vieja",
            r#"{"messages":[{"role":"assistant","content":"Hecho","commands":[{"id":"cmd-1","state":"done"}]}]}"#,
        )
        .unwrap();
        let loaded = db.load("old").unwrap().unwrap();
        assert!(loaded.contains("3 tests pasan"));
        db.delete("old").unwrap();
        let left: i64 = db
            .with(|c| c.query_row("SELECT COUNT(*) FROM command_outputs", [], |row| row.get(0)))
            .unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn upgrading_indexes_existing_conversations_and_their_files() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL,
                 updated_at INTEGER NOT NULL, data TEXT NOT NULL);",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO conversations VALUES ('old', 'Vieja', 1, ?1)",
                params![r#"{"messages":[{"role":"user","content":"hola","attachments":[
                    {"id":"p","kind":"pdf","name":"contrato.pdf","mimeType":"application/pdf","data":"cláusula penal"}]}]}"#],
            )
            .unwrap();
        migrate(&connection).unwrap();
        assert_eq!(search::search(&connection, "hola").unwrap().len(), 1);
        assert_eq!(search::search(&connection, "clausula").unwrap().len(), 1);
    }

    #[test]
    fn pinning_keeps_the_date_and_the_import_state() {
        let db = in_memory();
        db.save_imported(&imported("claude-code:s", 2)).unwrap();
        db.set_pinned("claude-code:s", true).unwrap();
        let (pinned, updated_at): (bool, i64) = db
            .with(|c| {
                c.query_row(
                    "SELECT pinned, updated_at FROM conversations WHERE id = 'claude-code:s'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
            })
            .unwrap();
        assert!(pinned);
        assert_eq!(updated_at, 1);
        assert!(!db.imported_states("claude-code:").unwrap()["claude-code:s"].edited);

        // Saving or re-importing the conversation keeps it pinned
        db.save_imported(&imported("claude-code:s", 2)).unwrap();
        let pinned: bool = db
            .with(|c| {
                c.query_row(
                    "SELECT pinned FROM conversations WHERE id = 'claude-code:s'",
                    [],
                    |row| row.get(0),
                )
            })
            .unwrap();
        assert!(pinned);
    }

    #[test]
    fn a_renamed_import_keeps_its_name_when_imported_again() {
        let db = in_memory();
        db.save_imported(&imported("claude-code:s", 2)).unwrap();
        db.rename("claude-code:s", "  Mi nombre  ").unwrap();
        let title = |db: &Database| -> String {
            db.with(|c| {
                c.query_row(
                    "SELECT title FROM conversations WHERE id = 'claude-code:s'",
                    [],
                    |row| row.get(0),
                )
            })
            .unwrap()
        };
        assert_eq!(title(&db), "Mi nombre");
        assert!(!db.imported_states("claude-code:").unwrap()["claude-code:s"].edited);

        db.save_imported(&imported("claude-code:s", 2)).unwrap();
        assert_eq!(title(&db), "Mi nombre");
        assert!(db.rename("claude-code:s", "   ").is_err());
        assert!(db
            .rename("claude-code:s", &"a".repeat(TITLE_MAX + 1))
            .is_err());
    }

    #[test]
    fn an_import_is_untouched_until_the_app_saves_it() {
        let db = in_memory();
        db.save_imported(&imported("claude-code:s", 2)).unwrap();
        let state = &db.imported_states("claude-code:").unwrap()["claude-code:s"];
        assert!(!state.edited);
        assert_eq!((state.imported_count, state.message_count), (2, 2));

        db.save("claude-code:s", "Importada", r#"{"messages":[{},{},{}]}"#)
            .unwrap();
        let state = &db.imported_states("claude-code:").unwrap()["claude-code:s"];
        assert!(state.edited);
        assert_eq!(state.message_count, 3);

        // Importing again resets it, since the conversation is the source's version once more
        db.save_imported(&imported("claude-code:s", 2)).unwrap();
        assert!(!db.imported_states("claude-code:").unwrap()["claude-code:s"].edited);
    }

    #[test]
    fn an_imported_pdf_is_completed_without_continuing_the_conversation() {
        let db = in_memory();
        let pdf = r#"{"id":"doc","kind":"pdf","name":"informe.pdf","mimeType":"application/pdf","data":"","pdf":"JVBE"}"#;
        let mut conversation = imported("claude-code:s", 2);
        conversation.data = conversation_with(pdf);
        db.save_imported(&conversation).unwrap();

        let read = serde_json::json!({ "id": "doc", "data": "cláusula de prueba", "pageCount": 3, "pdf": "otro" });
        db.complete_pending_pdf("claude-code:s", &read).unwrap();
        let loaded: Value =
            serde_json::from_str(&db.load("claude-code:s").unwrap().unwrap()).unwrap();
        let attachment = &loaded["messages"][0]["attachments"][0];
        assert_eq!(attachment["data"], "cláusula de prueba");
        assert_eq!(attachment["pageCount"], 3);
        // Only what reading gives is taken: the file stays the one imported
        assert_eq!(attachment["pdf"], "JVBE");
        assert!(!db.imported_states("claude-code:").unwrap()["claude-code:s"].edited);
        assert_eq!(db.with(|c| search::search(c, "clausula")).unwrap().len(), 1);

        // Once read, it isn't replaced again
        let again = serde_json::json!({ "id": "doc", "data": "otra cosa", "pageCount": 1 });
        db.complete_pending_pdf("claude-code:s", &again).unwrap();
        let loaded: Value =
            serde_json::from_str(&db.load("claude-code:s").unwrap().unwrap()).unwrap();
        assert_eq!(loaded["messages"][0]["attachments"][0]["pageCount"], 3);
        assert!(db
            .complete_pending_pdf("claude-code:s", &serde_json::json!({ "id": "nadie" }))
            .is_err());
    }

    #[test]
    fn an_import_keeps_its_project() {
        let db = in_memory();
        let mut conversation = imported("claude-code:s", 1);
        conversation.data =
            r#"{"messages":[{"role":"user","content":"a"}],"projectId":"p1"}"#.into();
        db.save_imported(&conversation).unwrap();
        let project = |db: &Database| -> Option<String> {
            db.with(|c| {
                c.query_row(
                    "SELECT project_id FROM conversations WHERE id = 'claude-code:s'",
                    [],
                    |row| row.get(0),
                )
            })
            .unwrap()
        };
        assert_eq!(project(&db).as_deref(), Some("p1"));
        // Imported again without a folder (it no longer exists), it stays in its project
        db.save_imported(&imported("claude-code:s", 2)).unwrap();
        assert_eq!(project(&db).as_deref(), Some("p1"));
    }

    #[test]
    fn imported_states_only_lists_the_prefix() {
        let db = in_memory();
        db.save("nyra-conversation", "Propia", r#"{"messages":[]}"#)
            .unwrap();
        db.save_imported(&imported("claude-code:s", 2)).unwrap();
        let states = db.imported_states("claude-code:").unwrap();
        assert_eq!(states.keys().collect::<Vec<_>>(), vec!["claude-code:s"]);
    }

    const IMAGE: &str =
        r#"{"id":"img","kind":"image","name":"foto.png","mimeType":"image/png","data":"AAAA"}"#;

    fn conversation_with(attachment: &str) -> String {
        format!(
            r#"{{"messages":[{{"role":"user","content":"mira","attachments":[{attachment}]}},{{"role":"assistant","content":"vale"}}]}}"#
        )
    }

    fn stored_data(db: &Database, id: &str) -> Value {
        let raw: String = db
            .with(|c| {
                c.query_row(
                    "SELECT data FROM conversations WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
            })
            .unwrap();
        serde_json::from_str(&raw).unwrap()
    }

    fn attachment_rows(db: &Database, conversation_id: &str) -> i64 {
        db.with(|c| {
            c.query_row(
                "SELECT count(*) FROM attachments WHERE conversation_id = ?1",
                params![conversation_id],
                |row| row.get(0),
            )
        })
        .unwrap()
    }

    #[test]
    fn attachment_content_is_stored_once_and_filled_back_in() {
        let db = in_memory();
        db.save("c", "Con imagen", &conversation_with(IMAGE))
            .unwrap();

        // The conversation keeps only a reference; the content has its own row
        assert_eq!(
            stored_data(&db, "c")["messages"][0]["attachments"][0],
            serde_json::json!({ "id": "img" })
        );
        assert_eq!(attachment_rows(&db, "c"), 1);

        let loaded: Value = serde_json::from_str(&db.load("c").unwrap().unwrap()).unwrap();
        assert_eq!(loaded["messages"][0]["attachments"][0]["data"], "AAAA");
        // Messages without attachments don't gain an empty field on the way
        assert!(loaded["messages"][1].get("attachments").is_none());
    }

    #[test]
    fn a_later_save_can_send_just_the_reference() {
        let db = in_memory();
        db.save("c", "t", &conversation_with(IMAGE)).unwrap();
        db.save("c", "t", &conversation_with(r#"{"id":"img"}"#))
            .unwrap();
        let loaded: Value = serde_json::from_str(&db.load("c").unwrap().unwrap()).unwrap();
        assert_eq!(loaded["messages"][0]["attachments"][0]["name"], "foto.png");
    }

    #[test]
    fn attachments_no_message_uses_are_removed() {
        let db = in_memory();
        db.save("c", "t", &conversation_with(IMAGE)).unwrap();
        db.save(
            "c",
            "t",
            r#"{"messages":[{"role":"user","content":"editado"}]}"#,
        )
        .unwrap();
        assert_eq!(attachment_rows(&db, "c"), 0);
    }

    #[test]
    fn a_branch_keeps_its_attachments_when_the_original_is_deleted() {
        let db = in_memory();
        db.save("original", "t", &conversation_with(IMAGE)).unwrap();
        db.save("rama", "t", &conversation_with(IMAGE)).unwrap();
        db.delete("original").unwrap();

        assert_eq!(attachment_rows(&db, "original"), 0);
        let loaded: Value = serde_json::from_str(&db.load("rama").unwrap().unwrap()).unwrap();
        assert_eq!(loaded["messages"][0]["attachments"][0]["data"], "AAAA");
    }

    #[test]
    fn upgrading_moves_attachments_out_of_existing_conversations() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL,
                 data TEXT NOT NULL, edited INTEGER NOT NULL DEFAULT 0, imported_count INTEGER);
                 PRAGMA user_version = 2;",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO conversations (id, title, updated_at, data) VALUES ('c', 'Vieja', 1, ?1)",
                params![conversation_with(IMAGE)],
            )
            .unwrap();
        migrate(&connection).unwrap();
        let db = Database(Mutex::new(connection));

        assert_eq!(
            stored_data(&db, "c")["messages"][0]["attachments"][0],
            serde_json::json!({ "id": "img" })
        );
        let loaded: Value = serde_json::from_str(&db.load("c").unwrap().unwrap()).unwrap();
        assert_eq!(loaded["messages"][0]["attachments"][0]["data"], "AAAA");
    }
}
