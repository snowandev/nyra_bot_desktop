//! MCP servers the user adds: programs on this computer that offer tools (an online account, a database, a folder…),
//! started when Settings or a reply needs them and spoken to over their standard input and output with the official
//! SDK. Their configuration, without secrets, is a file in the app's data folder; the values of their variables go to
//! the system keychain, like the API keys.

use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::Duration;

use rmcp::model::CallToolRequestParams;
use rmcp::service::RunningService;
use rmcp::transport::TokioChildProcess;
use rmcp::{RoleClient, ServiceExt};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager, State};
use tokio::io::AsyncReadExt;
use tokio::sync::Mutex;

use crate::i18n::{t, t_with};
use crate::secrets::{forget_api_key, load_api_key, save_api_key};
use crate::util::{data_dir, to_message, write_atomically};

const CONFIG_FILE: &str = "mcp_servers.json";
// The tools each server offered the last time it ran, so a reply can offer them without starting it
const TOOLS_FILE: &str = "mcp_tools.json";
// Each server's icon, downloaded once
const ICONS_FILE: &str = "mcp_icons.json";
const MAX_ICON_BYTES: usize = 256 * 1024;
const ICON_TIMEOUT: Duration = Duration::from_secs(10);
// What an <img> shows; anything else a server points to is left out
const ICON_TYPES: [&str; 7] = [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "image/x-icon",
    "image/vnd.microsoft.icon",
];
/// Sent when a server's icon arrives, with its id, so the pages showing icons read them again
pub const ICON_EVENT: &str = "mcp-icon";
// The id names the server's keychain entry ("mcp-<id>"), so it stays a short plain token
const ID_MAX: usize = 24;
// The first start may install the server (npx -y, uvx), which takes a while
const CONNECT_TIMEOUT: Duration = Duration::from_secs(90);
const CALL_TIMEOUT: Duration = Duration::from_secs(120);
// What a server wrote on its error output: the newest of it is kept for Settings, and its end explains a failure to
// start
const LOG_KEPT: usize = 20_000;
const FAILURE_DETAIL: usize = 2_000;
// A tool's text beyond this is cut: the model reads it all, and a huge listing would fill its context
const MAX_RESULT_CHARS: usize = 60_000;

/// A server as the user set it up. Its variables are only named here; their values are in the keychain.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    #[serde(default)]
    id: String,
    name: String,
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env_names: Vec<String>,
    #[serde(default = "enabled_by_default")]
    enabled: bool,
    // Tools the user let run without asking each time
    #[serde(default)]
    always_allowed: Vec<String>,
    // Tools the model isn't told about; a list of those off, so new ones a server adds are on
    #[serde(default)]
    disabled_tools: Vec<String>,
}

fn enabled_by_default() -> bool {
    true
}

/// A tool a server offers, as the model and Settings need it
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct McpTool {
    name: String,
    title: Option<String>,
    description: String,
    input_schema: Value,
    // The server says it only reads; a hint, never a reason to skip asking unless the user chose so
    read_only: bool,
}

/// What a tool returned: its text, its images (base64) and whether it says it failed
#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct McpCallResult {
    text: String,
    images: Vec<McpImage>,
    is_error: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct McpImage {
    mime_type: String,
    data: String,
}

struct Connection {
    client: RunningService<RoleClient, ()>,
    tools: Vec<McpTool>,
}

// One server's connection, locked while it starts so it starts once; the others don't wait for it
type Slot = Arc<Mutex<Option<Arc<Connection>>>>;
// What a server wrote on its error output since it last started
type Log = Arc<StdMutex<String>>;

/// The servers running now, by id; one start each, kept while Nyra is open
#[derive(Default)]
pub struct McpConnections {
    open: StdMutex<HashMap<String, Slot>>,
    logs: StdMutex<HashMap<String, Log>>,
}

// Never held across an await, so a panic elsewhere is the only way to poison it, and the data is still usable
use crate::util::lock;

impl McpConnections {
    fn slots(&self) -> std::sync::MutexGuard<'_, HashMap<String, Slot>> {
        lock(&self.open)
    }

    /// An empty log for a start, replacing the last one
    fn new_log(&self, id: &str) -> Log {
        let log = Log::default();
        lock(&self.logs).insert(id.to_string(), Arc::clone(&log));
        log
    }
}

/// The end of a text, from a character boundary
fn tail(text: &str, max: usize) -> &str {
    let from = text.len().saturating_sub(max);
    let from = (from..=text.len())
        .find(|i| text.is_char_boundary(*i))
        .unwrap_or(text.len());
    &text[from..]
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(CONFIG_FILE))
}

fn read_servers(app: &AppHandle) -> Result<Vec<McpServer>, String> {
    match fs::read_to_string(config_path(app)?) {
        Ok(text) => serde_json::from_str(&text).map_err(|_| t("native.mcp.damagedConfig")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(to_message(e)),
    }
}

/// Reads, changes and writes the servers as one step, never across an await: two changes at once (saving a server
/// while a reply allows a tool) would otherwise write over each other
fn update_servers<T>(
    app: &AppHandle,
    change: impl FnOnce(&mut Vec<McpServer>) -> Result<T, String>,
) -> Result<T, String> {
    static WRITING: StdMutex<()> = StdMutex::new(());
    let _guard = WRITING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut servers = read_servers(app)?;
    let result = change(&mut servers)?;
    write_servers(app, &servers)?;
    Ok(result)
}

fn write_servers(app: &AppHandle, servers: &[McpServer]) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(to_message)?;
    }
    let text = serde_json::to_string_pretty(servers).map_err(to_message)?;
    // A crash halfway through would leave every server unreadable
    write_atomically(&path, text.as_bytes(), None).map_err(to_message)
}

// Only a copy: unreadable, it is as if it were empty
fn read_map<V: serde::de::DeserializeOwned>(app: &AppHandle, file: &str) -> HashMap<String, V> {
    data_dir(app)
        .ok()
        .and_then(|dir| fs::read_to_string(dir.join(file)).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// One entry of a map kept in a file, changed under a lock: servers connecting at once each write theirs
fn update_map<V: Serialize + serde::de::DeserializeOwned>(
    app: &AppHandle,
    file: &str,
    id: &str,
    value: Option<V>,
) -> Result<(), String> {
    static WRITING: StdMutex<()> = StdMutex::new(());
    let _guard = WRITING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut map = read_map::<V>(app, file);
    match value {
        Some(value) => map.insert(id.to_string(), value),
        None => map.remove(id),
    };
    let text = serde_json::to_string(&map).map_err(to_message)?;
    write_atomically(&data_dir(app)?.join(file), text.as_bytes(), None).map_err(to_message)
}

// Unreadable, it is as if no server had run yet
fn read_known_tools(app: &AppHandle) -> HashMap<String, Vec<McpTool>> {
    read_map(app, TOOLS_FILE)
}

/// A server's tools as it offers them now, or None when they may have changed (its command, its variables)
fn remember_tools(app: &AppHandle, id: &str, tools: Option<&[McpTool]>) -> Result<(), String> {
    update_map(app, TOOLS_FILE, id, tools.map(<[McpTool]>::to_vec))
}

/// A server's icon, ready for an <img>
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerIcon {
    // Where it came from: a server that still points there isn't downloaded again
    source: String,
    // Data URIs: for light backgrounds, and for dark ones when the server has its own
    light: Option<String>,
    dark: Option<String>,
}

fn read_icons(app: &AppHandle) -> HashMap<String, ServerIcon> {
    read_map(app, ICONS_FILE)
}

fn write_icon(app: &AppHandle, id: &str, icon: Option<ServerIcon>) -> Result<(), String> {
    update_map(app, ICONS_FILE, id, icon)
}

/// Where to look, in order: the icons the server names for each background, then its website's own icon
fn icon_sources(info: &rmcp::model::Implementation) -> (Vec<String>, Vec<String>) {
    use rmcp::model::IconTheme;
    let icons = info.icons.as_deref().unwrap_or_default();
    let named = |dark: bool| {
        icons
            .iter()
            .filter(|icon| (icon.theme == Some(IconTheme::Dark)) == dark)
            .map(|icon| icon.src.clone())
            .collect::<Vec<_>>()
    };
    let mut light = named(false);
    if let Some(site) = info
        .website_url
        .as_deref()
        .and_then(|url| tauri_plugin_http::reqwest::Url::parse(url).ok())
    {
        if let Ok(favicon) = site.join("/favicon.ico") {
            light.push(favicon.to_string());
        }
    }
    (light, named(true))
}

fn icon_type(content_type: &str) -> Option<&'static str> {
    let wanted = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    ICON_TYPES.iter().copied().find(|kind| *kind == wanted)
}

/// One image as a data URI: one already written so, or one on the public web (https only), small and of a kind an
/// <img> shows; None otherwise
async fn icon_data(src: &str) -> Option<String> {
    use base64::Engine;
    if let Some(rest) = src.strip_prefix("data:") {
        // From where its type ends, found in the text itself: the type may come with spaces around it
        let at = rest.find([';', ','])?;
        let kind = icon_type(&rest[..at])?;
        let fits = src.len() <= MAX_ICON_BYTES * 4 / 3 + 100;
        return (fits && rest.contains(";base64,")).then(|| format!("data:{kind}{}", &rest[at..]));
    }
    let url = tauri_plugin_http::reqwest::Url::parse(src)
        .ok()
        .filter(|url| url.scheme() == "https")?;
    let response = crate::web::get_public(url).await.ok()?;
    let kind = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .and_then(icon_type)?;
    let (bytes, cut) = crate::web::read_limited(response, MAX_ICON_BYTES)
        .await
        .ok()?;
    if cut || bytes.is_empty() {
        return None;
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{kind};base64,{encoded}"))
}

async fn first_icon(sources: &[String]) -> Option<String> {
    for src in sources {
        if let Some(data) = icon_data(src).await {
            return Some(data);
        }
    }
    None
}

/// The icon of a server that just started, downloaded only if it points somewhere new; then the pages hear of it
async fn remember_icon(app: AppHandle, id: String, info: rmcp::model::Implementation) {
    use tauri::Emitter;
    let (light, dark) = icon_sources(&info);
    let source = [light.as_slice(), dark.as_slice()].concat().join(" ");
    let known = read_icons(&app).remove(&id);
    if known.as_ref().map(|icon| &icon.source) == Some(&source) {
        return;
    }
    let found = tokio::time::timeout(ICON_TIMEOUT, async {
        (first_icon(&light).await, first_icon(&dark).await)
    })
    .await
    .unwrap_or_default();
    let icon = match found {
        (None, None) => None,
        (light, dark) => Some(ServerIcon {
            source,
            light,
            dark,
        }),
    };
    if icon == known {
        return;
    }
    if let Err(error) = write_icon(&app, &id, icon) {
        eprintln!("Could not keep the icon of MCP server {id}: {error}");
        return;
    }
    let _ = app.emit(ICON_EVENT, id);
}

fn is_plain_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= ID_MAX
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// A plain id from the server's name, not taken by another one
fn new_id(name: &str, taken: &[McpServer]) -> String {
    let mut base: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    base.truncate(ID_MAX - 3);
    let base = if base.is_empty() {
        "server".to_string()
    } else {
        base
    };
    let is_taken = |id: &str| taken.iter().any(|s| s.id == id);
    if !is_taken(&base) {
        return base;
    }
    (2..100)
        .map(|n| format!("{base}-{n}"))
        .find(|id| !is_taken(id))
        .unwrap_or(base)
}

fn secret_key(id: &str) -> String {
    format!("mcp-{id}")
}

/// The PATH of the user's shell: an app opened from the Finder or a desktop launcher doesn't get it, and without it
/// `npx` or `uvx` aren't found. Read once, with a limit, since a shell's startup files can do anything.
#[cfg(unix)]
fn shell_path() -> Option<OsString> {
    use std::process::Command;
    let (shell, args) = crate::util::user_shell("printf '%s' \"$PATH\"");
    let child = Command::new(shell)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let output = crate::util::output_within(child, Duration::from_secs(5)).ok()??;
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!path.is_empty()).then(|| path.into())
}

// Windows apps get the user's PATH as it is
#[cfg(not(unix))]
fn shell_path() -> Option<OsString> {
    None
}

fn user_path() -> Option<OsString> {
    static PATH: OnceLock<Option<OsString>> = OnceLock::new();
    PATH.get_or_init(|| shell_path().or_else(|| std::env::var_os("PATH")))
        .clone()
}

/// The program to start, found in the user's PATH when it is only a name (npx, uvx, docker); on Windows that also
/// finds `npx.cmd`
fn command_for(
    server: &McpServer,
    env: &Map<String, Value>,
) -> Result<tokio::process::Command, String> {
    let path = user_path();
    let named = PathBuf::from(&server.command);
    let program = if named.components().count() > 1 {
        named
    } else {
        let cwd = std::env::current_dir().unwrap_or_default();
        which::which_in(&server.command, path.as_ref(), cwd).map_err(|_| {
            t_with(
                "native.mcp.commandNotFound",
                &[("command", &server.command)],
            )
        })?
    };
    let mut command = tokio::process::Command::new(program);
    command.args(&server.args).kill_on_drop(true);
    if let Some(path) = path {
        command.env("PATH", path);
    }
    for (name, value) in env {
        if let Some(value) = value.as_str() {
            command.env(name, value);
        }
    }
    #[cfg(windows)]
    command.creation_flags(crate::util::CREATE_NO_WINDOW);
    Ok(command)
}

fn tool_of(tool: rmcp::model::Tool) -> McpTool {
    let read_only = tool
        .annotations
        .as_ref()
        .and_then(|a| a.read_only_hint)
        .unwrap_or(false);
    McpTool {
        name: tool.name.to_string(),
        title: tool.title.clone(),
        description: tool.description.as_deref().unwrap_or_default().to_string(),
        input_schema: Value::Object((*tool.input_schema).clone()),
        read_only,
    }
}

async fn env_of(app: &AppHandle, server: &McpServer) -> Result<Map<String, Value>, String> {
    if server.env_names.is_empty() {
        return Ok(Map::new());
    }
    let stored = load_api_key(app.clone(), secret_key(&server.id)).await?;
    Ok(stored
        .and_then(|text| serde_json::from_str::<Map<String, Value>>(&text).ok())
        .unwrap_or_default())
}

async fn connect(app: &AppHandle, server: &McpServer, log: Log) -> Result<Connection, String> {
    start(server, &env_of(app, server).await?, log).await
}

/// Starts the server with the values of its variables, and reads what it offers. What it writes on its error output
/// goes to the log, for Settings, while it runs.
async fn start(
    server: &McpServer,
    env: &Map<String, Value>,
    log: Log,
) -> Result<Connection, String> {
    let command = command_for(server, env)?;
    let (transport, stderr) = TokioChildProcess::builder(command)
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            t_with(
                "native.mcp.couldNotStart",
                &[("name", &server.name), ("error", &e.to_string())],
            )
        })?;
    if let Some(mut stderr) = stderr {
        let log = Arc::clone(&log);
        tokio::spawn(async move {
            let mut buffer = [0u8; 1024];
            while let Ok(read) = stderr.read(&mut buffer).await {
                if read == 0 {
                    break;
                }
                let mut kept = lock(&log);
                kept.push_str(&String::from_utf8_lossy(&buffer[..read]));
                if kept.len() > LOG_KEPT {
                    let start = kept.len() - tail(&kept, LOG_KEPT).len();
                    kept.drain(..start);
                }
            }
        });
    }
    // In its own words when it said something: the end of its log
    let failed = |error: String| {
        let said = tail(lock(&log).trim(), FAILURE_DETAIL).to_string();
        let detail = if said.is_empty() { error } else { said };
        t_with(
            "native.mcp.couldNotStart",
            &[("name", &server.name), ("error", &detail)],
        )
    };
    let client = match tokio::time::timeout(CONNECT_TIMEOUT, ().serve(transport)).await {
        Ok(Ok(client)) => client,
        Ok(Err(e)) => return Err(failed(e.to_string())),
        Err(_) => return Err(failed(t("native.mcp.timedOut"))),
    };
    let tools = client.list_all_tools().await.map_err(|e| {
        t_with(
            "native.mcp.couldNotStart",
            &[("name", &server.name), ("error", &e.to_string())],
        )
    })?;
    Ok(Connection {
        client,
        tools: tools.into_iter().map(tool_of).collect(),
    })
}

/// The server running, started now if it wasn't
async fn connection(
    app: &AppHandle,
    state: &McpConnections,
    id: &str,
) -> Result<Arc<Connection>, String> {
    let slot = Arc::clone(state.slots().entry(id.to_string()).or_default());
    let mut current = slot.lock().await;
    if let Some(found) = current.as_ref().filter(|c| !c.client.is_closed()) {
        return Ok(Arc::clone(found));
    }
    let server = read_servers(app)?
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| t("native.mcp.unknownServer"))?;
    let made = Arc::new(connect(app, &server, state.new_log(id)).await?);
    *current = Some(Arc::clone(&made));
    // Without the copy, the next reply only starts it to read them again
    if let Err(error) = remember_tools(app, id, Some(&made.tools)) {
        eprintln!("Could not keep the tools of MCP server {id}: {error}");
    }
    // In the background: a slow image never holds up its tools
    if let Some(info) = made
        .client
        .peer_info()
        .and_then(|peer| peer.server_info.clone())
    {
        tauri::async_runtime::spawn(remember_icon(app.clone(), id.to_string(), info));
    }
    Ok(made)
}

/// Stops it in the background: one still starting finishes first, and a call in progress keeps it until it ends
fn disconnect(state: &McpConnections, id: &str) {
    let Some(slot) = state.slots().remove(id) else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        if let Some(connection) = slot.lock().await.take() {
            if let Ok(connection) = Arc::try_unwrap(connection) {
                let _ = connection.client.cancel().await;
            }
        }
    });
}

#[tauri::command]
pub fn mcp_servers(app: AppHandle) -> Result<Vec<McpServer>, String> {
    read_servers(&app)
}

/// The variables to keep: each with the value written now, or, left empty, the one it had saved
fn merged_env(written: HashMap<String, String>, saved: &Map<String, Value>) -> Map<String, Value> {
    written
        .into_iter()
        .filter_map(|(name, value)| {
            let name = name.trim().to_string();
            let value = if value.is_empty() {
                saved.get(&name)?.clone()
            } else {
                Value::String(value)
            };
            (!name.is_empty()).then_some((name, value))
        })
        .collect()
}

/// Adds or changes a server. env_values: every variable it has, to keep in the keychain, an empty value keeping the
/// saved one; None leaves them as they are. A running server starts again if how it starts changed.
#[tauri::command]
pub async fn mcp_save_server(
    app: AppHandle,
    state: State<'_, McpConnections>,
    server: McpServer,
    env_values: Option<HashMap<String, String>>,
) -> Result<McpServer, String> {
    let servers = read_servers(&app)?;
    let mut server = server;
    server.name = server.name.trim().to_string();
    server.command = server.command.trim().to_string();
    if server.name.is_empty() || server.command.is_empty() {
        return Err(t("native.mcp.missingCommand"));
    }
    if server.id.is_empty() {
        server.id = new_id(&server.name, &servers);
    }
    if !is_plain_id(&server.id) {
        return Err(t("native.mcp.unknownServer"));
    }
    let existing = servers.iter().find(|s| s.id == server.id).cloned();
    let restart = env_values.is_some()
        || !server.enabled
        || existing
            .as_ref()
            .is_none_or(|old| old.command != server.command || old.args != server.args);
    if let Some(written) = env_values {
        let saved = match &existing {
            Some(old) => env_of(&app, old).await?,
            None => Map::new(),
        };
        let values = merged_env(written, &saved);
        server.env_names = values.keys().cloned().collect();
        let text = if values.is_empty() {
            String::new()
        } else {
            Value::Object(values).to_string()
        };
        save_api_key(app.clone(), secret_key(&server.id), text).await?;
    }
    // Against the servers as they are after the keychain: the tool lists change only through mcp_set_tools, and a reply
    // may have allowed one meanwhile
    let server = update_servers(&app, |servers| {
        match servers.iter_mut().find(|s| s.id == server.id) {
            Some(current) => {
                server.always_allowed = current.always_allowed.clone();
                server.disabled_tools = current.disabled_tools.clone();
                *current = server.clone();
            }
            None => servers.push(server.clone()),
        }
        Ok(server)
    })?;
    if restart {
        disconnect(&state, &server.id);
        remember_tools(&app, &server.id, None)?;
    }
    Ok(server)
}

/// A server's lists of tools the user chooses
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolList {
    AlwaysAllowed,
    Disabled,
}

fn change_list(list: &mut Vec<String>, add: Vec<String>, remove: &[String]) {
    list.retain(|name| !remove.contains(name));
    for tool in add {
        if !list.contains(&tool) {
            list.push(tool);
        }
    }
}

/// Adds tools to one of the lists and takes others out; the server keeps running. Only the tools named change, so a
/// reply allowing one meanwhile isn't undone.
#[tauri::command]
pub fn mcp_set_tools(
    app: AppHandle,
    id: String,
    list: ToolList,
    add: Vec<String>,
    remove: Vec<String>,
) -> Result<McpServer, String> {
    update_servers(&app, |servers| {
        let server = servers
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| t("native.mcp.unknownServer"))?;
        let names = match list {
            ToolList::AlwaysAllowed => &mut server.always_allowed,
            ToolList::Disabled => &mut server.disabled_tools,
        };
        change_list(names, add, &remove);
        Ok(server.clone())
    })
}

#[tauri::command]
pub async fn mcp_delete_server(
    app: AppHandle,
    state: State<'_, McpConnections>,
    id: String,
) -> Result<(), String> {
    update_servers(&app, |servers| {
        servers.retain(|s| s.id != id);
        Ok(())
    })?;
    disconnect(&state, &id);
    remember_tools(&app, &id, None)?;
    write_icon(&app, &id, None)?;
    if is_plain_id(&id) {
        forget_api_key(app, secret_key(&id)).await?;
    }
    Ok(())
}

/// What a server offers, starting it if it isn't running
#[tauri::command]
pub async fn mcp_tools(
    app: AppHandle,
    state: State<'_, McpConnections>,
    id: String,
) -> Result<Vec<McpTool>, String> {
    Ok(connection(&app, &state, &id).await?.tools.clone())
}

/// The tools of the servers that ran before, by id, without starting them: a reply offers these and starts a server
/// only to use one
#[tauri::command]
pub fn mcp_known_tools(app: AppHandle) -> HashMap<String, Vec<McpTool>> {
    read_known_tools(&app)
}

/// The icons of the servers that ran before and have one, by id
#[tauri::command]
pub fn mcp_icons(app: AppHandle) -> HashMap<String, ServerIcon> {
    read_icons(&app)
}

/// What the server wrote on its error output since it last started, the newest last; empty if it never started
#[tauri::command]
pub fn mcp_log(state: State<'_, McpConnections>, id: String) -> String {
    lock(&state.logs)
        .get(&id)
        .map(|log| lock(log).clone())
        .unwrap_or_default()
}

#[tauri::command]
pub fn mcp_disconnect(state: State<'_, McpConnections>, id: String) {
    disconnect(&state, &id);
}

fn result_of(result: Value) -> McpCallResult {
    let mut text = Vec::new();
    let mut images = Vec::new();
    for block in result["content"].as_array().into_iter().flatten() {
        match block["type"].as_str().unwrap_or_default() {
            "text" => text.push(block["text"].as_str().unwrap_or_default().to_string()),
            "image" => images.push(McpImage {
                mime_type: block["mimeType"]
                    .as_str()
                    .unwrap_or("image/png")
                    .to_string(),
                data: block["data"].as_str().unwrap_or_default().to_string(),
            }),
            "resource" => {
                if let Some(resource_text) = block["resource"]["text"].as_str() {
                    text.push(resource_text.to_string());
                }
            }
            _ => {}
        }
    }
    // Only structured: its JSON is what there is to read
    if text.is_empty() {
        if let Some(structured) = result.get("structuredContent").filter(|v| !v.is_null()) {
            text.push(serde_json::to_string_pretty(structured).unwrap_or_default());
        }
    }
    let mut text = text.join("\n\n");
    if text.len() > MAX_RESULT_CHARS {
        let cut = (0..=MAX_RESULT_CHARS)
            .rev()
            .find(|i| text.is_char_boundary(*i))
            .unwrap_or(0);
        text.truncate(cut);
        text.push_str("\n[…]");
    }
    McpCallResult {
        text,
        images,
        is_error: result["isError"].as_bool().unwrap_or(false),
    }
}

fn usable_tool(server: &McpServer, tool: &str) -> Result<(), String> {
    if !server.enabled {
        return Err(t("native.mcp.serverOff"));
    }
    if server.disabled_tools.iter().any(|name| name == tool) {
        return Err(t("native.mcp.toolOff"));
    }
    Ok(())
}

/// Runs one tool with the arguments the model wrote; the user already allowed it
#[tauri::command]
pub async fn mcp_call_tool(
    app: AppHandle,
    state: State<'_, McpConnections>,
    id: String,
    tool: String,
    arguments: Value,
) -> Result<McpCallResult, String> {
    // Settings decides, not the page asking: an off server or tool never runs
    let server = read_servers(&app)?
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| t("native.mcp.unknownServer"))?;
    usable_tool(&server, &tool)?;
    let connection = connection(&app, &state, &id).await?;
    if !connection.tools.iter().any(|offered| offered.name == tool) {
        return Err(t("native.mcp.unknownTool"));
    }
    let arguments = match arguments {
        Value::Object(fields) => fields,
        Value::Null => Map::new(),
        _ => return Err(t("native.mcp.badArguments")),
    };
    let request = CallToolRequestParams::new(tool).with_arguments(arguments);
    let result = tokio::time::timeout(CALL_TIMEOUT, connection.client.call_tool(request))
        .await
        .map_err(|_| t("native.mcp.timedOut"))?
        .map_err(|e| t_with("native.mcp.callFailed", &[("error", &e.to_string())]))?;
    Ok(result_of(serde_json::to_value(result).map_err(to_message)?))
}

/// A server found in another app's configuration, with the values of its variables
#[derive(Serialize, Debug)]
pub struct McpImport {
    server: McpServer,
    env: HashMap<String, String>,
}

/// The servers set up in Claude Desktop, with their variables, for the user to bring in; only those started by a
/// command, which are the ones Nyra runs
#[tauri::command]
pub fn mcp_import_candidates(app: AppHandle) -> Result<Vec<McpImport>, String> {
    let Some(path) = claude_desktop_config(&app) else {
        return Ok(Vec::new());
    };
    let Ok(text) = fs::read_to_string(path) else {
        return Ok(Vec::new());
    };
    Ok(import_candidates(&text))
}

fn import_candidates(text: &str) -> Vec<McpImport> {
    let Ok(config) = serde_json::from_str::<Value>(text) else {
        return Vec::new();
    };
    config["mcpServers"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(name, entry)| {
            let command = entry["command"].as_str()?.to_string();
            let args = entry["args"]
                .as_array()
                .map(|args| {
                    args.iter()
                        .filter_map(|a| a.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            let env: HashMap<String, String> = entry["env"]
                .as_object()
                .map(|env| {
                    env.iter()
                        .filter_map(|(k, v)| v.as_str().map(|v| (k.clone(), v.to_string())))
                        .collect()
                })
                .unwrap_or_default();
            let server = McpServer {
                id: String::new(),
                name: name.clone(),
                command,
                args,
                env_names: env.keys().cloned().collect(),
                enabled: true,
                always_allowed: Vec::new(),
                disabled_tools: Vec::new(),
            };
            Some(McpImport { server, env })
        })
        .collect()
}

/// Where Claude Desktop keeps its configuration on each system
fn claude_desktop_config(app: &AppHandle) -> Option<PathBuf> {
    let paths = app.path();
    #[cfg(target_os = "macos")]
    let base = paths
        .home_dir()
        .ok()?
        .join("Library")
        .join("Application Support");
    #[cfg(target_os = "windows")]
    let base = paths.config_dir().ok()?;
    #[cfg(target_os = "linux")]
    let base = paths.config_dir().ok()?;
    Some(base.join("Claude").join("claude_desktop_config.json"))
}

/// Nyra quitting stops the servers it started
pub fn close_all(app: &AppHandle) {
    let state = app.state::<McpConnections>();
    let slots = std::mem::take(&mut *state.slots());
    // Their processes stop when dropped; one still starting stops once it is done, when its slot goes
    for slot in slots.into_values() {
        if let Ok(mut current) = slot.try_lock() {
            current.take();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An enabled server started with npx, with nothing allowed or turned off
    fn server(id: &str) -> McpServer {
        McpServer {
            id: id.into(),
            name: id.into(),
            command: "npx".into(),
            args: vec![],
            env_names: vec![],
            enabled: true,
            always_allowed: vec![],
            disabled_tools: vec![],
        }
    }

    #[test]
    fn makes_plain_ids_from_names() {
        let taken = vec![server("tareas")];
        assert_eq!(new_id("Mi Base de Datos!", &[]), "mi-base-de-datos");
        assert_eq!(new_id("Tareas", &taken), "tareas-2");
        assert_eq!(new_id("日本語", &[]), "server");
        assert!(is_plain_id(&secret_key(&new_id(&"x".repeat(80), &[]))[4..]));
    }

    #[tokio::test]
    async fn takes_only_small_images_an_img_shows() {
        assert_eq!(
            icon_type("image/SVG+xml; charset=utf-8"),
            Some("image/svg+xml")
        );
        assert_eq!(icon_type("text/html"), None);
        let png = "data:image/png;base64,AAAA";
        assert_eq!(icon_data(png).await.as_deref(), Some(png));
        assert_eq!(icon_data("data:text/html;base64,AAAA").await, None);
        // Spaces around the type, even wide ones, never cut the text inside a letter
        assert_eq!(
            icon_data("data:\u{a0}\u{a0}image/png;base64,AAAA")
                .await
                .as_deref(),
            Some("data:image/png;base64,AAAA")
        );
        assert_eq!(icon_data("http://ejemplo.com/icono.png").await, None);
        assert_eq!(icon_data("file:///etc/icono.png").await, None);
    }

    #[test]
    fn looks_for_each_background_then_the_website() {
        let info: rmcp::model::Implementation = serde_json::from_value(serde_json::json!({
            "name": "Notas",
            "version": "1.0",
            "websiteUrl": "https://ejemplo.com/docs/mcp",
            "icons": [
                {"src": "https://ejemplo.com/claro.svg"},
                {"src": "https://ejemplo.com/oscuro.svg", "theme": "dark"}
            ]
        }))
        .unwrap();
        let (light, dark) = icon_sources(&info);
        assert_eq!(
            light,
            vec![
                "https://ejemplo.com/claro.svg",
                "https://ejemplo.com/favicon.ico"
            ]
        );
        assert_eq!(dark, vec!["https://ejemplo.com/oscuro.svg"]);
    }

    #[test]
    fn refuses_off_servers_and_tools() {
        let server = McpServer {
            disabled_tools: vec!["delete_page".into()],
            ..server("notas")
        };
        assert!(usable_tool(&server, "search").is_ok());
        assert!(usable_tool(&server, "delete_page").is_err());
        let off = McpServer {
            enabled: false,
            ..server
        };
        assert!(usable_tool(&off, "search").is_err());
    }

    #[test]
    fn keeps_the_end_of_a_log_whole() {
        assert_eq!(tail("abcdef", 3), "def");
        assert_eq!(tail("ab", 10), "ab");
        // "ñ" takes two bytes: the cut moves past it instead of splitting it
        assert_eq!(tail("añb", 2), "b");
    }

    #[test]
    fn changes_only_the_tools_named() {
        let mut list = vec!["a".to_string(), "b".to_string()];
        change_list(&mut list, vec!["c".into(), "a".into()], &["b".into()]);
        assert_eq!(list, vec!["a", "c"]);
    }

    #[test]
    // Settings reads these in camelCase, and they're stored that way between sessions
    fn known_tools_survive_a_round_trip() {
        let tool = McpTool {
            name: "search".into(),
            title: None,
            description: "Busca".into(),
            input_schema: serde_json::json!({"type": "object"}),
            read_only: true,
        };
        let known = HashMap::from([("tareas".to_string(), vec![tool])]);
        let text = serde_json::to_string(&known).unwrap();
        assert!(text.contains(r#""inputSchema""#) && text.contains(r#""readOnly":true"#));
        let back: HashMap<String, Vec<McpTool>> = serde_json::from_str(&text).unwrap();
        assert_eq!(back["tareas"][0].name, "search");
        assert!(back["tareas"][0].read_only);
    }

    #[test]
    fn keeps_saved_values_left_empty() {
        let saved = serde_json::json!({"API_TOKEN": "guardado", "OLD": "x"});
        let written = HashMap::from([
            ("API_TOKEN".to_string(), String::new()),
            (" REGION ".to_string(), "eu".to_string()),
            ("NEW_EMPTY".to_string(), String::new()),
        ]);
        let merged = merged_env(written, saved.as_object().unwrap());
        assert_eq!(merged["API_TOKEN"], "guardado");
        assert_eq!(merged["REGION"], "eu");
        assert!(!merged.contains_key("NEW_EMPTY"));
        assert!(!merged.contains_key("OLD"));
    }

    #[test]
    fn imports_the_servers_started_by_a_command() {
        let text = r#"{"mcpServers": {
            "tareas": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-tareas"],
                       "env": {"TAREAS_TOKEN": "token-de-ejemplo"}},
            "remoto": {"url": "https://ejemplo.com/mcp"}
        }}"#;
        let found = import_candidates(text);
        assert_eq!(found.len(), 1);
        assert_eq!(
            found[0].server.args,
            vec!["-y", "@modelcontextprotocol/server-tareas"]
        );
        assert_eq!(found[0].env["TAREAS_TOKEN"], "token-de-ejemplo");
        assert!(import_candidates("no es json").is_empty());
    }

    // A real server from npm: cargo test mcp -- --ignored
    #[tokio::test]
    #[ignore = "starts a server with npx, which needs Node and the network"]
    async fn uses_a_real_server() {
        let server = McpServer {
            args: vec![
                "-y".into(),
                "@modelcontextprotocol/server-everything".into(),
            ],
            ..server("everything")
        };
        let connection = start(&server, &Map::new(), Log::default())
            .await
            .expect("it starts");
        let names: Vec<&str> = connection.tools.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"echo"), "{names:?}");
        let request = CallToolRequestParams::new("echo").with_arguments(
            serde_json::json!({"message": "hola desde Nyra"})
                .as_object()
                .unwrap()
                .clone(),
        );
        let result = connection.client.call_tool(request).await.unwrap();
        let read = result_of(serde_json::to_value(result).unwrap());
        assert!(read.text.contains("hola desde Nyra"), "{}", read.text);
        let missing = McpServer {
            command: "no-existe-este-comando".into(),
            ..server
        };
        assert!(start(&missing, &Map::new(), Log::default())
            .await
            .err()
            .unwrap()
            .contains("no-existe-este-comando"));
    }

    #[test]
    fn reads_text_images_and_errors_from_a_result() {
        let result = serde_json::json!({
            "content": [
                {"type": "text", "text": "3 issues"},
                {"type": "image", "mimeType": "image/png", "data": "AAAA"}
            ],
            "isError": false
        });
        let read = result_of(result);
        assert_eq!(read.text, "3 issues");
        assert_eq!(read.images.len(), 1);
        let structured = result_of(
            serde_json::json!({"content": [], "structuredContent": {"total": 3}, "isError": true}),
        );
        assert!(structured.text.contains("\"total\": 3"));
        assert!(structured.is_error);
    }
}
