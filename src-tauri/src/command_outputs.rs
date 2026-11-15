//! What a command printed (up to 50,000 lines) lives in its own table, one row per command, so saving a conversation
//! after every reply doesn't send and rewrite outputs that never change once the command ends. Inside the stored
//! conversation a command keeps everything but its output, which is put back when the conversation is loaded.

use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection};
use serde_json::Value;

pub const SCHEMA: &str = "
    CREATE TABLE command_outputs (
        conversation_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        output TEXT NOT NULL,
        PRIMARY KEY (conversation_id, run_id)
    );
";

fn runs_mut(data: &mut Value) -> impl Iterator<Item = &mut Value> {
    // get_mut instead of indexing: indexing a missing key for writing would add it as null
    data.get_mut("messages")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
        .filter_map(|message| message.get_mut("commands").and_then(Value::as_array_mut))
        .flatten()
}

/// Stores the outputs that come with the conversation and takes them out of it. A command without one was stored
/// by an earlier save (or printed nothing yet). Returns the commands the conversation still has.
pub fn move_out(
    connection: &Connection,
    conversation_id: &str,
    data: &mut Value,
) -> rusqlite::Result<HashSet<String>> {
    let mut used = HashSet::new();
    for run in runs_mut(data) {
        let Some(id) = run.get("id").and_then(Value::as_str).map(str::to_string) else {
            continue;
        };
        let output = run
            .get("output")
            .and_then(Value::as_str)
            .map(str::to_string);
        if let (Some(output), Some(fields)) = (output, run.as_object_mut()) {
            connection.execute(
                "INSERT OR REPLACE INTO command_outputs (conversation_id, run_id, output) VALUES (?1, ?2, ?3)",
                params![conversation_id, id, output],
            )?;
            fields.remove("output");
        }
        used.insert(id);
    }
    Ok(used)
}

/// Editing or regenerating can drop messages; their commands' outputs would otherwise stay on disk forever.
pub fn delete_unused(
    connection: &Connection,
    conversation_id: &str,
    used: &HashSet<String>,
) -> rusqlite::Result<()> {
    let stored: Vec<String> = connection
        .prepare("SELECT run_id FROM command_outputs WHERE conversation_id = ?1")?
        .query_map(params![conversation_id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    for id in stored.iter().filter(|id| !used.contains(*id)) {
        connection.execute(
            "DELETE FROM command_outputs WHERE conversation_id = ?1 AND run_id = ?2",
            params![conversation_id, id],
        )?;
    }
    Ok(())
}

/// Puts each command's output back
pub fn fill_in(
    connection: &Connection,
    conversation_id: &str,
    data: &mut Value,
) -> rusqlite::Result<()> {
    let stored: HashMap<String, String> = connection
        .prepare("SELECT run_id, output FROM command_outputs WHERE conversation_id = ?1")?
        .query_map(params![conversation_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?
        .collect::<rusqlite::Result<_>>()?;
    if stored.is_empty() {
        return Ok(());
    }
    for run in runs_mut(data) {
        let id = run.get("id").and_then(Value::as_str).unwrap_or_default();
        if let (Some(output), Some(fields)) = (stored.get(id).cloned(), run.as_object_mut()) {
            fields.entry("output").or_insert(Value::String(output));
        }
    }
    Ok(())
}

pub fn forget(connection: &Connection, conversation_id: &str) -> rusqlite::Result<()> {
    connection
        .execute(
            "DELETE FROM command_outputs WHERE conversation_id = ?1",
            params![conversation_id],
        )
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(SCHEMA).unwrap();
        connection
    }

    fn conversation(output: Option<&str>) -> Value {
        let mut run = json!({ "id": "cmd-1", "command": "npm test", "state": "done" });
        if let Some(output) = output {
            run["output"] = json!(output);
        }
        json!({ "messages": [{ "role": "assistant", "content": "Listo", "commands": [run] }] })
    }

    #[test]
    fn keeps_the_output_apart_and_puts_it_back() {
        let c = database();
        let mut data = conversation(Some("12 tests pasan\n"));
        let used = move_out(&c, "a", &mut data).unwrap();
        assert_eq!(used, HashSet::from(["cmd-1".to_string()]));
        assert!(data["messages"][0]["commands"][0].get("output").is_none());
        // A later save sends the command without its output: what is stored stays
        let mut later = conversation(None);
        move_out(&c, "a", &mut later).unwrap();
        fill_in(&c, "a", &mut later).unwrap();
        assert_eq!(
            later["messages"][0]["commands"][0]["output"],
            "12 tests pasan\n"
        );
    }

    #[test]
    fn lets_go_of_the_outputs_of_commands_no_longer_there() {
        let c = database();
        move_out(&c, "a", &mut conversation(Some("salida"))).unwrap();
        delete_unused(&c, "a", &HashSet::new()).unwrap();
        let mut data = conversation(None);
        fill_in(&c, "a", &mut data).unwrap();
        assert!(data["messages"][0]["commands"][0].get("output").is_none());
    }
}
