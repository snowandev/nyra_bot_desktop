//! Folders to organize conversations. A conversation is in one folder at most; deleting a folder never deletes
//! its conversations, they go back to the general list.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;

use crate::i18n::{t, t_with};
use crate::storage::Database;
use crate::util::{is_plain_id, limited_name};

pub const SCHEMA: &str = "
    CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    ALTER TABLE conversations ADD COLUMN folder_id TEXT;
    CREATE INDEX conversations_folder ON conversations (folder_id);
";

pub const NAME_MAX: usize = 40;

#[derive(Serialize, Debug, PartialEq)]
pub struct Folder {
    id: String,
    name: String,
}

/// Names are compared like the app's searches: ignoring case and accents, so "trabajo" clashes with "Trabajo"
/// and "Diseno" with "Diseño".
fn folded(name: &str) -> String {
    name.trim()
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' | 'ã' | 'å' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' | 'õ' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            'ç' => 'c',
            other => other,
        })
        .collect()
}

/// The frontend validates the same rules while typing; this keeps the database right whatever arrives.
fn valid_name(
    connection: &Connection,
    name: &str,
    except_id: Option<&str>,
) -> Result<String, String> {
    let name = limited_name(name, NAME_MAX, &t("native.folders.nameEmpty"))?;
    let taken = list(connection)
        .map_err(|e| e.to_string())?
        .into_iter()
        .any(|f| Some(f.id.as_str()) != except_id && folded(&f.name) == folded(&name));
    if taken {
        return Err(t_with("native.folders.nameTaken", &[("name", &name)]));
    }
    Ok(name)
}

fn valid_id(id: &str) -> Result<(), String> {
    is_plain_id(id)
        .then_some(())
        .ok_or_else(|| t("native.folders.invalid"))
}

fn list(connection: &Connection) -> rusqlite::Result<Vec<Folder>> {
    let mut statement = connection.prepare("SELECT id, name FROM folders")?;
    let rows = statement.query_map([], |row| {
        Ok(Folder {
            id: row.get(0)?,
            name: row.get(1)?,
        })
    })?;
    rows.collect()
}

fn exists(connection: &Connection, id: &str) -> rusqlite::Result<bool> {
    connection
        .query_row("SELECT 1 FROM folders WHERE id = ?1", params![id], |_| {
            Ok(())
        })
        .optional()
        .map(|found| found.is_some())
}

fn create(connection: &Connection, id: &str, name: &str) -> Result<Folder, String> {
    valid_id(id)?;
    let name = valid_name(connection, name, None)?;
    connection
        .execute(
            "INSERT INTO folders (id, name) VALUES (?1, ?2)",
            params![id, name],
        )
        .map_err(|e| e.to_string())?;
    Ok(Folder {
        id: id.to_string(),
        name,
    })
}

fn rename(connection: &Connection, id: &str, name: &str) -> Result<String, String> {
    let name = valid_name(connection, name, Some(id))?;
    connection
        .execute(
            "UPDATE folders SET name = ?2 WHERE id = ?1",
            params![id, name],
        )
        .map_err(|e| e.to_string())?;
    Ok(name)
}

/// Its conversations stay, back in the general list.
fn delete(connection: &Connection, id: &str) -> rusqlite::Result<()> {
    let transaction = connection.unchecked_transaction()?;
    transaction.execute(
        "UPDATE conversations SET folder_id = NULL WHERE folder_id = ?1",
        params![id],
    )?;
    transaction.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
    transaction.commit()
}

/// Only the folder changes: like pinning, it doesn't move the conversation in the list nor mark it as edited.
fn move_conversation(
    connection: &Connection,
    conversation_id: &str,
    folder_id: Option<&str>,
) -> Result<(), String> {
    if let Some(folder_id) = folder_id {
        if !exists(connection, folder_id).map_err(|e| e.to_string())? {
            return Err(t("native.folders.gone"));
        }
    }
    connection
        .execute(
            "UPDATE conversations SET folder_id = ?2 WHERE id = ?1",
            params![conversation_id, folder_id],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_folders(db: State<'_, Database>) -> Result<Vec<Folder>, String> {
    db.with(list)
}

#[tauri::command]
pub async fn create_folder(
    db: State<'_, Database>,
    id: String,
    name: String,
) -> Result<Folder, String> {
    db.try_with(|c| create(c, &id, &name))
}

/// Returns the name as stored (trimmed).
#[tauri::command]
pub async fn rename_folder(
    db: State<'_, Database>,
    id: String,
    name: String,
) -> Result<String, String> {
    db.try_with(|c| rename(c, &id, &name))
}

#[tauri::command]
pub async fn delete_folder(db: State<'_, Database>, id: String) -> Result<(), String> {
    db.with(|c| delete(c, &id))
}

#[tauri::command]
pub async fn set_conversation_folder(
    db: State<'_, Database>,
    id: String,
    folder_id: Option<String>,
) -> Result<(), String> {
    db.try_with(|c| move_conversation(c, &id, folder_id.as_deref()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL);
                 INSERT INTO conversations VALUES ('c1', 'Uno'), ('c2', 'Dos');",
            )
            .unwrap();
        connection.execute_batch(SCHEMA).unwrap();
        connection
    }

    fn folder_of(connection: &Connection, id: &str) -> Option<String> {
        connection
            .query_row(
                "SELECT folder_id FROM conversations WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap()
    }

    #[test]
    fn names_are_trimmed_limited_and_unique_ignoring_case_and_accents() {
        let db = database();
        assert_eq!(create(&db, "f1", "  Diseño ").unwrap().name, "Diseño");
        assert!(create(&db, "f2", "diseno").is_err());
        assert!(create(&db, "f2", "   ").is_err());
        assert!(create(&db, "f2", &"a".repeat(41)).is_err());
        assert!(create(&db, "f2", &"ñ".repeat(40)).is_ok());
        // Renaming to its own name with other casing is fine
        assert_eq!(rename(&db, "f1", "DISEÑO").unwrap(), "DISEÑO");
    }

    #[test]
    fn rejects_ids_that_are_not_plain_tokens() {
        let db = database();
        assert!(create(&db, "../x", "A").is_err());
        assert!(create(&db, "", "A").is_err());
        assert!(create(&db, "8f3c-21ab", "A").is_ok());
    }

    #[test]
    fn deleting_a_folder_keeps_its_conversations() {
        let db = database();
        create(&db, "f1", "Trabajo").unwrap();
        move_conversation(&db, "c1", Some("f1")).unwrap();
        assert_eq!(folder_of(&db, "c1").as_deref(), Some("f1"));
        delete(&db, "f1").unwrap();
        assert_eq!(folder_of(&db, "c1"), None);
        let count: i64 = db
            .query_row("SELECT COUNT(*) FROM conversations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn a_conversation_can_only_go_to_an_existing_folder() {
        let db = database();
        assert!(move_conversation(&db, "c1", Some("nope")).is_err());
        create(&db, "f1", "Trabajo").unwrap();
        move_conversation(&db, "c1", Some("f1")).unwrap();
        move_conversation(&db, "c1", None).unwrap();
        assert_eq!(folder_of(&db, "c1"), None);
    }
}
