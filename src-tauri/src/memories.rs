//! Saved memories: short facts about the user that Nyra sends to the model with every message. They are kept
//! next to the conversations, and the user can see, edit and delete each one.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::i18n::{t, t_with};
use crate::storage::{now_millis, Database};
use crate::util::{is_conversation_id, is_plain_id};

pub const SCHEMA: &str = "
    CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        conversation_id TEXT,
        source TEXT NOT NULL
    );
";

/// A memory is a short fact; anything longer is more likely a note that belongs in a conversation
pub const TEXT_MAX: usize = 300;

#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    id: String,
    text: String,
    created_at: i64,
    updated_at: i64,
    /// The conversation it came from; None when it was added in Settings
    conversation_id: Option<String>,
    /// "model" (the model saved it, asked or on its own) or "user" (added or saved by hand)
    source: String,
}

/// Ids come from the frontend (`crypto.randomUUID`), so only a plain short token is accepted.
fn valid_id(id: &str) -> Result<(), String> {
    is_plain_id(id)
        .then_some(())
        .ok_or_else(|| t("native.memories.invalid"))
}

fn valid_conversation(id: &str) -> Result<(), String> {
    is_conversation_id(id)
        .then_some(())
        .ok_or_else(|| t("native.memories.invalid"))
}

/// The frontend checks the same while typing; this keeps the database right whatever arrives.
fn valid_text(text: &str) -> Result<String, String> {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return Err(t("native.memories.empty"));
    }
    let length = text.chars().count();
    if length > TEXT_MAX {
        return Err(t_with(
            "native.memories.tooLong",
            &[
                ("max", &TEXT_MAX.to_string()),
                ("extra", &(length - TEXT_MAX).to_string()),
            ],
        ));
    }
    Ok(text)
}

fn valid_source(source: &str) -> Result<(), String> {
    match source {
        "model" | "user" => Ok(()),
        _ => Err(t("native.memories.invalidSource")),
    }
}

/// Oldest first, so the model reads them in the order they were learned
fn list(connection: &Connection) -> rusqlite::Result<Vec<Memory>> {
    let mut statement = connection.prepare(
        "SELECT id, text, created_at, updated_at, conversation_id, source FROM memories ORDER BY created_at, id",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(Memory {
            id: row.get(0)?,
            text: row.get(1)?,
            created_at: row.get(2)?,
            updated_at: row.get(3)?,
            conversation_id: row.get(4)?,
            source: row.get(5)?,
        })
    })?;
    rows.collect()
}

fn add(
    connection: &Connection,
    id: &str,
    text: &str,
    conversation_id: Option<&str>,
    source: &str,
) -> Result<Memory, String> {
    valid_id(id)?;
    valid_source(source)?;
    if let Some(conversation_id) = conversation_id {
        valid_conversation(conversation_id)?;
    }
    let text = valid_text(text)?;
    let now = now_millis();
    connection
        .execute(
            "INSERT INTO memories (id, text, created_at, updated_at, conversation_id, source)
             VALUES (?1, ?2, ?3, ?3, ?4, ?5)",
            params![id, text, now, conversation_id, source],
        )
        .map_err(|e| e.to_string())?;
    Ok(Memory {
        id: id.to_string(),
        text,
        created_at: now,
        updated_at: now,
        conversation_id: conversation_id.map(str::to_string),
        source: source.to_string(),
    })
}

/// Puts back a memory deleted moments ago, with its dates, so it returns to its place in the list
fn restore(connection: &Connection, memory: &Memory) -> Result<(), String> {
    valid_id(&memory.id)?;
    valid_source(&memory.source)?;
    if let Some(conversation_id) = &memory.conversation_id {
        valid_conversation(conversation_id)?;
    }
    let text = valid_text(&memory.text)?;
    connection
        .execute(
            "INSERT INTO memories (id, text, created_at, updated_at, conversation_id, source)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                memory.id,
                text,
                memory.created_at,
                memory.updated_at,
                memory.conversation_id,
                memory.source
            ],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Returns the text as stored (spaces tidied)
fn update(connection: &Connection, id: &str, text: &str) -> Result<String, String> {
    let text = valid_text(text)?;
    let changed = connection
        .execute(
            "UPDATE memories SET text = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, text, now_millis()],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(t("native.memories.gone"));
    }
    Ok(text)
}

#[tauri::command]
pub async fn list_memories(db: State<'_, Database>) -> Result<Vec<Memory>, String> {
    db.with(list)
}

#[tauri::command]
pub async fn add_memory(
    db: State<'_, Database>,
    id: String,
    text: String,
    conversation_id: Option<String>,
    source: String,
) -> Result<Memory, String> {
    db.try_with(|c| add(c, &id, &text, conversation_id.as_deref(), &source))
}

#[tauri::command]
pub async fn update_memory(
    db: State<'_, Database>,
    id: String,
    text: String,
) -> Result<String, String> {
    db.try_with(|c| update(c, &id, &text))
}

#[tauri::command]
pub async fn restore_memory(db: State<'_, Database>, memory: Memory) -> Result<(), String> {
    db.try_with(|c| restore(c, &memory))
}

#[tauri::command]
pub async fn delete_memory(db: State<'_, Database>, id: String) -> Result<(), String> {
    db.with(|c| {
        c.execute("DELETE FROM memories WHERE id = ?1", params![id])
            .map(|_| ())
    })
}

#[tauri::command]
pub async fn delete_all_memories(db: State<'_, Database>) -> Result<(), String> {
    db.with(|c| c.execute("DELETE FROM memories", []).map(|_| ()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(SCHEMA).unwrap();
        connection
    }

    #[test]
    fn a_memory_can_come_from_an_imported_conversation() {
        let c = database();
        add(
            &c,
            "m1",
            "Usa Tauri 2 y React",
            Some("claude-code:4f2d-81"),
            "model",
        )
        .unwrap();
        assert!(add(&c, "m2", "Otra", Some("claude-code:../x"), "model").is_err());
    }

    #[test]
    fn adds_lists_updates_and_deletes() {
        let c = database();
        add(&c, "m1", "Usa Tauri 2 y React", Some("c1"), "model").unwrap();
        add(&c, "m2", "Prefiere ejemplos en TypeScript", None, "user").unwrap();
        let all = list(&c).unwrap();
        assert_eq!(
            all.iter().map(|m| m.text.as_str()).collect::<Vec<_>>(),
            ["Usa Tauri 2 y React", "Prefiere ejemplos en TypeScript"]
        );
        assert_eq!(all[0].conversation_id.as_deref(), Some("c1"));
        assert_eq!(all[1].source, "user");

        assert_eq!(
            update(&c, "m1", "  Usa   Tauri 2  ").unwrap(),
            "Usa Tauri 2"
        );
        assert!(update(&c, "no-existe", "Algo").is_err());
        let deleted = list(&c).unwrap().remove(1);
        c.execute("DELETE FROM memories WHERE id = 'm2'", [])
            .unwrap();
        assert_eq!(list(&c).unwrap().len(), 1);
        restore(&c, &deleted).unwrap();
        assert_eq!(list(&c).unwrap()[1], deleted);
    }

    #[test]
    fn rejects_empty_long_or_odd_input() {
        let c = database();
        assert!(add(&c, "m1", "   ", None, "user").is_err());
        assert!(add(&c, "m1", &"a".repeat(TEXT_MAX + 1), None, "user").is_err());
        assert!(add(&c, "../x", "Algo", None, "user").is_err());
        assert!(add(&c, "m1", "Algo", Some("c'1"), "user").is_err());
        assert!(add(&c, "m1", "Algo", None, "admin").is_err());
        assert!(list(&c).unwrap().is_empty());
    }
}
