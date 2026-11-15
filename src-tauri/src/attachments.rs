//! Attachment content (base64 images, PDF pages, text files) lives in its own table, one row per attachment,
//! so saving a conversation after every reply doesn't rewrite megabytes that never change. Inside the stored
//! conversation each attachment is reduced to `{ "id": … }` and filled back in when it is loaded.

use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection};
use serde_json::{json, Value};

fn messages_mut(data: &mut Value) -> impl Iterator<Item = &mut Value> {
    data.get_mut("messages")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
}

fn attachments_mut(data: &mut Value) -> impl Iterator<Item = &mut Value> {
    // get_mut instead of indexing: indexing a missing key for writing would add it as null
    messages_mut(data)
        .filter_map(|message| message.get_mut("attachments").and_then(Value::as_array_mut))
        .flatten()
}

/// Stores the attachments that come with content and leaves `{ id }` in their place. One that is already
/// `{ id }` was stored by an earlier save. Returns the ids the conversation still uses.
pub fn move_out(
    connection: &Connection,
    conversation_id: &str,
    data: &mut Value,
) -> rusqlite::Result<HashSet<String>> {
    let mut used = HashSet::new();
    for attachment in attachments_mut(data) {
        let Some(id) = attachment["id"].as_str().map(str::to_string) else {
            continue;
        };
        let has_content = attachment
            .as_object()
            .is_some_and(|fields| fields.len() > 1);
        if has_content {
            connection.execute(
                "INSERT OR REPLACE INTO attachments (conversation_id, id, data) VALUES (?1, ?2, ?3)",
                params![conversation_id, id, attachment.to_string()],
            )?;
            *attachment = json!({ "id": id });
        }
        used.insert(id);
    }
    Ok(used)
}

/// Editing or regenerating can drop messages; their attachments would otherwise stay on disk forever.
pub fn delete_unused(
    connection: &Connection,
    conversation_id: &str,
    used: &HashSet<String>,
) -> rusqlite::Result<()> {
    let mut statement =
        connection.prepare("SELECT id FROM attachments WHERE conversation_id = ?1")?;
    let stored: Vec<String> = statement
        .query_map(params![conversation_id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    for id in stored.iter().filter(|id| !used.contains(*id)) {
        connection.execute(
            "DELETE FROM attachments WHERE conversation_id = ?1 AND id = ?2",
            params![conversation_id, id],
        )?;
    }
    Ok(())
}

/// Puts each attachment's content back. A reference to one that isn't stored is dropped, since the
/// interface can't show an attachment it knows nothing about.
pub fn fill_in(
    connection: &Connection,
    conversation_id: &str,
    data: &mut Value,
) -> rusqlite::Result<()> {
    let mut statement =
        connection.prepare("SELECT id, data FROM attachments WHERE conversation_id = ?1")?;
    let stored: HashMap<String, Value> = statement
        .query_map(params![conversation_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .filter_map(|row| row.ok())
        .filter_map(|(id, raw)| serde_json::from_str(&raw).ok().map(|value| (id, value)))
        .collect();

    for message in messages_mut(data) {
        if let Some(attachments) = message.get_mut("attachments").and_then(Value::as_array_mut) {
            attachments.retain_mut(|attachment| {
                let id = attachment["id"].as_str().unwrap_or_default();
                match stored.get(id) {
                    Some(full) => {
                        *attachment = full.clone();
                        true
                    }
                    // Already complete (stored before attachments had their own table) or missing for good
                    None => attachment
                        .as_object()
                        .is_some_and(|fields| fields.len() > 1),
                }
            });
        }
    }
    Ok(())
}

/// The PDFs of a conversation whose text was already read, by id: importing it again keeps what was read instead of
/// reading the same file once more
pub fn read_pdfs(
    connection: &Connection,
    conversation_id: &str,
) -> rusqlite::Result<HashMap<String, Value>> {
    let mut statement =
        connection.prepare("SELECT id, data FROM attachments WHERE conversation_id = ?1")?;
    let rows = statement.query_map(params![conversation_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    Ok(rows
        .filter_map(Result::ok)
        .filter_map(|(id, raw)| {
            serde_json::from_str::<Value>(&raw)
                .ok()
                .map(|value| (id, value))
        })
        .filter(|(_, value)| value["kind"] == "pdf" && value.get("pageCount").is_some())
        .collect())
}
