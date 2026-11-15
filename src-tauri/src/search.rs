//! Full-text search across every saved conversation: message text plus the text of attached files (text files
//! and the text extracted from PDFs). Private conversations are never saved, so they are never indexed.

use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::storage::Database;
use crate::util::to_message;

/// A plain table holds the entries, indexed by conversation so a save can replace its own rows cheaply; the FTS5
/// table only indexes their text ("external content") and the triggers keep both in step. `remove_diacritics`
/// makes "configuracion" find "Configuración", like the search inside a conversation.
pub const SCHEMA: &str = "
    CREATE TABLE search_entries (
        id INTEGER PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        message_index INTEGER NOT NULL,
        attachment_id TEXT,
        name TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL
    );
    CREATE INDEX search_entries_conversation ON search_entries (conversation_id);
    CREATE VIRTUAL TABLE search_text USING fts5(
        name, text,
        content = 'search_entries', content_rowid = 'id',
        tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER search_entries_insert AFTER INSERT ON search_entries BEGIN
        INSERT INTO search_text (rowid, name, text) VALUES (new.id, new.name, new.text);
    END;
    CREATE TRIGGER search_entries_delete AFTER DELETE ON search_entries BEGIN
        INSERT INTO search_text (search_text, rowid, name, text) VALUES ('delete', old.id, old.name, old.text);
    END;
";

// Mark the match inside a snippet; control characters never appear in indexed text (see `searchable`)
const MATCH_START: char = '\u{1}';
const MATCH_END: char = '\u{2}';
const MAX_CONVERSATIONS: usize = 30;
const MAX_WORDS: usize = 12;

fn messages(data: &Value) -> impl Iterator<Item = (usize, &Value)> {
    data.get("messages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
}

fn attachments(message: &Value) -> impl Iterator<Item = &Value> {
    message
        .get("attachments")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
}

/// The document tags Nyra's replies use would make every reply with a document match "document" or "title";
/// the tag goes, its title stays.
fn searchable(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("<nyra-document") {
        out.push_str(&rest[..start]);
        let tag_end = rest[start..]
            .find('\n')
            .map_or(rest.len(), |end| start + end);
        let tag = &rest[start..tag_end];
        if let Some(title) = tag
            .split("title=\"")
            .nth(1)
            .and_then(|t| t.split('"').next())
        {
            out.push_str(title);
        }
        rest = &rest[tag_end..];
    }
    out.push_str(rest);
    out.replace("</nyra-document>", "")
        .replace([MATCH_START, MATCH_END], " ")
}

/// Text files and PDFs (their extracted text) are searchable by content; any attachment by its name.
fn attachment_entry(attachment: &Value) -> Option<(&str, &str, String)> {
    let id = attachment.get("id")?.as_str()?;
    let name = attachment.get("name")?.as_str().unwrap_or_default();
    let has_text = matches!(
        attachment.get("kind").and_then(Value::as_str),
        Some("text" | "pdf")
    );
    let text = if has_text {
        attachment
            .get("data")
            .and_then(Value::as_str)
            .unwrap_or_default()
    } else {
        ""
    };
    Some((id, name, searchable(text)))
}

fn insert_attachment(
    connection: &Connection,
    conversation_id: &str,
    message_index: usize,
    attachment: &Value,
) -> rusqlite::Result<()> {
    let Some((id, name, text)) = attachment_entry(attachment) else {
        return Ok(());
    };
    connection.execute(
        "DELETE FROM search_entries WHERE conversation_id = ?1 AND attachment_id = ?2",
        params![conversation_id, id],
    )?;
    connection.execute(
        "INSERT INTO search_entries (conversation_id, message_index, attachment_id, name, text)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![conversation_id, message_index as i64, id, name, text],
    )?;
    Ok(())
}

/// Attachments never change, so each is indexed once: when its content arrives (an attachment already stored
/// comes back as just `{ id }`). Runs before the content is moved to the attachments table.
pub fn index_new_attachments(
    connection: &Connection,
    conversation_id: &str,
    data: &Value,
) -> rusqlite::Result<()> {
    for (index, message) in messages(data) {
        for attachment in attachments(message) {
            let has_content = attachment.as_object().is_some_and(|f| f.len() > 1);
            if has_content {
                insert_attachment(connection, conversation_id, index, attachment)?;
            }
        }
    }
    Ok(())
}

/// An attachment whose content was completed after it was stored: its entry is replaced where it already was.
pub fn index_completed_attachment(
    connection: &Connection,
    conversation_id: &str,
    attachment: &Value,
) -> rusqlite::Result<()> {
    let id = attachment["id"].as_str().unwrap_or_default();
    let index: Option<i64> = connection
        .query_row(
            "SELECT message_index FROM search_entries WHERE conversation_id = ?1 AND attachment_id = ?2",
            params![conversation_id, id],
            |row| row.get(0),
        )
        .optional()?;
    match index {
        Some(index) => insert_attachment(connection, conversation_id, index as usize, attachment),
        None => Ok(()),
    }
}

/// Drops the entries of attachments no message uses any more (edited or regenerated away).
pub fn keep_attachments(
    connection: &Connection,
    conversation_id: &str,
    used: &HashSet<String>,
) -> rusqlite::Result<()> {
    let mut statement = connection.prepare(
        "SELECT DISTINCT attachment_id FROM search_entries
         WHERE conversation_id = ?1 AND attachment_id IS NOT NULL",
    )?;
    let indexed: Vec<String> = statement
        .query_map(params![conversation_id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    for id in indexed.iter().filter(|id| !used.contains(*id)) {
        connection.execute(
            "DELETE FROM search_entries WHERE conversation_id = ?1 AND attachment_id = ?2",
            params![conversation_id, id],
        )?;
    }
    Ok(())
}

/// Only the messages whose text changed are indexed again: a long conversation is saved after every reply, and
/// re-indexing all of it each time would grow with it.
pub fn index_messages(
    connection: &Connection,
    conversation_id: &str,
    data: &Value,
) -> rusqlite::Result<()> {
    let mut stored: HashMap<i64, (i64, String)> = HashMap::new();
    {
        let mut select = connection.prepare(
            "SELECT id, message_index, text FROM search_entries
             WHERE conversation_id = ?1 AND attachment_id IS NULL",
        )?;
        let rows = select.query_map(params![conversation_id], |row| {
            Ok((
                row.get::<_, i64>(1)?,
                (row.get::<_, i64>(0)?, row.get::<_, String>(2)?),
            ))
        })?;
        for row in rows {
            let (index, entry) = row?;
            stored.insert(index, entry);
        }
    }
    let mut delete = connection.prepare("DELETE FROM search_entries WHERE id = ?1")?;
    let mut insert = connection.prepare(
        "INSERT INTO search_entries (conversation_id, message_index, text) VALUES (?1, ?2, ?3)",
    )?;
    for (index, message) in messages(data) {
        let text = searchable(
            message
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        );
        let wanted = (!text.trim().is_empty()).then_some(text);
        let before = stored.remove(&(index as i64));
        if before.as_ref().map(|(_, old)| old) == wanted.as_ref() {
            continue;
        }
        if let Some((id, _)) = before {
            delete.execute(params![id])?;
        }
        if let Some(text) = wanted {
            insert.execute(params![conversation_id, index as i64, text])?;
        }
    }
    // Messages that are no longer there (deleted, or a conversation cut back)
    for (id, _) in stored.into_values() {
        delete.execute(params![id])?;
    }
    Ok(())
}

pub fn forget(connection: &Connection, conversation_id: &str) -> rusqlite::Result<()> {
    connection
        .execute(
            "DELETE FROM search_entries WHERE conversation_id = ?1",
            params![conversation_id],
        )
        .map(|_| ())
}

pub fn forget_all(connection: &Connection) -> rusqlite::Result<()> {
    connection
        .execute("DELETE FROM search_entries", [])
        .map(|_| ())
}

/// Indexes the conversations saved before search existed. Their attachments are already in their own table,
/// referenced from the messages by id.
pub fn index_existing(connection: &Connection) -> rusqlite::Result<()> {
    let conversations: Vec<(String, String)> = {
        let mut statement = connection.prepare("SELECT id, data FROM conversations")?;
        let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    let mut stored =
        connection.prepare("SELECT id, data FROM attachments WHERE conversation_id = ?1")?;
    for (id, raw) in conversations {
        // A damaged row stays unsearchable rather than blocking the upgrade
        let Ok(data) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        index_messages(connection, &id, &data)?;
        let positions: HashMap<&str, usize> = messages(&data)
            .flat_map(|(index, message)| {
                attachments(message).filter_map(move |a| Some((a.get("id")?.as_str()?, index)))
            })
            .collect();
        let rows: Vec<(String, String)> = stored
            .query_map(params![id], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        for (attachment_id, raw) in rows {
            let (Some(&index), Ok(attachment)) = (
                positions.get(attachment_id.as_str()),
                serde_json::from_str::<Value>(&raw),
            ) else {
                continue;
            };
            insert_attachment(connection, &id, index, &attachment)?;
        }
    }
    Ok(())
}

/// What the user types is never FTS5 syntax: each word becomes a quoted term (so `AND`, `*`, `"` or `-` are just
/// text) and the last one is a prefix, so results appear while typing.
fn match_expression(query: &str) -> Option<String> {
    let words = query_words(query);
    let (last, rest) = words.split_last()?;
    let mut terms: Vec<String> = rest.iter().map(|w| format!("\"{w}\"")).collect();
    terms.push(format!("\"{last}\"*"));
    Some(terms.join(" "))
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    conversation_id: String,
    title: String,
    updated_at: i64,
    /// The message to jump to: the one with the best match, or the one the file was attached to
    message_index: usize,
    attachment_name: Option<String>,
    /// Text around the match; the matched words are between \u{1} and \u{2}
    snippet: String,
    match_count: usize,
}

/// Scripts written without spaces between words (Chinese, Japanese, Thai…): the index only splits at spaces and
/// punctuation, so a word inside one of their sentences is never a term of its own
fn is_unspaced(c: char) -> bool {
    matches!(c as u32,
        0x0E00..=0x0EFF // Thai, Lao
        | 0x1000..=0x109F // Myanmar
        | 0x1780..=0x17FF // Khmer
        | 0x3040..=0x30FF // Hiragana, Katakana
        | 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF | 0x20000..=0x2FA1F // Han
    )
}

fn query_words(query: &str) -> Vec<&str> {
    query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .take(MAX_WORDS)
        .collect()
}

/// The best match of each conversation, best conversations first.
pub fn search(connection: &Connection, query: &str) -> rusqlite::Result<Vec<SearchHit>> {
    if query.chars().any(is_unspaced) {
        return search_inside(connection, &query_words(query));
    }
    let Some(expression) = match_expression(query) else {
        return Ok(Vec::new());
    };
    let mut statement = connection.prepare(
        "SELECT e.conversation_id, c.title, c.updated_at, e.message_index, e.attachment_id IS NOT NULL, e.name,
                snippet(search_text, -1, char(1), char(2), '…', 14)
         FROM search_text
         JOIN search_entries e ON e.id = search_text.rowid
         JOIN conversations c ON c.id = e.conversation_id
         WHERE search_text MATCH ?1
         ORDER BY rank
         LIMIT 500",
    )?;
    let rows = statement.query_map(params![expression], |row| {
        Ok(SearchHit {
            conversation_id: row.get(0)?,
            title: row.get(1)?,
            updated_at: row.get(2)?,
            message_index: row.get::<_, i64>(3)? as usize,
            attachment_name: if row.get(4)? { Some(row.get(5)?) } else { None },
            snippet: row.get(6)?,
            match_count: 1,
        })
    })?;
    best_per_conversation(rows)
}

/// For the scripts without spaces: each word looked for inside the text, newest conversations first. It reads every
/// entry instead of the index, so it is only used for them.
fn search_inside(connection: &Connection, words: &[&str]) -> rusqlite::Result<Vec<SearchHit>> {
    if words.is_empty() {
        return Ok(Vec::new());
    }
    let condition = (1..=words.len())
        .map(|n| format!("(e.text LIKE ?{n} ESCAPE '\\' OR e.name LIKE ?{n} ESCAPE '\\')"))
        .collect::<Vec<_>>()
        .join(" AND ");
    let mut statement = connection.prepare(&format!(
        "SELECT e.conversation_id, c.title, c.updated_at, e.message_index, e.attachment_id IS NOT NULL, e.name, e.text
         FROM search_entries e
         JOIN conversations c ON c.id = e.conversation_id
         WHERE {condition}
         ORDER BY c.updated_at DESC, e.message_index
         LIMIT 500"
    ))?;
    let patterns: Vec<String> = words
        .iter()
        .map(|w| format!("%{}%", escaped_like(w)))
        .collect();
    let rows = statement.query_map(rusqlite::params_from_iter(&patterns), |row| {
        let text: String = row.get(6)?;
        Ok(SearchHit {
            conversation_id: row.get(0)?,
            title: row.get(1)?,
            updated_at: row.get(2)?,
            message_index: row.get::<_, i64>(3)? as usize,
            attachment_name: if row.get(4)? { Some(row.get(5)?) } else { None },
            snippet: snippet_around(&text, words),
            match_count: 1,
        })
    })?;
    best_per_conversation(rows)
}

fn escaped_like(word: &str) -> String {
    word.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

const SNIPPET_BEFORE: usize = 20;
const SNIPPET_AFTER: usize = 40;

/// The text around the first word found, each word marked as the index's snippets mark them
fn snippet_around(text: &str, words: &[&str]) -> String {
    let at = words.iter().filter_map(|w| text.find(w)).min().unwrap_or(0);
    let start = text[..at]
        .char_indices()
        .rev()
        .nth(SNIPPET_BEFORE - 1)
        .map_or(0, |(i, _)| i);
    let end = text[at..]
        .char_indices()
        .nth(SNIPPET_AFTER)
        .map_or(text.len(), |(i, _)| at + i);
    let mut window = text[start..end].to_string();
    for word in words {
        window = window.replace(word, &format!("{MATCH_START}{word}{MATCH_END}"));
    }
    let before = if start > 0 { "…" } else { "" };
    let after = if end < text.len() { "…" } else { "" };
    format!("{before}{}{after}", window.trim())
}

fn best_per_conversation(
    rows: impl Iterator<Item = rusqlite::Result<SearchHit>>,
) -> rusqlite::Result<Vec<SearchHit>> {
    let mut hits: Vec<SearchHit> = Vec::new();
    let mut positions: HashMap<String, usize> = HashMap::new();
    for hit in rows {
        let hit = hit?;
        match positions.get(&hit.conversation_id) {
            Some(&position) => hits[position].match_count += 1,
            None if hits.len() < MAX_CONVERSATIONS => {
                positions.insert(hit.conversation_id.clone(), hits.len());
                hits.push(hit);
            }
            None => {}
        }
    }
    Ok(hits)
}

#[tauri::command]
pub async fn search_conversations(app: AppHandle, query: String) -> Result<Vec<SearchHit>, String> {
    // On a connection of its own, off the async threads: searching every conversation doesn't hold up saving
    tauri::async_runtime::spawn_blocking(move || {
        let reader = Database::open_reader(&app)?;
        search(&reader, &query).map_err(to_message)
    })
    .await
    .map_err(to_message)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL);",
            )
            .unwrap();
        connection.execute_batch(SCHEMA).unwrap();
        connection
    }

    fn save(connection: &Connection, id: &str, data: &Value) {
        connection
            .execute(
                "INSERT OR REPLACE INTO conversations VALUES (?1, ?2, 1)",
                params![id, format!("Chat {id}")],
            )
            .unwrap();
        index_new_attachments(connection, id, data).unwrap();
        index_messages(connection, id, data).unwrap();
    }

    fn conversation() -> Value {
        json!({ "messages": [
            { "role": "user", "content": "¿Cómo levanto los servicios?", "attachments": [
                { "id": "a1", "kind": "pdf", "name": "contrato.pdf", "data": "Cláusula de confidencialidad" },
                { "id": "a2", "kind": "image", "name": "captura.png", "data": "iVBORw0KGgo" }
            ]},
            { "role": "assistant", "content": "Usa docker compose up -d y revisa la configuración." }
        ]})
    }

    #[test]
    fn finds_words_inside_sentences_written_without_spaces() {
        let c = database();
        save(
            &c,
            "zh",
            &json!({ "messages": [{ "role": "user", "content": "我们明天去东京开会" }] }),
        );
        save(
            &c,
            "ja",
            &json!({ "messages": [{ "role": "user", "content": "明日は東京で会議です" }] }),
        );
        save(
            &c,
            "th",
            &json!({ "messages": [{ "role": "user", "content": "พรุ่งนี้ไปกรุงเทพ" }] }),
        );
        save(
            &c,
            "es",
            &json!({ "messages": [{ "role": "user", "content": "Mañana voy a Madrid" }] }),
        );
        let ids = |query: &str| -> Vec<String> {
            let mut found: Vec<String> = search(&c, query)
                .unwrap()
                .into_iter()
                .map(|h| h.conversation_id)
                .collect();
            found.sort();
            found
        };
        assert_eq!(ids("东京"), vec!["zh"]);
        assert_eq!(ids("東京"), vec!["ja"]);
        assert_eq!(ids("กรุงเทพ"), vec!["th"]);
        assert_eq!(ids("东京 开会"), vec!["zh"]);
        assert!(ids("大阪").is_empty());
        assert_eq!(ids("madrid"), vec!["es"]);
        let hit = &search(&c, "东京").unwrap()[0];
        assert_eq!(hit.snippet, "我们明天去\u{1}东京\u{2}开会");
    }

    #[test]
    fn a_word_with_like_wildcards_is_just_text() {
        let c = database();
        save(
            &c,
            "a",
            &json!({ "messages": [{ "role": "user", "content": "东京 100%" }] }),
        );
        save(
            &c,
            "b",
            &json!({ "messages": [{ "role": "user", "content": "东京 100x" }] }),
        );
        let found = search(&c, "东京 100%").unwrap();
        assert_eq!(
            found.len(),
            2,
            "% splits words, so it never becomes a wildcard"
        );
        assert_eq!(escaped_like("a_b%c"), "a\\_b\\%c");
    }

    #[test]
    fn indexes_again_only_the_messages_that_changed() {
        let c = database();
        let entries = |c: &Connection| -> Vec<(i64, i64, String)> {
            c.prepare("SELECT id, message_index, text FROM search_entries ORDER BY message_index")
                .unwrap()
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };
        save(
            &c,
            "a",
            &json!({ "messages": [
                { "role": "user", "content": "Receta de pan" },
                { "role": "assistant", "content": "Harina y agua" }
            ]}),
        );
        let first = entries(&c);
        save(
            &c,
            "a",
            &json!({ "messages": [
                { "role": "user", "content": "Receta de pan" },
                { "role": "assistant", "content": "Harina, agua y sal" },
                { "role": "user", "content": "¿Cuánto tiempo?" }
            ]}),
        );
        let second = entries(&c);
        // The first message keeps its row; the changed one is replaced and the new one added
        assert_eq!(second[0], first[0]);
        assert_eq!(second[1].2, "Harina, agua y sal");
        assert_eq!(second.len(), 3);
        assert_eq!(search(&c, "sal").unwrap().len(), 1);
        assert!(search(&c, "Harina y agua")
            .unwrap()
            .iter()
            .all(|h| h.snippet.contains("sal")));
        save(
            &c,
            "a",
            &json!({ "messages": [{ "role": "user", "content": "Receta de pan" }] }),
        );
        assert_eq!(entries(&c).len(), 1);
        assert!(search(&c, "tiempo").unwrap().is_empty());
    }

    #[test]
    fn finds_messages_without_accents_and_while_typing() {
        let db = database();
        save(&db, "c1", &conversation());
        let hits = search(&db, "configuracion").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].message_index, 1);
        assert!(hits[0].snippet.contains("\u{1}configuración\u{2}"));
        assert_eq!(search(&db, "docker comp").unwrap().len(), 1);
    }

    #[test]
    fn finds_text_inside_files_and_files_by_name() {
        let db = database();
        save(&db, "c1", &conversation());
        let hits = search(&db, "confidencialidad").unwrap();
        assert_eq!(hits[0].attachment_name.as_deref(), Some("contrato.pdf"));
        assert_eq!(hits[0].message_index, 0);
        assert_eq!(search(&db, "captura").unwrap().len(), 1);
        // An image's base64 is never indexed as words
        assert!(search(&db, "iVBORw0KGgo").unwrap().is_empty());
    }

    #[test]
    fn a_later_save_keeps_files_sent_as_just_their_id() {
        let db = database();
        save(&db, "c1", &conversation());
        let mut later = conversation();
        later["messages"][0]["attachments"] = json!([{ "id": "a1" }]);
        later["messages"]
            .as_array_mut()
            .unwrap()
            .push(json!({ "role": "user", "content": "gracias" }));
        save(&db, "c1", &later);
        keep_attachments(&db, "c1", &HashSet::from(["a1".to_string()])).unwrap();
        assert_eq!(search(&db, "confidencialidad").unwrap().len(), 1);
        assert!(search(&db, "captura").unwrap().is_empty());
        assert_eq!(search(&db, "gracias").unwrap().len(), 1);
    }

    #[test]
    fn one_result_per_conversation_with_its_match_count() {
        let db = database();
        save(
            &db,
            "c1",
            &json!({ "messages": [
                { "role": "user", "content": "redis" }, { "role": "assistant", "content": "redis y más redis" }
            ]}),
        );
        let hits = search(&db, "redis").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].match_count, 2);
    }

    #[test]
    fn forgetting_removes_every_entry() {
        let db = database();
        save(&db, "c1", &conversation());
        forget(&db, "c1").unwrap();
        assert!(search(&db, "docker").unwrap().is_empty());
        assert!(search(&db, "confidencialidad").unwrap().is_empty());
    }

    #[test]
    fn query_syntax_is_always_plain_text() {
        let db = database();
        save(&db, "c1", &conversation());
        for query in [
            "\"",
            "AND",
            "docker OR",
            "-docker",
            "*",
            "NEAR(",
            "docker\" OR \"x",
        ] {
            assert!(search(&db, query).is_ok(), "{query}");
        }
        assert!(search(&db, "  ¿? ").unwrap().is_empty());
    }

    #[test]
    fn document_tags_are_not_searchable_words() {
        let db = database();
        save(
            &db,
            "c1",
            &json!({ "messages": [{ "role": "assistant", "content":
            "Va:\n<nyra-document title=\"Guía de Python\" filename=\"python.md\">\n# Instalar\n</nyra-document>" }]}),
        );
        assert_eq!(search(&db, "guia").unwrap().len(), 1);
        assert!(search(&db, "filename").unwrap().is_empty());
        assert!(search(&db, "nyra").unwrap().is_empty());
    }
}
