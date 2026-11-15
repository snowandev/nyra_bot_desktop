//! Search a connected folder by meaning. Its text files are cut into fragments and each one gets an embedding (a
//! vector the frontend gets from a local embedding model), so a question finds the code about it even in other words
//! or another language. The vectors stay in the database and only the files that changed are done again. The same
//! rules as reading hold: only folders the user picked and only files of their index.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use rusqlite::types::ValueRef;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::i18n::t;
use crate::storage::Database;
use crate::util::to_message;
use crate::workspace::{
    allowed_root, blocking, indexed_file, is_image, is_pdf, modified_millis, read_text, Workspaces,
    MAX_SEARCH_FILE_BYTES,
};

pub const SCHEMA: &str = "
    CREATE TABLE workspace_chunks (
        root TEXT NOT NULL,
        path TEXT NOT NULL,
        modified INTEGER NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        model TEXT NOT NULL,
        vector BLOB NOT NULL,
        PRIMARY KEY (root, path, start_line)
    );
";

/// About a function or a section of a document: enough to say what it does, small enough to be about one thing
const CHUNK_LINES: usize = 40;
/// Fragments overlap, so something cut at a border is still whole in one of them
const CHUNK_STEP: usize = 30;
const CHUNK_MAX_CHARS: usize = 2400;
const MAX_CHUNKS_PER_FILE: usize = 200;
const MAX_MATCHES: usize = 12;
/// A file done with nothing to search in (empty, only blank lines) keeps this mark, so it isn't done again
const EMPTY_MARK: usize = 0;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Chunk {
    path: String,
    modified: i64,
    start_line: usize,
    end_line: usize,
    /// Empty for a file with nothing to search in: it is stored as done, without a vector
    text: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddedChunk {
    path: String,
    modified: i64,
    start_line: usize,
    end_line: usize,
    vector: Vec<f32>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MeaningMatch {
    path: String,
    start_line: usize,
    end_line: usize,
    score: f32,
    /// The lines as they are now in the file
    text: String,
}

/// Fragments of a file, with their lines counted from 1
fn chunks_of(text: &str) -> Vec<(usize, usize, String)> {
    let lines: Vec<&str> = text.lines().collect();
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < lines.len() && chunks.len() < MAX_CHUNKS_PER_FILE {
        let end = (start + CHUNK_LINES).min(lines.len());
        let body: String = lines[start..end]
            .join("\n")
            .chars()
            .take(CHUNK_MAX_CHARS)
            .collect();
        if !body.trim().is_empty() {
            chunks.push((start + 1, end, body));
        }
        if end == lines.len() {
            break;
        }
        start += CHUNK_STEP;
    }
    chunks
}

fn to_bytes(vector: &[f32]) -> Vec<u8> {
    vector.iter().flat_map(|v| v.to_le_bytes()).collect()
}

fn norm(vector: &[f32]) -> f32 {
    vector.iter().map(|x| x * x).sum::<f32>().sqrt()
}

/// Straight from the stored bytes, so a question doesn't copy every vector of the folder first
fn cosine(query: &[f32], query_norm: f32, stored: &[u8]) -> f32 {
    let (mut dot, mut stored_norm) = (0.0f32, 0.0f32);
    for (x, bytes) in query.iter().zip(stored.as_chunks::<4>().0) {
        let y = f32::from_le_bytes(*bytes);
        dot += x * y;
        stored_norm += y * y;
    }
    if query_norm == 0.0 || stored_norm == 0.0 {
        0.0
    } else {
        dot / (query_norm * stored_norm.sqrt())
    }
}

/// The files of the index that can be searched by meaning, with when they last changed
fn searchable(root: &Path, indexed: &HashSet<String>) -> HashMap<String, i64> {
    indexed
        .iter()
        .filter(|path| !is_pdf(path) && !is_image(path))
        .filter_map(|path| {
            let metadata = fs::metadata(root.join(path)).ok()?;
            (metadata.len() <= MAX_SEARCH_FILE_BYTES)
                .then(|| (path.clone(), modified_millis(&metadata)))
        })
        .collect()
}

/// What has to be done again: files that are new or changed since their vectors were made, or made with another
/// model. Vectors of files gone from the index, or of another model, are dropped.
fn pending(
    connection: &Connection,
    root: &str,
    model: &str,
    current: &HashMap<String, i64>,
) -> rusqlite::Result<Vec<String>> {
    connection.execute(
        "DELETE FROM workspace_chunks WHERE root = ?1 AND model != ?2",
        params![root, model],
    )?;
    let mut statement = connection.prepare(
        "SELECT path, MIN(modified) FROM workspace_chunks WHERE root = ?1 GROUP BY path",
    )?;
    let stored: HashMap<String, i64> = statement
        .query_map(params![root], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    for path in stored.keys().filter(|path| !current.contains_key(*path)) {
        connection.execute(
            "DELETE FROM workspace_chunks WHERE root = ?1 AND path = ?2",
            params![root, path],
        )?;
    }
    let mut paths: Vec<String> = current
        .iter()
        .filter(|(path, modified)| stored.get(*path) != Some(modified))
        .map(|(path, _)| path.clone())
        .collect();
    paths.sort();
    Ok(paths)
}

/// The vectors of whole files: what each of them had before is replaced
fn store(
    connection: &Connection,
    root: &str,
    model: &str,
    chunks: &[EmbeddedChunk],
) -> rusqlite::Result<()> {
    let transaction = connection.unchecked_transaction()?;
    let paths: HashSet<&str> = chunks.iter().map(|c| c.path.as_str()).collect();
    for path in paths {
        transaction.execute(
            "DELETE FROM workspace_chunks WHERE root = ?1 AND path = ?2",
            params![root, path],
        )?;
    }
    for chunk in chunks {
        transaction.execute(
            "INSERT OR REPLACE INTO workspace_chunks
                (root, path, modified, start_line, end_line, model, vector)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                root,
                chunk.path,
                chunk.modified,
                chunk.start_line as i64,
                chunk.end_line as i64,
                model,
                to_bytes(&chunk.vector)
            ],
        )?;
    }
    transaction.commit()
}

/// The fragments closest in meaning, at most one per stretch of a file: overlapping fragments say the same
fn closest(
    connection: &Connection,
    root: &str,
    model: &str,
    query: &[f32],
    limit: usize,
) -> rusqlite::Result<Vec<(String, usize, usize, f32)>> {
    let mut statement = connection.prepare(
        "SELECT path, start_line, end_line, vector FROM workspace_chunks
         WHERE root = ?1 AND model = ?2 AND length(vector) > 0",
    )?;
    let query_norm = norm(query);
    let mut scored: Vec<(String, usize, usize, f32)> = statement
        .query_map(params![root, model], |row| {
            let score = match row.get_ref(3)? {
                ValueRef::Blob(stored) => cosine(query, query_norm, stored),
                _ => 0.0,
            };
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)? as usize,
                row.get::<_, i64>(2)? as usize,
                score,
            ))
        })?
        .collect::<rusqlite::Result<_>>()?;
    scored.sort_by(|a, b| b.3.total_cmp(&a.3));
    let mut chosen: Vec<(String, usize, usize, f32)> = Vec::new();
    for candidate in scored {
        let overlaps = chosen
            .iter()
            .any(|c| c.0 == candidate.0 && c.1 <= candidate.2 && candidate.1 <= c.2);
        if !overlaps {
            chosen.push(candidate);
        }
        if chosen.len() == limit {
            break;
        }
    }
    Ok(chosen)
}

/// The vectors of a folder no conversation uses any more
pub(crate) fn forget_root(connection: &Connection, root: &str) -> rusqlite::Result<()> {
    connection.execute(
        "DELETE FROM workspace_chunks WHERE root = ?1",
        params![root],
    )?;
    Ok(())
}

fn root_key(root: &Path) -> String {
    root.to_string_lossy().into_owned()
}

#[tauri::command]
pub async fn meaning_pending(
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    root: String,
    model: String,
) -> Result<Vec<String>, String> {
    let root = allowed_root(&db, &workspaces, &root)?;
    let indexed = workspaces.indexed(&root)?;
    let walked = root.clone();
    let current = blocking(move || searchable(&walked, &indexed)).await?;
    db.with(|c| pending(c, &root_key(&root), &model, &current))
}

/// The fragments of these files as they are now; only files of the folder's index
#[tauri::command]
pub async fn meaning_chunks(
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    root: String,
    paths: Vec<String>,
) -> Result<Vec<Chunk>, String> {
    let root = allowed_root(&db, &workspaces, &root)?;
    let indexed = workspaces.indexed(&root)?;
    blocking(move || {
        let mut out = Vec::new();
        for path in paths
            .into_iter()
            .filter(|p| indexed.contains(p) && !is_pdf(p) && !is_image(p))
        {
            let Some((full, size)) = indexed_file(&root, &path) else {
                continue;
            };
            let Ok(metadata) = fs::metadata(&full) else {
                continue;
            };
            let modified = modified_millis(&metadata);
            let chunks = if size > MAX_SEARCH_FILE_BYTES {
                Vec::new()
            } else {
                read_text(&full).map(|t| chunks_of(&t)).unwrap_or_default()
            };
            if chunks.is_empty() {
                out.push(Chunk {
                    path,
                    modified,
                    start_line: EMPTY_MARK,
                    end_line: EMPTY_MARK,
                    text: String::new(),
                });
                continue;
            }
            for (start_line, end_line, text) in chunks {
                out.push(Chunk {
                    path: path.clone(),
                    modified,
                    start_line,
                    end_line,
                    text,
                });
            }
        }
        out
    })
    .await
}

#[tauri::command]
pub async fn meaning_store(
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    root: String,
    model: String,
    chunks: Vec<EmbeddedChunk>,
) -> Result<(), String> {
    let root = allowed_root(&db, &workspaces, &root)?;
    let indexed = workspaces.indexed(&root)?;
    if chunks.iter().any(|c| !indexed.contains(&c.path)) {
        return Err(t("native.workspace.fileNotInConnectedFolder"));
    }
    db.with(|c| store(c, &root_key(&root), &model, &chunks))
}

/// Every vector of the folder is compared, which in a large one takes a while: on a thread and a connection of its
/// own, so neither the app nor saving a conversation waits for it
#[tauri::command]
pub async fn meaning_search(
    app: AppHandle,
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    root: String,
    model: String,
    vector: Vec<f32>,
    limit: usize,
) -> Result<Vec<MeaningMatch>, String> {
    let root = allowed_root(&db, &workspaces, &root)?;
    let indexed = workspaces.indexed(&root)?;
    blocking(move || {
        let reader = Database::open_reader(&app)?;
        let found = closest(
            &reader,
            &root_key(&root),
            &model,
            &vector,
            limit.clamp(1, MAX_MATCHES),
        )
        .map_err(to_message)?;
        Ok(found
            .into_iter()
            .filter(|(path, ..)| indexed.contains(path))
            .filter_map(|(path, start_line, end_line, score)| {
                let (full, size) = indexed_file(&root, &path)?;
                if size > MAX_SEARCH_FILE_BYTES {
                    return None;
                }
                let text = read_text(&full).ok()?;
                let lines: Vec<&str> = text.lines().collect();
                let end = end_line.min(lines.len());
                (start_line >= 1 && start_line <= end).then(|| MeaningMatch {
                    text: lines[start_line - 1..end].join("\n"),
                    path,
                    start_line,
                    end_line: end,
                    score,
                })
            })
            .collect())
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(SCHEMA).unwrap();
        connection
    }

    fn embedded(path: &str, modified: i64, start_line: usize, vector: Vec<f32>) -> EmbeddedChunk {
        EmbeddedChunk {
            path: path.to_string(),
            modified,
            start_line,
            end_line: start_line + 39,
            vector,
        }
    }

    #[test]
    fn cuts_a_file_into_overlapping_fragments() {
        let text: String = (1..=100).map(|n| format!("line {n}\n")).collect();
        let chunks = chunks_of(&text);
        let ranges: Vec<(usize, usize)> = chunks.iter().map(|c| (c.0, c.1)).collect();
        assert_eq!(ranges, [(1, 40), (31, 70), (61, 100)]);
        assert!(chunks_of("\n\n   \n").is_empty());
    }

    #[test]
    fn redoes_only_new_and_changed_files_and_drops_the_rest() {
        let c = database();
        store(
            &c,
            "/r",
            "m",
            &[
                embedded("a.ts", 1, 1, vec![1.0]),
                embedded("gone.ts", 1, 1, vec![1.0]),
            ],
        )
        .unwrap();
        let current = HashMap::from([("a.ts".to_string(), 1), ("b.ts".to_string(), 5)]);
        assert_eq!(pending(&c, "/r", "m", &current).unwrap(), ["b.ts"]);
        let changed = HashMap::from([("a.ts".to_string(), 2), ("b.ts".to_string(), 5)]);
        assert_eq!(pending(&c, "/r", "m", &changed).unwrap(), ["a.ts", "b.ts"]);
        let left: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM workspace_chunks WHERE path = 'gone.ts'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(left, 0);
        // Another model: everything again
        assert_eq!(
            pending(&c, "/r", "other", &current).unwrap(),
            ["a.ts", "b.ts"]
        );
    }

    #[test]
    fn finds_the_closest_fragments_once_per_stretch() {
        let c = database();
        store(
            &c,
            "/r",
            "m",
            &[
                embedded("auth.java", 1, 1, vec![0.9, 0.1]),
                embedded("auth.java", 1, 31, vec![0.8, 0.2]),
                embedded("cors.java", 1, 1, vec![0.1, 0.9]),
                embedded("empty.txt", 1, EMPTY_MARK, vec![]),
            ],
        )
        .unwrap();
        let found = closest(&c, "/r", "m", &[1.0, 0.0], 3).unwrap();
        let order: Vec<(&str, usize)> = found.iter().map(|f| (f.0.as_str(), f.1)).collect();
        // The second auth.java fragment overlaps the first, so cors.java comes next
        assert_eq!(order, [("auth.java", 1), ("cors.java", 1)]);
    }

    #[test]
    fn compares_vectors_as_they_are_stored() {
        let vector = [0.25, -1.5, 3.0];
        let same = cosine(&vector, norm(&vector), &to_bytes(&vector));
        assert!((same - 1.0).abs() < 1e-6);
        let opposite = cosine(&vector, norm(&vector), &to_bytes(&vector.map(|x| -x)));
        assert!((opposite + 1.0).abs() < 1e-6);
        assert_eq!(cosine(&vector, norm(&vector), &to_bytes(&[0.0; 3])), 0.0);
    }
}
