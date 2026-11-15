//! The database's schema, brought up to date one step at a time when Nyra opens it.

use super::*;

pub(super) const SCHEMA_VERSION: i64 = 17;

/// Each step runs once; PRAGMA user_version records how many already ran.
pub(super) fn migrate(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch("PRAGMA journal_mode = WAL;")
        .map_err(to_message)?;
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(to_message)?;
    if version >= SCHEMA_VERSION {
        return Ok(());
    }
    // All steps together or none: a half-migrated database would be hard to recover
    let transaction = connection.unchecked_transaction().map_err(to_message)?;
    if version < 1 {
        transaction
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS conversations (
                     id TEXT PRIMARY KEY,
                     title TEXT NOT NULL,
                     updated_at INTEGER NOT NULL,
                     data TEXT NOT NULL
                 );",
            )
            .map_err(to_message)?;
    }
    if version < 2 {
        transaction
            .execute_batch(
                "ALTER TABLE conversations ADD COLUMN edited INTEGER NOT NULL DEFAULT 0;
                 ALTER TABLE conversations ADD COLUMN imported_count INTEGER;",
            )
            .map_err(to_message)?;
    }
    if version < 3 {
        // The same attachment id can appear in a conversation and in its branches, each with its own copy
        transaction
            .execute_batch(
                "CREATE TABLE attachments (
                     conversation_id TEXT NOT NULL,
                     id TEXT NOT NULL,
                     data TEXT NOT NULL,
                     PRIMARY KEY (conversation_id, id)
                 );",
            )
            .map_err(to_message)?;
        move_existing_attachments_out(&transaction)?;
    }
    if version < 4 {
        transaction
            .execute_batch(
                "ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;",
            )
            .map_err(to_message)?;
    }
    if version < 5 {
        transaction
            .execute_batch(
                "ALTER TABLE conversations ADD COLUMN renamed INTEGER NOT NULL DEFAULT 0;",
            )
            .map_err(to_message)?;
    }
    if version < 6 {
        transaction
            .execute_batch(search::SCHEMA)
            .map_err(to_message)?;
        search::index_existing(&transaction).map_err(to_message)?;
    }
    if version < 7 {
        transaction
            .execute_batch(folders::SCHEMA)
            .map_err(to_message)?;
    }
    if version < 8 {
        transaction
            .execute_batch(memories::SCHEMA)
            .map_err(to_message)?;
    }
    if version < 9 {
        transaction
            .execute_batch(workspace::SCHEMA)
            .map_err(to_message)?;
    }
    if version < 10 {
        transaction
            .execute_batch(workspace::meaning::SCHEMA)
            .map_err(to_message)?;
    }
    // Version 11 kept the provider addresses the user allowed; that permission was withdrawn
    if version < 12 {
        transaction
            .execute_batch("DROP TABLE IF EXISTS allowed_origins;")
            .map_err(to_message)?;
    }
    if version < 13 {
        transaction
            .execute_batch(projects::SCHEMA)
            .map_err(to_message)?;
    }
    if version < 14 {
        transaction
            .execute_batch(projects::SKILLS_SCHEMA)
            .map_err(to_message)?;
    }
    if version < 15 {
        rename_builtin_skills(&transaction)?;
        projects::rename_builtin_skills(&transaction).map_err(to_message)?;
    }
    if version < 16 {
        transaction
            .execute_batch(workspace::SAVED_FOLDER_INDEX)
            .map_err(to_message)?;
    }
    if version < 17 {
        transaction
            .execute_batch(command_outputs::SCHEMA)
            .map_err(to_message)?;
        move_existing_outputs_out(&transaction)?;
    }
    transaction
        .execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))
        .map_err(to_message)?;
    transaction.commit().map_err(to_message)
}

pub(super) fn move_existing_attachments_out(connection: &Connection) -> Result<(), String> {
    let rows: Vec<(String, String)> = {
        let mut statement = connection
            .prepare("SELECT id, data FROM conversations")
            .map_err(to_message)?;
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(to_message)?;
        rows.collect::<rusqlite::Result<_>>().map_err(to_message)?
    };
    for (id, raw) in rows {
        // A row that isn't valid JSON is left as it is rather than blocking the whole upgrade
        let Ok(mut data) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        attachments::move_out(connection, &id, &mut data).map_err(to_message)?;
        connection
            .execute(
                "UPDATE conversations SET data = ?1 WHERE id = ?2",
                params![data.to_string(), id],
            )
            .map_err(to_message)?;
    }
    Ok(())
}

/// The outputs saved inside the conversations before they had a table of their own: the app sends a stored output
/// only once, so each must be in the table before its next save
pub(super) fn move_existing_outputs_out(connection: &Connection) -> Result<(), String> {
    let rows: Vec<(String, String)> = {
        let mut statement = connection
            .prepare("SELECT id, data FROM conversations WHERE instr(data, '\"output\"') > 0")
            .map_err(to_message)?;
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(to_message)?;
        rows.collect::<rusqlite::Result<_>>().map_err(to_message)?
    };
    for (id, raw) in rows {
        // A row that isn't valid JSON is left as it is rather than blocking the whole upgrade
        let Ok(mut data) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        command_outputs::move_out(connection, &id, &mut data).map_err(to_message)?;
        connection
            .execute(
                "UPDATE conversations SET data = ?1 WHERE id = ?2",
                params![data.to_string(), id],
            )
            .map_err(to_message)?;
    }
    Ok(())
}

/// Conversations keep the skills they had on, chose or used under the built-ins' English names
pub(super) fn rename_builtin_skills(connection: &Connection) -> Result<(), String> {
    let rows: Vec<(String, String)> = {
        let mut statement = connection
            .prepare("SELECT id, data FROM conversations")
            .map_err(to_message)?;
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(to_message)?;
        rows.collect::<rusqlite::Result<_>>().map_err(to_message)?
    };
    for (id, raw) in rows {
        let Ok(mut data) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        if rename_skills_in(&mut data) {
            connection
                .execute(
                    "UPDATE conversations SET data = ?1 WHERE id = ?2",
                    params![data.to_string(), id],
                )
                .map_err(to_message)?;
        }
    }
    Ok(())
}

/// Only the fields that hold skill names, at any depth, so a message that merely says an old name stays as it is
pub(super) fn rename_skills_in(value: &mut Value) -> bool {
    let rename = |name: &mut String| match crate::skills::renamed_builtin(name) {
        Some(new) => {
            *name = new.to_string();
            true
        }
        None => false,
    };
    match value {
        Value::Object(fields) => fields.iter_mut().fold(false, |changed, (key, field)| {
            let renamed = match (key.as_str(), field) {
                ("skill" | "taskSkill", Value::String(name)) => rename(name),
                ("skills" | "skillsUsed", Value::Array(names)) => {
                    names.iter_mut().fold(false, |changed, name| match name {
                        Value::String(name) => rename(name) | changed,
                        _ => changed,
                    })
                }
                (_, other) => rename_skills_in(other),
            };
            renamed | changed
        }),
        Value::Array(items) => items
            .iter_mut()
            .fold(false, |changed, item| rename_skills_in(item) | changed),
        _ => false,
    }
}
