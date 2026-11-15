//! Imports Claude Code sessions, stored as one JSON Lines file per session in `~/.claude/projects/<project>/`.
//! Only the conversation is kept: user messages with the files attached to them, and Claude's text replies.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::i18n::{t, t_with};
use crate::projects::{project_for_import, BroadFolders, ImportedTo};
use crate::storage::{now_millis, Database, ImportedConversation};
use crate::util::to_message;

mod tools;
use tools::ToolUse;

const ID_PREFIX: &str = "claude-code:";
const TITLE_LENGTH: usize = 40;
const SUPPORTED_IMAGES: [&str; 3] = ["image/png", "image/jpeg", "image/webp"];

/// Text Claude Code injects into user messages; it was never written by the user.
const INJECTED_TAGS: [&str; 9] = [
    "system-reminder",
    "task-notification",
    "command-name",
    "command-message",
    "command-args",
    "local-command-stdout",
    "local-command-stderr",
    "local-command-caveat",
    "create-pr-command",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    id: String,
    project: String,
    project_path: String,
    title: String,
    updated_at: i64,
    message_count: usize,
    status: ImportStatus,
    /// Only for continued sessions: how many messages came from Claude Code at import and how many Nyra has now
    imported_message_count: Option<usize>,
    nyra_message_count: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
enum ImportStatus {
    New,
    Imported,
    /// Imported and then continued in Nyra; re-importing must not overwrite it
    Continued,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    /// Conversations created or updated in place
    imported: Vec<String>,
    /// Continued sessions whose newer Claude Code version was saved as a separate conversation
    copied: Vec<String>,
    /// Continued sessions with nothing new in Claude Code
    skipped: Vec<String>,
    /// Imported or copied ones left in the chat because their folder is too general to make a project of
    kept_in_chat: Vec<String>,
    /// Imported or copied ones with PDFs whose text the interface still has to read
    pending_pdfs: Vec<String>,
}

struct Session {
    id: String,
    project_path: String,
    title: String,
    updated_at: i64,
    messages: Vec<Value>,
    /// What each reply did in the folder, by the reply's index; only when importing
    tools: HashMap<usize, Vec<ToolUse>>,
}

/// The tools whose work shows on the folder's cards; the rest (commands, searches on the web…) are left out
const FOLDER_TOOLS: [&str; 4] = ["Read", "Edit", "MultiEdit", "Write"];

/// A tool a reply asked for: its id, name and input
type ToolRequest = (String, String, Value);

fn projects_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::util::claude_dir(app)?.join("projects"))
}

fn session_files(projects: &Path) -> Vec<PathBuf> {
    let Ok(projects) = fs::read_dir(projects) else {
        return Vec::new();
    };
    projects
        .flatten()
        .filter_map(|project| fs::read_dir(project.path()).ok())
        .flat_map(|files| files.flatten().map(|file| file.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext == "jsonl"))
        .collect()
}

fn session_id(path: &Path) -> String {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy())
        .unwrap_or_default();
    format!("{ID_PREFIX}{stem}")
}

fn modified_millis(path: &Path) -> i64 {
    fs::metadata(path).map_or(0, |m| crate::util::modified_millis(&m))
}

fn remove_tag(text: &str, tag: &str) -> String {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut result = text.to_string();
    while let Some(start) = result.find(&open) {
        let Some(end) = result[start..].find(&close) else {
            break;
        };
        result.replace_range(start..start + end + close.len(), "");
    }
    result
}

fn clean_user_text(text: &str) -> String {
    let mut cleaned = INJECTED_TAGS
        .iter()
        .fold(text.to_string(), |acc, tag| remove_tag(&acc, tag));
    // IDE integrations add several tags with this prefix (open file, selection, diagnostics…)
    while let Some(start) = cleaned.find("<ide_") {
        let Some(name_end) = cleaned[start + 1..].find(|c: char| c == '>' || c.is_whitespace())
        else {
            break;
        };
        let tag = cleaned[start + 1..start + 1 + name_end].to_string();
        let before = cleaned.len();
        cleaned = remove_tag(&cleaned, &tag);
        if cleaned.len() == before {
            break;
        }
    }
    cleaned.trim().to_string()
}

/// A file the user attached: what Nyra keeps of it, or its name when Nyra can't open it
enum File {
    Attachment(Value),
    Unsupported(String),
}

fn base64_data(source: &Value) -> Option<&str> {
    (source["type"] == "base64").then(|| source["data"].as_str())?
}

fn image_file(block: &Value, id: String, index: usize) -> File {
    let source = &block["source"];
    let mime_type = source["media_type"].as_str().unwrap_or_default();
    let extension = mime_type
        .trim_start_matches("image/")
        .replace("jpeg", "jpg");
    let name = t_with(
        "native.claudeCode.imageName",
        &[("index", &index.to_string())],
    );
    let name = if extension.is_empty() {
        name
    } else {
        format!("{name}.{extension}")
    };
    match base64_data(source) {
        Some(data) if SUPPORTED_IMAGES.contains(&mime_type) => File::Attachment(json!({
            "id": id,
            "kind": "image",
            "name": name,
            "mimeType": mime_type,
            "data": data,
        })),
        _ => File::Unsupported(name),
    }
}

/// A PDF keeps the file only: its text and images are read by the interface once imported (see
/// `complete_imported_pdf`), with the same reader as a PDF attached in Nyra
fn document_file(block: &Value, id: String, index: usize) -> File {
    let source = &block["source"];
    let mime_type = source["media_type"].as_str().unwrap_or_default();
    let title = block["title"]
        .as_str()
        .map(str::trim)
        .filter(|t| !t.is_empty());
    let numbered = || {
        t_with(
            "native.claudeCode.documentName",
            &[("index", &index.to_string())],
        )
    };
    let named = |extension: &str| {
        title.map_or_else(|| format!("{}.{extension}", numbered()), str::to_string)
    };
    match (source["type"].as_str(), mime_type) {
        (Some("base64"), "application/pdf") => match base64_data(source) {
            Some(data) => File::Attachment(json!({
                "id": id,
                "kind": "pdf",
                "name": named("pdf"),
                "mimeType": mime_type,
                "data": "",
                "pdf": data,
            })),
            None => File::Unsupported(named("pdf")),
        },
        (Some("text"), _) => match source["data"].as_str() {
            Some(text) => File::Attachment(json!({
                "id": id,
                "kind": "text",
                "name": named("txt"),
                "mimeType": "text/plain",
                "data": text,
            })),
            None => File::Unsupported(named("txt")),
        },
        _ => File::Unsupported(title.map_or_else(numbered, str::to_string)),
    }
}

/// Listing sessions only needs to know a file is there; its content is read when importing.
#[derive(Clone, Copy, PartialEq)]
enum Files {
    Keep,
    Skip,
}

fn user_message(entry: &Value, files_mode: Files, file_id_prefix: &str) -> Option<Value> {
    let content = &entry["message"]["content"];
    let mut texts = Vec::new();
    let mut files = Vec::new();
    let mut index = 0;
    match content {
        Value::String(text) => texts.push(clean_user_text(text)),
        Value::Array(blocks) => {
            for block in blocks {
                let kind = block["type"].as_str();
                if kind == Some("text") {
                    texts.push(clean_user_text(block["text"].as_str().unwrap_or_default()));
                    continue;
                }
                // Tool results are Claude Code's own plumbing, not part of the conversation
                if !matches!(kind, Some("image" | "document")) {
                    continue;
                }
                index += 1;
                let id = format!("{file_id_prefix}-{}", index - 1);
                let file = match (files_mode, kind) {
                    // Either way it shows up in the message, so the count doesn't depend on its content
                    (Files::Skip, _) => File::Attachment(json!({ "id": id })),
                    (Files::Keep, Some("image")) => image_file(block, id, index),
                    (Files::Keep, _) => document_file(block, id, index),
                };
                match file {
                    File::Attachment(attachment) => files.push(attachment),
                    // Said in the message where it was, so it doesn't vanish without a trace
                    File::Unsupported(name) => texts.push(t_with(
                        "native.claudeCode.unsupportedFile",
                        &[("name", &name)],
                    )),
                }
            }
        }
        _ => {}
    }
    let text = texts
        .into_iter()
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    if text.is_empty() && files.is_empty() {
        return None;
    }
    let mut message = json!({ "role": "user", "content": text });
    if !files.is_empty() {
        message["attachments"] = Value::Array(files);
    }
    Some(message)
}

fn assistant_text(entry: &Value) -> String {
    entry["message"]["content"]
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter(|b| b["type"] == "text")
                .filter_map(|b| b["text"].as_str())
                .map(str::trim)
                .filter(|t| !t.is_empty())
                .collect::<Vec<_>>()
                .join("\n\n")
        })
        .unwrap_or_default()
}

fn folder_tool_requests(entry: &Value) -> Vec<ToolRequest> {
    let Some(blocks) = entry["message"]["content"].as_array() else {
        return Vec::new();
    };
    blocks
        .iter()
        .filter(|b| b["type"] == "tool_use")
        .filter_map(|b| {
            let name = b["name"]
                .as_str()
                .filter(|name| FOLDER_TOOLS.contains(name))?;
            Some((
                b["id"].as_str()?.to_string(),
                name.to_string(),
                b["input"].clone(),
            ))
        })
        .collect()
}

/// The results of the tools that worked, by the id of their request. Claude Code records one result per entry; with
/// several in one, each is known to have worked but not its details.
fn record_results(entry: &Value, results: &mut HashMap<String, Value>) {
    let Some(blocks) = entry["message"]["content"].as_array() else {
        return;
    };
    let worked: Vec<&str> = blocks
        .iter()
        .filter(|b| b["type"] == "tool_result" && b["is_error"] != true)
        .filter_map(|b| b["tool_use_id"].as_str())
        .collect();
    let recorded = match worked.as_slice() {
        [_] => tools::recorded_result(&entry["toolUseResult"]),
        _ => json!({}),
    };
    for id in worked {
        results.insert(id.to_string(), recorded.clone());
    }
}

/// What is kept of each line. It is converted as soon as it is read, so tool output and metadata (most of a
/// session file) are dropped right away instead of staying in memory until the whole file is parsed.
enum Content {
    User(Value),
    /// The text may be empty when the entry only used tools
    Assistant {
        text: String,
        model: String,
        tools: Vec<ToolRequest>,
    },
    /// Attachments, system events, tool results and hidden messages: only links in the parent chain
    Link,
}

struct Entry {
    parent: Option<String>,
    content: Content,
}

fn entry_content(entry: &Value, kind: &str, files_mode: Files, file_id_prefix: &str) -> Content {
    match kind {
        "user" if entry["isMeta"] != true && entry["isCompactSummary"] != true => {
            user_message(entry, files_mode, file_id_prefix).map_or(Content::Link, Content::User)
        }
        "assistant" => {
            let model = entry["message"]["model"].as_str().unwrap_or_default();
            let text = assistant_text(entry);
            let tools = match files_mode {
                Files::Keep => folder_tool_requests(entry),
                Files::Skip => Vec::new(),
            };
            // "<synthetic>" replies are errors Claude Code shows locally, not model output
            if (text.is_empty() && tools.is_empty()) || model == "<synthetic>" {
                Content::Link
            } else {
                Content::Assistant {
                    text,
                    model: model.to_string(),
                    tools,
                }
            }
        }
        _ => Content::Link,
    }
}

/// Follows the parent links back from the latest message, so edited or rewound branches are left out.
fn main_thread(entries: &HashMap<String, Entry>, leaf: &str) -> Vec<String> {
    let mut thread = Vec::new();
    let mut visited = HashSet::new();
    let mut current = Some(leaf.to_string());
    while let Some(id) = current {
        if !visited.insert(id.clone()) {
            break;
        }
        let Some(entry) = entries.get(&id) else {
            break;
        };
        current = entry.parent.clone();
        thread.push(id);
    }
    thread.reverse();
    thread
}

fn parse_session(path: &Path, files_mode: Files) -> Option<Session> {
    let reader = BufReader::new(fs::File::open(path).ok()?);
    let id = session_id(path);
    let mut entries = HashMap::new();
    let mut last_message = None;
    let mut leaf = None;
    let mut ai_title = None;
    let mut custom_title = None;
    let mut project_path = None;
    let mut results = HashMap::new();

    // Line by line: session files can reach hundreds of megabytes
    for line in reader.lines() {
        // A damaged line shouldn't make the whole session unreadable
        let Ok(line) = line else {
            continue;
        };
        let Ok(entry) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        match entry["type"].as_str() {
            Some("ai-title") => ai_title = entry["aiTitle"].as_str().map(str::to_string),
            Some("custom-title") => {
                custom_title = entry["customTitle"].as_str().map(str::to_string)
            }
            Some("last-prompt") => leaf = entry["leafUuid"].as_str().map(str::to_string),
            // Sidechains are subagents working in the background, not the visible conversation
            _ if entry["isSidechain"] == true => {}
            // Every entry with a uuid is a link in the parent chain (attachments and system events too),
            // even though only user and assistant entries become messages
            kind => {
                let Some(uuid) = entry["uuid"].as_str().map(str::to_string) else {
                    continue;
                };
                if project_path.is_none() {
                    project_path = entry["cwd"].as_str().map(str::to_string);
                }
                if matches!(kind, Some("user" | "assistant")) {
                    last_message = Some(uuid.clone());
                }
                if kind == Some("user") && files_mode == Files::Keep {
                    record_results(&entry, &mut results);
                }
                // A compaction starts a new chain whose logical parent is the last message before it
                let parent = entry["parentUuid"]
                    .as_str()
                    .or_else(|| entry["logicalParentUuid"].as_str())
                    .map(str::to_string);
                let content = entry_content(
                    &entry,
                    kind.unwrap_or_default(),
                    files_mode,
                    &format!("{id}-{uuid}"),
                );
                entries.insert(uuid, Entry { parent, content });
            }
        }
    }

    let leaf = leaf
        .filter(|id| entries.contains_key(id))
        .or(last_message)?;
    let mut messages: Vec<Value> = Vec::new();
    let mut requests: HashMap<usize, Vec<ToolRequest>> = HashMap::new();
    // Tools used before the reply's first words go to it once it says something
    let mut waiting = Vec::new();
    for entry_id in main_thread(&entries, &leaf) {
        let Some(entry) = entries.remove(&entry_id) else {
            continue;
        };
        match entry.content {
            Content::User(message) => {
                messages.push(message);
                waiting.clear();
            }
            // One reply is split across several entries around its tool calls; join it back
            Content::Assistant { text, model, tools } => {
                waiting.extend(tools);
                match messages.last_mut() {
                    Some(last) if last["role"] == "assistant" => {
                        if !text.is_empty() {
                            let joined = format!(
                                "{}\n\n{text}",
                                last["content"].as_str().unwrap_or_default()
                            );
                            last["content"] = Value::String(joined);
                        }
                    }
                    _ if text.is_empty() => continue,
                    _ => messages
                        .push(json!({ "role": "assistant", "content": text, "model": model })),
                }
                requests
                    .entry(messages.len() - 1)
                    .or_default()
                    .append(&mut waiting);
            }
            Content::Link => {}
        }
    }
    if messages.is_empty() {
        return None;
    }

    let first_prompt = messages
        .iter()
        .find_map(|m| m["content"].as_str().filter(|t| !t.is_empty()))
        .map(|t| t.chars().take(TITLE_LENGTH).collect::<String>());
    let title = custom_title
        .or(ai_title)
        .or(first_prompt)
        .unwrap_or_else(|| t("native.claudeCode.untitledSession"));

    Some(Session {
        id,
        project_path: project_path.unwrap_or_default(),
        title,
        updated_at: modified_millis(path),
        messages,
        tools: requests
            .into_iter()
            .map(|(index, uses)| (index, tools::worked(uses, &results)))
            .filter(|(_, worked)| !worked.is_empty())
            .collect(),
    })
}

/// Folders Claude Code worked in, taken from the first lines of each session that carry one.
pub fn project_paths(app: &AppHandle) -> Vec<PathBuf> {
    let Ok(projects) = projects_dir(app) else {
        return Vec::new();
    };
    let mut paths = std::collections::BTreeSet::new();
    for file in session_files(&projects) {
        let Ok(reader) = fs::File::open(&file).map(BufReader::new) else {
            continue;
        };
        let cwd = reader
            .lines()
            .take(50)
            .map_while(Result::ok)
            .filter(|line| line.contains("\"cwd\""))
            .find_map(|line| {
                Some(
                    serde_json::from_str::<Value>(&line).ok()?["cwd"]
                        .as_str()?
                        .to_string(),
                )
            });
        if let Some(cwd) = cwd {
            paths.insert(PathBuf::from(cwd));
        }
    }
    paths.into_iter().collect()
}

fn project_name(project_path: &str) -> String {
    Path::new(project_path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| t("native.claudeCode.noProject"))
}

// When it was last written and how long it is: a file read again only if one changed
type FileVersion = (SystemTime, u64);

/// What the list shows of a session
#[derive(Clone)]
struct Listed {
    id: String,
    project_path: String,
    title: String,
    updated_at: i64,
    message_count: usize,
}

/// A session as the list shows it, read again only when its file changed: the files can reach hundreds of megabytes,
/// and the list is opened often
fn listed_session(path: &Path) -> Option<Listed> {
    static READ: OnceLock<Mutex<HashMap<PathBuf, (FileVersion, Listed)>>> = OnceLock::new();
    let read = READ.get_or_init(Mutex::default);
    let metadata = fs::metadata(path).ok()?;
    let version = (metadata.modified().ok()?, metadata.len());
    if let Some((seen, listed)) = read.lock().ok()?.get(path) {
        if *seen == version {
            return Some(listed.clone());
        }
    }
    let session = parse_session(path, Files::Skip)?;
    let listed = Listed {
        id: session.id,
        project_path: session.project_path,
        title: session.title,
        updated_at: session.updated_at,
        message_count: session.messages.len(),
    };
    read.lock()
        .ok()?
        .insert(path.to_path_buf(), (version, listed.clone()));
    Some(listed)
}

#[tauri::command]
pub async fn list_claude_code_sessions(app: AppHandle) -> Result<Vec<SessionInfo>, String> {
    let projects = projects_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let states = app.state::<Database>().imported_states(ID_PREFIX)?;
        let mut sessions: Vec<SessionInfo> = session_files(&projects)
            .iter()
            .filter_map(|path| listed_session(path))
            .map(|s| {
                let state = states.get(&s.id);
                let continued = state.filter(|state| state.edited);
                SessionInfo {
                    status: match state {
                        None => ImportStatus::New,
                        Some(state) if state.edited => ImportStatus::Continued,
                        Some(_) => ImportStatus::Imported,
                    },
                    imported_message_count: continued.map(|state| state.imported_count),
                    nyra_message_count: continued.map(|state| state.message_count),
                    project: project_name(&s.project_path),
                    id: s.id,
                    project_path: s.project_path,
                    title: s.title,
                    updated_at: s.updated_at,
                    message_count: s.message_count,
                }
            })
            .collect();
        sessions.sort_by_key(|s| std::cmp::Reverse(s.updated_at));
        Ok(sessions)
    })
    .await
    .map_err(to_message)?
}

/// The conversation as Nyra stores it: in the Código project of the folder Claude Code worked in (made for it if
/// there is none), with the folder connected and the cards of what was done in it. A folder that no longer exists
/// leaves it in the chat. Also says whether it stayed there only because its folder is too general.
fn stored_data(
    db: &Database,
    mut session: Session,
    new_project_id: &str,
    broad: &BroadFolders,
) -> Result<(Value, bool), String> {
    let in_chat = |messages: &Vec<Value>| json!({ "messages": messages });
    let folder = crate::util::real_path(Path::new(&session.project_path))
        .ok()
        .filter(|folder| folder.is_dir());
    let Some(folder) = folder else {
        return Ok((in_chat(&session.messages), false));
    };
    let imported_to = db.try_with(|c| project_for_import(c, &folder, new_project_id, broad))?;
    let ImportedTo::Project(project) = imported_to else {
        return Ok((in_chat(&session.messages), true));
    };
    for (index, uses) in &session.tools {
        if let Some(reply) = session.messages.get_mut(*index) {
            tools::add_folder_cards(reply, uses, &project.path, &project.name);
        }
    }
    let data = json!({
        "messages": session.messages,
        "projectId": project.id,
        "workspace": { "path": project.path, "name": project.name },
    });
    Ok((data, false))
}

/// A PDF of the conversation already read from the same file keeps what was read, so importing again doesn't read it
/// once more. Returns whether any is still waiting to be read.
fn keep_read_pdfs(data: &mut Value, read: &HashMap<String, Value>) -> bool {
    let mut waiting = false;
    let attachments = data["messages"]
        .as_array_mut()
        .into_iter()
        .flatten()
        .filter_map(|message| message.get_mut("attachments").and_then(Value::as_array_mut))
        .flatten();
    for attachment in attachments {
        if attachment["kind"] != "pdf" || attachment.get("pageCount").is_some() {
            continue;
        }
        let id = attachment["id"].as_str().unwrap_or_default();
        match read.get(id) {
            Some(done) if done["pdf"] == attachment["pdf"] => *attachment = done.clone(),
            _ => waiting = true,
        }
    }
    waiting
}

/// Untouched conversations are updated in place. A session continued in Nyra is never overwritten:
/// if Claude Code has new messages, that version is saved as a separate conversation instead.
#[tauri::command]
pub async fn import_claude_code_sessions(
    app: AppHandle,
    ids: Vec<String>,
) -> Result<ImportResult, String> {
    let projects = projects_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let wanted: HashSet<String> = ids.into_iter().collect();
        let db = app.state::<Database>();
        let states = db.imported_states(ID_PREFIX)?;
        let mut result = ImportResult::default();
        let broad = BroadFolders::of(&app);
        // Paths come from scanning the folder, never from the frontend, so ids can't point elsewhere
        for (n, path) in session_files(&projects)
            .iter()
            .filter(|p| wanted.contains(&session_id(p)))
            .enumerate()
        {
            let Some(session) = parse_session(path, Files::Keep) else {
                continue;
            };
            let state = states.get(&session.id);
            if state.is_some_and(|s| s.edited && session.messages.len() <= s.imported_count) {
                result.skipped.push(session.id);
                continue;
            }
            let id = session.id.clone();
            let new_project_id = format!("claude-code-{}-{n}", now_millis());
            let mut conversation = ImportedConversation {
                id: session.id.clone(),
                title: session.title.clone(),
                updated_at: session.updated_at,
                message_count: session.messages.len(),
                data: String::new(),
            };
            let (mut data, kept_in_chat) = stored_data(&db, session, &new_project_id, &broad)?;
            let copied = state.is_some_and(|state| state.edited);
            if copied {
                // An earlier copy nobody touched is refreshed instead of piling up another one
                let copy_prefix = format!("{id}:");
                let reusable_copy = states
                    .iter()
                    .filter(|(id, copy)| id.starts_with(&copy_prefix) && !copy.edited)
                    .map(|(id, _)| id)
                    .max();
                conversation.id = match reusable_copy {
                    Some(id) => id.clone(),
                    None => format!("{copy_prefix}{}", now_millis()),
                };
                conversation.title = t_with(
                    "native.claudeCode.copyTitle",
                    &[("title", &conversation.title)],
                );
            }
            // Once its id is known, which is where the PDFs read before are; a copy also has the original's
            let mut read = db.read_pdfs(&conversation.id)?;
            if copied {
                read.extend(db.read_pdfs(&id)?);
            }
            let waiting = keep_read_pdfs(&mut data, &read);
            conversation.data = data.to_string();
            db.save_imported(&conversation)?;
            let saved = conversation.id;
            if waiting {
                result.pending_pdfs.push(saved.clone());
            }
            if kept_in_chat {
                result.kept_in_chat.push(saved.clone());
            }
            if copied {
                result.copied.push(saved);
            } else {
                result.imported.push(saved);
            }
        }
        crate::tray::refresh_recent(&app);
        Ok(result)
    })
    .await
    .map_err(to_message)?
}

/// The interface read an imported PDF (its text, and the images vision models need); only Claude Code's
/// conversations have PDFs waiting for that
#[tauri::command]
pub async fn complete_imported_pdf(
    app: AppHandle,
    conversation_id: String,
    attachment: String,
) -> Result<(), String> {
    if !conversation_id.starts_with(ID_PREFIX) {
        return Err(t("native.storage.attachmentGone"));
    }
    let read: Value = serde_json::from_str(&attachment).map_err(to_message)?;
    crate::workspace::blocking(move || {
        app.state::<Database>()
            .complete_pending_pdf(&conversation_id, &read)
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_FILE: AtomicUsize = AtomicUsize::new(0);

    fn session_from(lines: &[Value]) -> Option<Session> {
        let n = NEXT_FILE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("nyra-test-{}-{n}.jsonl", std::process::id()));
        let content: Vec<String> = lines.iter().map(Value::to_string).collect();
        fs::write(&path, content.join("\n")).expect("write test session");
        let session = parse_session(&path, Files::Keep);
        let _ = fs::remove_file(&path);
        session
    }

    fn user(uuid: &str, parent: Option<&str>, content: Value) -> Value {
        json!({ "type": "user", "uuid": uuid, "parentUuid": parent, "cwd": "/proyectos/demo",
                "message": { "role": "user", "content": content } })
    }

    fn assistant(uuid: &str, parent: &str, model: &str, blocks: Value) -> Value {
        json!({ "type": "assistant", "uuid": uuid, "parentUuid": parent,
                "message": { "role": "assistant", "model": model, "content": blocks } })
    }

    fn text(t: &str) -> Value {
        json!([{ "type": "text", "text": t }])
    }

    #[test]
    fn rebuilds_only_the_visible_conversation() {
        let session = session_from(&[
            json!({ "type": "ai-title", "aiTitle": "Título generado" }),
            user("u1", None, json!("Hola <system-reminder>interno</system-reminder>")),
            // One reply split around a tool call, with thinking and the tool result in between
            assistant("a1", "u1", "claude-x", json!([
                { "type": "thinking", "thinking": "pensando" },
                { "type": "text", "text": "Respuesta 1" },
                { "type": "tool_use", "name": "Bash" }
            ])),
            user("t1", Some("a1"), json!([{ "type": "tool_result", "content": "salida" }])),
            assistant("a2", "t1", "claude-x", text("continuación")),
            json!({ "type": "attachment", "uuid": "at1", "parentUuid": "a2" }),
            user("u2", Some("at1"), json!([
                { "type": "text", "text": "Segunda" },
                { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "AAA" } }
            ])),
            // The user rewound and asked again: only the branch that continued counts
            assistant("a3", "u2", "claude-x", text("Rama descartada")),
            assistant("a4", "u2", "claude-x", text("Rama buena")),
            json!({ "type": "user", "uuid": "m1", "parentUuid": "a4", "isMeta": true,
                    "message": { "role": "user", "content": "meta" } }),
            user("u3", Some("m1"), json!("Tercera")),
            json!({ "type": "user", "uuid": "sc", "parentUuid": "u3", "isSidechain": true,
                    "message": { "role": "user", "content": "subagente" } }),
            assistant("a5", "u3", "<synthetic>", text("error local")),
            user("cmd", Some("a5"), json!("<command-name>/clear</command-name>")),
            json!({ "type": "custom-title", "customTitle": "Mi título" }),
            json!({ "type": "last-prompt", "leafUuid": "cmd" }),
        ])
        .expect("session has messages");

        let summary: Vec<(String, String)> = session
            .messages
            .iter()
            .map(|m| {
                (
                    m["role"].as_str().unwrap().to_string(),
                    m["content"].as_str().unwrap().to_string(),
                )
            })
            .collect();
        assert_eq!(
            summary,
            vec![
                ("user".into(), "Hola".into()),
                ("assistant".into(), "Respuesta 1\n\ncontinuación".into()),
                ("user".into(), "Segunda".into()),
                ("assistant".into(), "Rama buena".into()),
                ("user".into(), "Tercera".into()),
            ]
        );
        assert_eq!(session.messages[1]["model"], "claude-x");
        assert_eq!(
            session.messages[2]["attachments"][0]["mimeType"],
            "image/png"
        );
        assert_eq!(session.title, "Mi título");
        assert_eq!(session.project_path, "/proyectos/demo");
    }

    #[test]
    fn follows_a_compaction_back_to_the_earlier_messages() {
        let session = session_from(&[
            user("u1", None, json!("Antes")),
            assistant("a1", "u1", "claude-x", text("Respuesta antes")),
            json!({ "type": "system", "uuid": "sys", "parentUuid": null, "logicalParentUuid": "a1" }),
            json!({ "type": "user", "uuid": "sum", "parentUuid": "sys", "isCompactSummary": true,
                    "message": { "role": "user", "content": "resumen interno" } }),
            user("u2", Some("sum"), json!("Después")),
        ])
        .expect("session has messages");
        let contents: Vec<&str> = session
            .messages
            .iter()
            .map(|m| m["content"].as_str().unwrap())
            .collect();
        assert_eq!(contents, vec!["Antes", "Respuesta antes", "Después"]);
    }

    #[test]
    fn falls_back_to_the_first_prompt_for_the_title() {
        let session = session_from(&[user(
            "u1",
            None,
            json!("Una pregunta bastante larga sobre cómo funciona el importador"),
        )])
        .expect("session has messages");
        assert_eq!(session.title.chars().count(), TITLE_LENGTH);
    }

    #[test]
    fn keeps_attached_files_and_names_the_ones_nyra_cannot_open() {
        let session = session_from(&[user(
            "u1",
            None,
            json!([
                { "type": "text", "text": "Mira esto" },
                { "type": "document", "title": "informe.pdf",
                  "source": { "type": "base64", "media_type": "application/pdf", "data": "JVBE" } },
                { "type": "document", "source": { "type": "text", "media_type": "text/plain", "data": "notas" } },
                { "type": "image", "source": { "type": "base64", "media_type": "image/gif", "data": "R0lG" } }
            ]),
        )])
        .expect("session has messages");
        let message = &session.messages[0];
        let attachments = message["attachments"].as_array().unwrap();
        assert_eq!(attachments.len(), 2);
        assert_eq!(attachments[0]["kind"], "pdf");
        assert_eq!(attachments[0]["name"], "informe.pdf");
        assert_eq!(attachments[0]["pdf"], "JVBE");
        // Waiting for the interface to read it
        assert!(attachments[0].get("pageCount").is_none());
        assert_eq!(attachments[1]["kind"], "text");
        assert_eq!(attachments[1]["data"], "notas");
        let text = message["content"].as_str().unwrap();
        assert!(text.starts_with("Mira esto\n\n"));
        assert!(text.contains(".gif"));
    }

    #[test]
    fn a_message_with_only_an_unsupported_file_still_shows_up() {
        let line = user(
            "u1",
            None,
            json!([{ "type": "image", "source": { "type": "base64", "media_type": "image/gif", "data": "R0lG" } }]),
        );
        let session = session_from(std::slice::from_ref(&line)).expect("the file is mentioned");
        assert!(session.messages[0]["attachments"].is_null());
        // The list counts it the same way
        let path = std::env::temp_dir().join(format!("nyra-test-{}-gif.jsonl", std::process::id()));
        fs::write(&path, line.to_string()).unwrap();
        let listed = parse_session(&path, Files::Skip).expect("listed too");
        let _ = fs::remove_file(&path);
        assert_eq!(listed.messages.len(), session.messages.len());
    }

    #[test]
    fn gives_each_reply_the_folder_tools_that_worked() {
        let session = session_from(&[
            user("u1", None, json!("Arregla el título")),
            // Tools before the reply's first words still belong to it
            assistant("a1", "u1", "claude-x", json!([
                { "type": "tool_use", "id": "leer", "name": "Read", "input": { "file_path": "/p/a.ts" } }
            ])),
            json!({ "type": "user", "uuid": "r1", "parentUuid": "a1",
                    "toolUseResult": { "type": "text", "file": { "content": "abc", "startLine": 1, "numLines": 1, "totalLines": 1 } },
                    "message": { "role": "user", "content": [{ "type": "tool_result", "tool_use_id": "leer" }] } }),
            assistant("a2", "r1", "claude-x", json!([
                { "type": "text", "text": "Lo cambio" },
                { "type": "tool_use", "id": "editar", "name": "Edit", "input": { "file_path": "/p/a.ts" } },
                { "type": "tool_use", "id": "orden", "name": "Bash", "input": { "command": "ls" } }
            ])),
            // Refused by the user: it changed nothing
            json!({ "type": "user", "uuid": "r2", "parentUuid": "a2",
                    "message": { "role": "user", "content": [{ "type": "tool_result", "tool_use_id": "editar", "is_error": true }] } }),
        ])
        .expect("session has messages");
        assert_eq!(session.messages.len(), 2);
        let used: Vec<&str> = session.tools[&1].iter().map(|t| t.id.as_str()).collect();
        assert_eq!(used, vec!["leer"]);
        assert_eq!(session.tools[&1][0].result["file"]["size"], 3);
    }

    #[test]
    fn keeps_the_pdfs_already_read_from_the_same_file() {
        let pending =
            |id: &str, file: &str| json!({ "id": id, "kind": "pdf", "data": "", "pdf": file });
        let mut data = json!({ "messages": [{ "role": "user", "content": "", "attachments": [
            pending("igual", "JVBE"), pending("cambiado", "JVBF"), pending("nuevo", "JVBG")
        ] }] });
        let read =
            |file: &str| json!({ "kind": "pdf", "data": "texto", "pdf": file, "pageCount": 2 });
        let stored = HashMap::from([
            ("igual".to_string(), read("JVBE")),
            ("cambiado".to_string(), read("otro")),
        ]);
        assert!(keep_read_pdfs(&mut data, &stored));
        let attachments = &data["messages"][0]["attachments"];
        assert_eq!(attachments[0]["data"], "texto");
        // Another file under the same id is read again, like a new one
        assert!(attachments[1].get("pageCount").is_none());
        assert!(attachments[2].get("pageCount").is_none());

        let mut only_read = json!({ "messages": [{ "role": "user", "content": "", "attachments": [pending("igual", "JVBE")] }] });
        assert!(!keep_read_pdfs(&mut only_read, &stored));
    }

    #[test]
    fn listing_counts_images_without_reading_them() {
        let path =
            std::env::temp_dir().join(format!("nyra-test-{}-list.jsonl", std::process::id()));
        let line = user(
            "u1",
            None,
            json!([{ "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "AAAA" } }]),
        );
        fs::write(&path, line.to_string()).unwrap();
        let listed = parse_session(&path, Files::Skip).expect("an image-only message still counts");
        let _ = fs::remove_file(&path);
        assert_eq!(listed.messages.len(), 1);
        assert!(listed.messages[0]["attachments"][0].get("data").is_none());
    }

    #[test]
    fn a_session_with_nothing_to_show_is_skipped() {
        assert!(session_from(&[user(
            "u1",
            None,
            json!("<command-name>/clear</command-name>")
        )])
        .is_none());
    }

    #[test]
    fn removes_injected_tags_but_keeps_what_the_user_wrote() {
        let raw = "<ide_opened_file>a.ts</ide_opened_file>Arregla esto <ide_selection>código</ide_selection>por favor";
        assert_eq!(clean_user_text(raw), "Arregla esto por favor");
        assert_eq!(
            clean_user_text("Usa <div> en el HTML"),
            "Usa <div> en el HTML"
        );
    }
}
