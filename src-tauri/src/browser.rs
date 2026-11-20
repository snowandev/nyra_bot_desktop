//! A browser Nyra drives for the user: the Chrome (or Edge, Brave, Chromium) already installed, never a copy of its
//! own, so the browser keeps updating itself. It opens on a temporary and empty profile (none of the
//! user's passwords, history or sessions) that is deleted when it closes, and Nyra controls it over the DevTools
//! protocol on a local port only it knows. It has a window of its own beside Nyra, where the user watches it and can use
//! it; each action returns what the page has, for the model to choose the next one.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::ErrorKind;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tungstenite::{Message, WebSocket};

use crate::i18n::{t, t_with};
use crate::storage::now_millis;
use crate::util::{conversation_file_name, is_conversation_id, to_message};

const PROFILES_DIR: &str = "browser-profiles";
const PROFILE_REMOVE_TRIES: u32 = 25;
// The window's size when Nyra's own can't be measured, as a laptop's
const WIDTH: u32 = 1280;
const HEIGHT: u32 = 800;
// A screenshot has at most 3 pixels per point of the page
const MAX_SCALE: f64 = 3.0;
// The card's picture of the window: twice as wide as it is shown, for screens with 2 pixels per point
const THUMBNAIL_WIDTH: f64 = 480.0;
// Only JPEG takes it; PNG ignores it
const THUMBNAIL_QUALITY: u32 = 72;
// The browser writes where it listens once it is up; it may take a while the first time on a slow disk
const START_TIMEOUT: Duration = Duration::from_secs(20);
const CALL_TIMEOUT: Duration = Duration::from_secs(30);
// After an action, how long a page that started loading may take, and how long one that didn't is given to settle
const LOAD_TIMEOUT: Duration = Duration::from_secs(15);
const SETTLE: Duration = Duration::from_millis(600);
pub const CLOSED_EVENT: &str = "browser-closed";
// The page went somewhere else or changed its title, also by the user's own clicks
pub const PAGE_EVENT: &str = "browser-page";
// What the model gets of a page: its first text and the elements it can act on
const MAX_TEXT_CHARS: usize = 2_500;
const MAX_ELEMENTS: usize = 80;

/// The browsers that can be driven, by their usual places on each system; the first one found is used
#[cfg(target_os = "macos")]
fn candidates() -> Vec<PathBuf> {
    let apps = [
        "Google Chrome.app/Contents/MacOS/Google Chrome",
        "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "Brave Browser.app/Contents/MacOS/Brave Browser",
        "Chromium.app/Contents/MacOS/Chromium",
    ];
    let mut roots = vec![PathBuf::from("/Applications")];
    if let Some(home) = std::env::var_os("HOME") {
        roots.push(PathBuf::from(home).join("Applications"));
    }
    apps.iter()
        .flat_map(|app| roots.iter().map(move |root| root.join(app)))
        .collect()
}

#[cfg(target_os = "windows")]
fn candidates() -> Vec<PathBuf> {
    let apps = [
        r"Google\Chrome\Application\chrome.exe",
        r"Microsoft\Edge\Application\msedge.exe",
        r"BraveSoftware\Brave-Browser\Application\brave.exe",
    ];
    let roots: Vec<PathBuf> = ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"]
        .iter()
        .filter_map(std::env::var_os)
        .map(PathBuf::from)
        .collect();
    apps.iter()
        .flat_map(|app| roots.iter().map(move |root| root.join(app)))
        .collect()
}

#[cfg(target_os = "linux")]
fn candidates() -> Vec<PathBuf> {
    let names = [
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
        "microsoft-edge",
        "brave-browser",
    ];
    // Found on the PATH, and only if it can run
    names
        .iter()
        .filter_map(|name| which::which(name).ok())
        .collect()
}

fn find_browser() -> Option<PathBuf> {
    candidates().into_iter().find(|path| path.is_file())
}

/// The browser's name as the user knows it, from where it is installed
fn browser_name(path: &Path) -> String {
    let text = path.to_string_lossy().to_lowercase();
    let name = if text.contains("edge") {
        "Microsoft Edge"
    } else if text.contains("brave") {
        "Brave"
    } else if text.contains("chromium") {
        "Chromium"
    } else {
        "Google Chrome"
    };
    name.to_string()
}

/// What happens on the page while Nyra waits for something, and what the socket's thread needs to know about it
#[derive(Default)]
struct PageSignals {
    loading: bool,
    loaded_at: Option<Instant>,
    // The page's target and its session in the protocol, once attached
    target: Option<String>,
    page_session: Option<String>,
}

type Pending = Arc<Mutex<HashMap<u64, Sender<Result<Value, String>>>>>;
// Where the page's changes and the browser's end go: the app, or a test
type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;

/// One message of the DevTools protocol at a time on the socket, from its own thread: requests go out from a channel
/// and replies come back to whoever asked, by their id; events (a page loading, a tab opening) are handled there.
struct Cdp {
    outgoing: Mutex<Sender<String>>,
    pending: Pending,
    next_id: AtomicU64,
    signals: Arc<Mutex<PageSignals>>,
}

impl Cdp {
    fn call(&self, method: &str, params: Value, session: Option<&str>) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let mut message = json!({ "id": id, "method": method, "params": params });
        if let Some(session) = session {
            message["sessionId"] = json!(session);
        }
        let (send, receive) = mpsc::channel();
        self.pending.lock().map_err(to_message)?.insert(id, send);
        self.outgoing
            .lock()
            .map_err(to_message)?
            .send(message.to_string())
            .map_err(|_| t("native.browser.closed"))?;
        receive
            .recv_timeout(CALL_TIMEOUT)
            .map_err(|_| t("native.browser.noAnswer"))?
    }
}

struct Session {
    child: Mutex<Child>,
    profile: PathBuf,
    cdp: Cdp,
    // The page's own session in the protocol, where its commands go
    page: String,
}

/// Where the browser's window goes, in the screen's points
#[derive(Clone, Copy)]
struct Placement {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

impl Session {
    fn page_call(&self, method: &str, params: Value) -> Result<Value, String> {
        self.cdp.call(method, params, Some(&self.page))
    }

    fn evaluate(&self, expression: &str) -> Result<Value, String> {
        let reply = self.page_call(
            "Runtime.evaluate",
            json!({ "expression": expression, "returnByValue": true, "awaitPromise": true }),
        )?;
        if let Some(error) = reply.get("exceptionDetails") {
            let text = error["exception"]["description"]
                .as_str()
                .or_else(|| error["text"].as_str())
                .unwrap_or_default();
            return Err(t_with("native.browser.pageError", &[("error", text)]));
        }
        Ok(reply["result"]["value"].clone())
    }

    /// After an action: a page that started loading is waited for, one that didn't is given a moment to update
    fn settle(&self, before: Instant) {
        thread::sleep(Duration::from_millis(150));
        let started = Instant::now();
        while started.elapsed() < LOAD_TIMEOUT {
            let loading = self.cdp.signals.lock().map(|s| s.loading).unwrap_or(false);
            if !loading {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        let loaded = self
            .cdp
            .signals
            .lock()
            .ok()
            .and_then(|s| s.loaded_at)
            .is_some_and(|at| at > before);
        if !loaded {
            thread::sleep(SETTLE);
        }
    }

    fn close(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let profile = self.profile.clone();
        thread::spawn(move || remove_profile(&profile));
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.close();
    }
}

/// The open browsers, one per conversation
#[derive(Default)]
pub struct Browsers {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    // One starts at a time: two at once for a conversation would leave two browsers, and closing the extra one would
    // take the live session with it
    launching: Mutex<()>,
}

impl Browsers {
    fn get(&self, conversation: &str) -> Option<Arc<Session>> {
        self.sessions.lock().ok()?.get(conversation).cloned()
    }

    fn remove(&self, conversation: &str) -> Option<Arc<Session>> {
        self.sessions.lock().ok()?.remove(conversation)
    }
}

fn profiles_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(to_message)?
        .join(PROFILES_DIR))
}

/// The browser's helper processes may still write in the profile for a moment after it ends, and it may hold the
/// session the user signed in to: it is tried again until it is gone. Nyra's next start clears what still stays.
fn remove_profile(profile: &Path) {
    for _ in 0..PROFILE_REMOVE_TRIES {
        if fs::remove_dir_all(profile).is_ok() || !profile.exists() {
            return;
        }
        thread::sleep(Duration::from_millis(200));
    }
}

/// Profiles left by a browser that wasn't closed (Nyra quit or crashed) go when Nyra starts
pub fn clear_profiles(app: &AppHandle) {
    if let Ok(root) = profiles_root(app) {
        let _ = fs::remove_dir_all(root);
    }
}

/// Where the browser listens, from the file it writes in its profile once it is up
fn wait_for_endpoint(profile: &Path, child: &mut Child) -> Result<String, String> {
    let file = profile.join("DevToolsActivePort");
    let started = Instant::now();
    while started.elapsed() < START_TIMEOUT {
        if let Ok(text) = fs::read_to_string(&file) {
            let mut lines = text.lines();
            if let (Some(port), Some(path)) = (lines.next(), lines.next()) {
                if !port.is_empty() && path.starts_with('/') {
                    return Ok(format!("ws://127.0.0.1:{port}{path}"));
                }
            }
        }
        if let Ok(Some(_)) = child.try_wait() {
            return Err(t("native.browser.couldNotStart"));
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err(t("native.browser.couldNotStart"))
}

fn connect(url: &str) -> Result<WebSocket<TcpStream>, String> {
    let address = url
        .strip_prefix("ws://")
        .and_then(|rest| rest.split('/').next())
        .ok_or_else(|| t("native.browser.couldNotStart"))?;
    let stream = TcpStream::connect(address).map_err(|_| t("native.browser.couldNotStart"))?;
    let (socket, _) =
        tungstenite::client::client(url, stream).map_err(|_| t("native.browser.couldNotStart"))?;
    Ok(socket)
}

/// Only pages of the web: never a file of this computer, a script or the browser's own settings
fn is_web_address(url: &str) -> bool {
    let lower = url.trim_start().to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

// The id of the question the socket's thread asks the page about where it is; its answer goes to the chat. The
// browser only takes ids that fit in 32 bits, and the others count up from 1.
const WHERE_REQUEST: u64 = i32::MAX as u64;

fn where_request(page: &str) -> String {
    json!({
        "id": WHERE_REQUEST,
        "method": "Runtime.evaluate",
        "params": { "expression": "({ url: location.href, title: document.title })", "returnByValue": true },
        "sessionId": page,
    })
    .to_string()
}

/// The socket's thread: sends what waits, delivers replies and handles events until the browser goes
fn run_socket(
    mut socket: WebSocket<TcpStream>,
    outgoing: Sender<String>,
    pending: Pending,
    signals: Arc<Mutex<PageSignals>>,
    emit: Emit,
    conversation: String,
) {
    // Pages opened as another tab, already sent to the page itself
    let mut moved: HashSet<String> = HashSet::new();
    loop {
        match socket.read() {
            Ok(Message::Text(text)) => {
                let Ok(message) = serde_json::from_str::<Value>(text.as_str()) else {
                    continue;
                };
                if message["id"].as_u64() == Some(WHERE_REQUEST) {
                    let page = &message["result"]["result"]["value"];
                    emit(
                        PAGE_EVENT,
                        json!({ "conversationId": conversation, "url": page["url"], "title": page["title"] }),
                    );
                    continue;
                }
                if let Some(id) = message["id"].as_u64() {
                    let result = match message.get("error") {
                        Some(error) => {
                            Err(error["message"].as_str().unwrap_or_default().to_string())
                        }
                        None => Ok(message["result"].clone()),
                    };
                    if let Some(send) = pending.lock().ok().and_then(|mut p| p.remove(&id)) {
                        let _ = send.send(result);
                    }
                    continue;
                }
                match message["method"].as_str().unwrap_or_default() {
                    "Target.targetCreated" | "Target.targetInfoChanged" => {
                        let info = &message["params"]["targetInfo"];
                        let (target, page) = signals
                            .lock()
                            .map(|s| (s.target.clone(), s.page_session.clone()))
                            .unwrap_or_default();
                        let id = info["targetId"].as_str().unwrap_or_default();
                        let url = info["url"].as_str().unwrap_or_default();
                        if info["type"] != "page" || target.is_none() {
                            continue;
                        }
                        // Tabs the user opens in the window are theirs; only what the page opens moves
                        let opened_by_page = info["openerId"].as_str() == target.as_deref();
                        if target.as_deref() == Some(id) {
                            // Its title here may still be the address: the page itself is asked
                            if let Some(page) = &page {
                                let _ = outgoing.send(where_request(page));
                            }
                        } else if let Some(page) =
                            page.filter(|_| opened_by_page && is_web_address(url))
                        {
                            // Nyra works on one page: a link that opens another tab opens in it instead
                            if moved.insert(id.to_string()) {
                                let go = json!({ "id": 0, "method": "Page.navigate", "params": { "url": url }, "sessionId": page });
                                let close = json!({ "id": 0, "method": "Target.closeTarget", "params": { "targetId": id } });
                                let _ = outgoing.send(go.to_string());
                                let _ = outgoing.send(close.to_string());
                            }
                        }
                    }
                    // The user closed its window: it ends as if closed from Nyra
                    "Target.targetDestroyed" => {
                        let ours = signals.lock().ok().and_then(|s| s.target.clone());
                        if ours.as_deref() == message["params"]["targetId"].as_str() {
                            break;
                        }
                    }
                    "Page.frameStartedLoading" => {
                        if let Ok(mut s) = signals.lock() {
                            s.loading = true;
                        }
                    }
                    "Page.loadEventFired" | "Page.frameStoppedLoading" => {
                        let page = signals.lock().ok().and_then(|mut s| {
                            s.loading = false;
                            s.loaded_at = Some(Instant::now());
                            s.page_session.clone()
                        });
                        if let Some(page) = page {
                            let _ = outgoing.send(where_request(&page));
                        }
                    }
                    _ => {}
                }
            }
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(tungstenite::Error::Io(e))
                if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(_) => break,
        }
    }
    // Whoever still waits gets an answer instead of waiting out the timeout
    if let Ok(mut waiting) = pending.lock() {
        for (_, send) in waiting.drain() {
            let _ = send.send(Err(t("native.browser.closed")));
        }
    }
    emit(CLOSED_EVENT, json!({ "conversationId": conversation }));
}

/// A browser just started: closed again, with its profile, unless it becomes a session
struct Starting {
    child: Option<Child>,
    profile: PathBuf,
}

impl Starting {
    fn child(&mut self) -> Result<&mut Child, String> {
        self.child
            .as_mut()
            .ok_or_else(|| t("native.browser.couldNotStart"))
    }

    fn into_child(mut self) -> Result<Child, String> {
        self.child
            .take()
            .ok_or_else(|| t("native.browser.couldNotStart"))
    }
}

impl Drop for Starting {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
            let profile = self.profile.clone();
            thread::spawn(move || remove_profile(&profile));
        }
    }
}

/// window: where its window goes
fn launch(
    profiles: &Path,
    conversation: &str,
    emit: Emit,
    window: Placement,
) -> Result<Session, String> {
    let path = find_browser().ok_or_else(|| t("native.browser.notFound"))?;
    let name = conversation_file_name(conversation).ok_or_else(|| t("native.browser.closed"))?;
    let profile = profiles.join(format!("{name}-{}", now_millis()));
    fs::create_dir_all(&profile).map_err(to_message)?;
    let mut command = Command::new(&path);
    command
        .arg(format!("--window-position={},{}", window.x, window.y))
        .arg(format!("--window-size={},{}", window.width, window.height))
        // Port 0: the system picks a free one, which the browser writes in its profile
        .arg("--remote-debugging-port=0")
        .arg(format!("--user-data-dir={}", profile.display()))
        .args([
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-sync",
        ])
        // Without these, macOS asks for the keychain and Linux for the keyring on a new profile
        .args(["--use-mock-keychain", "--password-store=basic"])
        .arg("about:blank")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(crate::util::CREATE_NO_WINDOW);
    }
    let child = command
        .spawn()
        .map_err(|_| t("native.browser.couldNotStart"))?;
    // From here any failure closes it: killed, its socket's thread ends too
    let mut starting = Starting {
        child: Some(child),
        profile: profile.clone(),
    };
    let endpoint = wait_for_endpoint(&profile, starting.child()?)?;
    let socket = connect(&endpoint)?;
    let (send, receive) = mpsc::channel::<String>();
    // Reading and writing on threads of their own, each waiting until there is something to do: reading with a short
    // timeout to also send from the same thread woke it 50 times a second. The browser never pings, so the reading
    // side never writes over the writing one.
    let writing = socket.get_ref().try_clone().map_err(to_message)?;
    thread::spawn(move || {
        let mut writer =
            WebSocket::from_raw_socket(writing, tungstenite::protocol::Role::Client, None);
        for message in receive {
            if writer.send(Message::text(message)).is_err() {
                break;
            }
        }
    });
    let pending: Pending = Arc::default();
    let signals: Arc<Mutex<PageSignals>> = Arc::default();
    {
        let (pending, signals, conversation) = (
            Arc::clone(&pending),
            Arc::clone(&signals),
            conversation.to_string(),
        );
        let outgoing = send.clone();
        thread::spawn(move || run_socket(socket, outgoing, pending, signals, emit, conversation));
    }
    let cdp = Cdp {
        outgoing: Mutex::new(send),
        pending,
        next_id: AtomicU64::new(1),
        signals,
    };
    let targets = cdp.call("Target.getTargets", json!({}), None)?;
    let target = targets["targetInfos"]
        .as_array()
        .and_then(|list| list.iter().find(|t| t["type"] == "page"))
        .and_then(|t| t["targetId"].as_str())
        .ok_or_else(|| t("native.browser.couldNotStart"))?
        .to_string();
    let attached = cdp.call(
        "Target.attachToTarget",
        json!({ "targetId": target, "flatten": true }),
        None,
    )?;
    let page = attached["sessionId"]
        .as_str()
        .ok_or_else(|| t("native.browser.couldNotStart"))?
        .to_string();
    if let Ok(mut s) = cdp.signals.lock() {
        s.target = Some(target);
        s.page_session = Some(page.clone());
    }
    let session = Session {
        child: Mutex::new(starting.into_child()?),
        profile,
        cdp,
        page,
    };
    session.page_call("Page.enable", json!({}))?;
    // Where the page goes and what it is called, and the tabs a link opens
    session.cdp.call(
        "Target.setDiscoverTargets",
        json!({ "discover": true }),
        None,
    )?;
    Ok(session)
}

/// To the right of Nyra when the screen has room; otherwise over the right half of the screen, as tall as Nyra
fn beside_nyra(app: &AppHandle) -> Option<Placement> {
    let window = app.get_webview_window("main")?;
    let scale = window.scale_factor().ok()?;
    let at = window.outer_position().ok()?.to_logical::<f64>(scale);
    let size = window.outer_size().ok()?.to_logical::<f64>(scale);
    let monitor = window.current_monitor().ok()??;
    let screen_at = monitor.position().to_logical::<f64>(scale);
    let screen = monitor.size().to_logical::<f64>(scale);
    let screen_right = screen_at.x + screen.width;
    let room = screen_right - (at.x + size.width);
    let (x, width) = if room >= 720.0 {
        (at.x + size.width, room)
    } else {
        (screen_at.x + screen.width / 2.0, screen.width / 2.0)
    };
    Some(Placement {
        x: x as i32,
        y: at.y as i32,
        width: width as u32,
        height: size.height as u32,
    })
}

fn session_for(
    app: &AppHandle,
    browsers: &Browsers,
    conversation: &str,
) -> Result<Arc<Session>, String> {
    if !is_conversation_id(conversation) {
        return Err(t("native.browser.closed"));
    }
    if let Some(session) = browsers.get(conversation) {
        return Ok(session);
    }
    let _launching = crate::util::lock(&browsers.launching);
    if let Some(session) = browsers.get(conversation) {
        return Ok(session);
    }
    let app_for_events = app.clone();
    let id = conversation.to_string();
    let emit: Emit = Arc::new(move |event, payload| {
        // It ended on its own (its window closed, it quit): it goes, so the next one starts fresh
        if event == CLOSED_EVENT {
            if let Some(session) = app_for_events.state::<Browsers>().remove(&id) {
                session.close();
            }
        }
        let _ = app_for_events.emit(event, payload);
    });
    let window = beside_nyra(app).unwrap_or(Placement {
        x: 0,
        y: 0,
        width: WIDTH,
        height: HEIGHT,
    });
    let session = Arc::new(launch(&profiles_root(app)?, conversation, emit, window)?);
    browsers
        .sessions
        .lock()
        .map_err(to_message)?
        .insert(conversation.to_string(), Arc::clone(&session));
    Ok(session)
}

fn open_session(browsers: &Browsers, conversation: &str) -> Result<Arc<Session>, String> {
    browsers
        .get(conversation)
        .ok_or_else(|| t("native.browser.closed"))
}

/// The page as the model reads it: where it is, its first text and the elements it can act on, numbered. The numbers
/// are written on the elements, so the next action finds them, and an element keeps its number while it stays on the
/// page: a number read before an action means the same element after it. A password field is named, never read; it
/// only says whether it was filled.
const SNAPSHOT_SCRIPT: &str = r#"(() => {
  const MAX = __MAX__;
  const selector = 'a[href], button, input:not([type=hidden]), textarea, select, summary, [role=button], [role=link],'
    + ' [role=checkbox], [role=tab], [role=menuitem], [contenteditable=true], [onclick]';
  let next = 1;
  document.querySelectorAll('[data-nyra]').forEach((el) => {
    next = Math.max(next, Number(el.getAttribute('data-nyra')) + 1);
  });
  // A page that copies an element copies its number too: the copy gets a new one
  const taken = new Set();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const clean = (text) => (text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const labelOf = (el) => {
    const byId = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    return clean(el.getAttribute('aria-label') || (byId && byId.innerText) || el.innerText || el.placeholder
      || el.getAttribute('title') || el.getAttribute('alt') || el.name || (el.type === 'submit' && el.value) || '');
  };
  const elements = [];
  for (const el of document.querySelectorAll(selector)) {
    if (elements.length >= MAX) break;
    if (!visible(el)) continue;
    let n = Number(el.getAttribute('data-nyra'));
    if (!n || taken.has(n)) {
      n = next++;
      el.setAttribute('data-nyra', String(n));
    }
    taken.add(n);
    const tag = el.tagName.toLowerCase();
    const kind = tag === 'input' ? 'input:' + (el.type || 'text') : el.getAttribute('role') || tag;
    const isPassword = tag === 'input' && el.type === 'password';
    const value = (tag === 'input' || tag === 'textarea') && !isPassword && el.value ? clean(el.value) : '';
    elements.push({ n, kind, label: labelOf(el), value, ...(isPassword ? { filled: el.value.length > 0 } : {}) });
  }
  const text = clean(document.body ? document.body.innerText : '').length
    ? (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, __TEXT__) : '';
  return { url: location.href, title: document.title, text, elements };
})()"#;

#[derive(Serialize, Default)]
pub struct PageState {
    url: String,
    title: String,
    text: String,
    elements: Value,
}

fn snapshot(session: &Session) -> Result<PageState, String> {
    let script = SNAPSHOT_SCRIPT
        .replace("__MAX__", &MAX_ELEMENTS.to_string())
        .replace("__TEXT__", &MAX_TEXT_CHARS.to_string());
    let value = session.evaluate(&script)?;
    Ok(PageState {
        url: value["url"].as_str().unwrap_or_default().to_string(),
        title: value["title"].as_str().unwrap_or_default().to_string(),
        text: value["text"].as_str().unwrap_or_default().to_string(),
        elements: value["elements"].clone(),
    })
}

/// The center of a numbered element, scrolled into view; an error when the page no longer has it
fn element_center(session: &Session, n: u32) -> Result<(f64, f64), String> {
    let script = format!(
        "(() => {{ const el = document.querySelector('[data-nyra=\"{n}\"]'); if (!el) return null;
           el.scrollIntoView({{ block: 'center', inline: 'center' }});
           const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }})()"
    );
    let value = session.evaluate(&script)?;
    match (value[0].as_f64(), value[1].as_f64()) {
        (Some(x), Some(y)) => Ok((x, y)),
        _ => Err(t_with("native.browser.noElement", &[("n", &n.to_string())])),
    }
}

fn mouse(session: &Session, kind: &str, x: f64, y: f64) -> Result<(), String> {
    session
        .page_call(
            "Input.dispatchMouseEvent",
            json!({ "type": kind, "x": x, "y": y, "button": "left", "clickCount": 1 }),
        )
        .map(|_| ())
}

/// The keys the model can press, as the protocol names them
fn key_event(key: &str) -> Option<Value> {
    let (name, code, number, text) = match key.trim().to_lowercase().as_str() {
        "enter" | "return" => ("Enter", "Enter", 13, "\r"),
        "tab" => ("Tab", "Tab", 9, ""),
        "escape" | "esc" => ("Escape", "Escape", 27, ""),
        "backspace" => ("Backspace", "Backspace", 8, ""),
        "arrowdown" | "down" => ("ArrowDown", "ArrowDown", 40, ""),
        "arrowup" | "up" => ("ArrowUp", "ArrowUp", 38, ""),
        "pagedown" => ("PageDown", "PageDown", 34, ""),
        "pageup" => ("PageUp", "PageUp", 33, ""),
        _ => return None,
    };
    Some(json!({ "key": name, "code": code, "windowsVirtualKeyCode": number, "text": text }))
}

/// Whether the address leads to this computer or its network, by where its name points: Nyra asks before going
/// there, since a page could steer it to the router or to a service on this computer
#[tauri::command]
pub async fn browser_is_local(url: String) -> bool {
    let Ok(url) = tauri_plugin_http::reqwest::Url::parse(&url) else {
        return true;
    };
    tauri::async_runtime::spawn_blocking(move || {
        url.socket_addrs(|| Some(80))
            .is_ok_and(|found| found.iter().any(|a| !crate::web::is_public(a.ip())))
    })
    .await
    .unwrap_or(true)
}

/// Whether a browser Nyra can drive is installed, and which
#[tauri::command]
pub fn browser_available() -> Option<String> {
    find_browser().map(|path| browser_name(&path))
}

/// The browser answers in its own time and its calls wait for it: off the async threads, so a slow page holds up
/// nothing else in Nyra
async fn in_browser<T: Send + 'static>(
    app: AppHandle,
    work: impl FnOnce(&AppHandle, &Browsers) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || work(&app, &app.state::<Browsers>()))
        .await
        .map_err(to_message)?
}

/// Opens the conversation's browser if it isn't yet, goes to the address and returns the page
#[tauri::command]
pub async fn browser_open(
    app: AppHandle,
    conversation_id: String,
    url: String,
) -> Result<PageState, String> {
    in_browser(app, move |app, browsers| {
        if !is_web_address(&url) {
            return Err(t_with("native.browser.navigateFailed", &[("error", &url)]));
        }
        let session = session_for(app, browsers, &conversation_id)?;
        let before = Instant::now();
        let reply = session.page_call("Page.navigate", json!({ "url": url }))?;
        if let Some(error) = reply["errorText"].as_str().filter(|e| !e.is_empty()) {
            return Err(t_with("native.browser.navigateFailed", &[("error", error)]));
        }
        session.settle(before);
        snapshot(&session)
    })
    .await
}

#[tauri::command]
pub async fn browser_click(
    app: AppHandle,
    conversation_id: String,
    n: u32,
) -> Result<PageState, String> {
    in_browser(app, move |_, browsers| {
        let session = open_session(browsers, &conversation_id)?;
        let (x, y) = element_center(&session, n)?;
        let before = Instant::now();
        mouse(&session, "mouseMoved", x, y)?;
        mouse(&session, "mousePressed", x, y)?;
        mouse(&session, "mouseReleased", x, y)?;
        session.settle(before);
        snapshot(&session)
    })
    .await
}

/// Writes in a field, replacing what it had
#[tauri::command]
pub async fn browser_type(
    app: AppHandle,
    conversation_id: String,
    n: u32,
    text: String,
) -> Result<PageState, String> {
    in_browser(app, move |_, browsers| {
        let session = open_session(browsers, &conversation_id)?;
        element_center(&session, n)?;
        let focus = format!(
            "(() => {{ const el = document.querySelector('[data-nyra=\"{n}\"]'); el.focus();
               if (typeof el.select === 'function') el.select(); return true; }})()"
        );
        session.evaluate(&focus)?;
        session.page_call("Input.insertText", json!({ "text": text }))?;
        thread::sleep(Duration::from_millis(200));
        snapshot(&session)
    })
    .await
}

#[tauri::command]
pub async fn browser_key(
    app: AppHandle,
    conversation_id: String,
    key: String,
) -> Result<PageState, String> {
    in_browser(app, move |_, browsers| {
        let session = open_session(browsers, &conversation_id)?;
        let event =
            key_event(&key).ok_or_else(|| t_with("native.browser.unknownKey", &[("key", &key)]))?;
        let before = Instant::now();
        for kind in ["keyDown", "keyUp"] {
            let mut params = event.clone();
            params["type"] = json!(kind);
            if kind == "keyUp" {
                params["text"] = json!("");
            }
            session.page_call("Input.dispatchKeyEvent", params)?;
        }
        session.settle(before);
        snapshot(&session)
    })
    .await
}

/// The page as a PNG, base64, drawn at the scale of the quality the user chose for shared images
#[tauri::command]
pub async fn browser_screenshot(
    app: AppHandle,
    conversation_id: String,
    scale: f64,
) -> Result<String, String> {
    in_browser(app, move |_, browsers| {
        let session = open_session(browsers, &conversation_id)?;
        let scale = scale.clamp(1.0, MAX_SCALE);
        checked_image(window_screenshot(&session, |_| scale, "png")?)
    })
    .await
}

/// A small JPEG of the window as it is now, base64, for the card that follows what a reply does in the browser
#[tauri::command]
pub async fn browser_thumbnail(app: AppHandle, conversation_id: String) -> Result<String, String> {
    in_browser(app, move |_, browsers| {
        let session = open_session(browsers, &conversation_id)?;
        checked_image(window_screenshot(
            &session,
            |width| THUMBNAIL_WIDTH / width.max(1.0),
            "jpeg",
        )?)
    })
    .await
}

/// Checked, so a broken capture is an error and not an empty image in the chat
fn checked_image(reply: Value) -> Result<String, String> {
    let data = reply["data"].as_str().unwrap_or_default();
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| t("native.browser.screenshotFailed"))?;
    Ok(data.to_string())
}

/// The page is drawn at the screen's pixels; the capture scales from those to the size asked, without touching the
/// window the user sees: it comes out scale_for(page width) pixels per point. format: "png" or "jpeg".
fn window_screenshot(
    session: &Session,
    scale_for: impl Fn(f64) -> f64,
    format: &str,
) -> Result<Value, String> {
    // The clip counts from the top of the document: what is on screen starts where the page is scrolled to
    let page = session.evaluate("[innerWidth, innerHeight, devicePixelRatio, scrollX, scrollY]")?;
    let number = |i: usize| page[i].as_f64().unwrap_or(0.0);
    let ratio = page[2].as_f64().filter(|r| *r > 0.0).unwrap_or(1.0);
    let scale = scale_for(number(0)) / ratio;
    let clip = json!({ "x": number(3), "y": number(4), "width": number(0), "height": number(1), "scale": scale });
    session.page_call(
        "Page.captureScreenshot",
        json!({ "format": format, "quality": THUMBNAIL_QUALITY, "clip": clip }),
    )
}

/// Opens the conversation's browser on an empty page, for the user to use it: the menu's «Open the browser»
#[tauri::command]
pub async fn browser_start(app: AppHandle, conversation_id: String) -> Result<(), String> {
    in_browser(app, move |app, browsers| {
        let session = session_for(app, browsers, &conversation_id)?;
        bring_to_front(&session)
    })
    .await
}

/// The browser's window in front of the others, also if it was minimized
fn bring_to_front(session: &Session) -> Result<(), String> {
    let window = session
        .cdp
        .call("Browser.getWindowForTarget", json!({}), Some(&session.page))?;
    if let Some(id) = window["windowId"].as_u64() {
        session.cdp.call(
            "Browser.setWindowBounds",
            json!({ "windowId": id, "bounds": { "windowState": "normal" } }),
            None,
        )?;
    }
    session
        .page_call("Page.bringToFront", json!({}))
        .map(|_| ())
}

#[tauri::command]
pub async fn browser_show(app: AppHandle, conversation_id: String) -> Result<(), String> {
    in_browser(app, move |_, browsers| {
        let session = open_session(browsers, &conversation_id)?;
        bring_to_front(&session)
    })
    .await
}

/// Where a text is on the whole page, beyond the part the model reads: how many times, a few passages around it and the
/// fields that hold it. Without minding capitals or accents; folded letter by letter so the passages are cut right.
const FIND_SCRIPT: &str = r#"((needle) => {
  const fold = (text) => Array.from(text, (c) => {
    const folded = c.normalize('NFD').charAt(0).toLowerCase();
    return folded.length === c.length ? folded : c;
  }).join('');
  const text = document.body ? document.body.innerText : '';
  const haystack = fold(text);
  const wanted = fold(needle.trim());
  const passages = [];
  let count = 0;
  for (let at = wanted ? haystack.indexOf(wanted) : -1; at !== -1; at = haystack.indexOf(wanted, at + wanted.length)) {
    count++;
    if (passages.length < 5) {
      passages.push(text.slice(Math.max(0, at - 60), at + wanted.length + 60).replace(/\s+/g, ' ').trim());
    }
  }
  const fields = wanted
    ? [...document.querySelectorAll('[data-nyra]')]
        .filter((el) => 'value' in el && el.type !== 'password' && fold(String(el.value)).includes(wanted))
        .map((el) => Number(el.getAttribute('data-nyra')))
    : [];
  return { count, passages, fields };
})(__NEEDLE__)"#;

#[derive(Serialize, Default)]
pub struct FoundText {
    count: u64,
    passages: Value,
    fields: Value,
}

#[tauri::command]
pub async fn browser_find(
    app: AppHandle,
    conversation_id: String,
    text: String,
) -> Result<FoundText, String> {
    in_browser(app, move |_, browsers| {
        let session = open_session(browsers, &conversation_id)?;
        let needle = serde_json::to_string(&text).map_err(to_message)?;
        let value = session.evaluate(&FIND_SCRIPT.replace("__NEEDLE__", &needle))?;
        Ok(FoundText {
            count: value["count"].as_u64().unwrap_or(0),
            passages: value["passages"].clone(),
            fields: value["fields"].clone(),
        })
    })
    .await
}

/// Marks the model puts on the page for the user: a box with a numbered note around an element or a text, or an
/// arrow from one to another. A closed shadow root keeps the page's styles out, and the styles are set from script
/// because a page's CSP may block <style>. The layer takes no clicks but on the notes, and each frame it follows what it
/// marks, through scrolling and resizing; what left the page is no longer drawn. A mark goes when the user uses what it
/// marks or clicks its note, and all of them when the address changes, also in a page that doesn't reload (a search).
const MARK_SCRIPT: &str = r#"((request) => {
  const KEY = '__nyraMarks';
  let state = window[KEY];
  if (!state || !state.host.isConnected) {
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483647' });
    const root = host.attachShadow({ mode: 'closed' });
    document.documentElement.appendChild(host);
    state = { host, root, marks: [], frame: 0, url: location.href };
    window[KEY] = state;
  }
  // Once per page, reading the current marks when it fires: clicking or writing in what a mark points at ends it
  if (!window[KEY + 'Listening']) {
    window[KEY + 'Listening'] = true;
    const used = (event) => {
      const current = window[KEY];
      if (!current) return;
      for (const mark of [...current.marks]) if (mark.usedBy(event)) mark.remove();
    };
    document.addEventListener('pointerdown', used, true);
    document.addEventListener('focusin', used, true);
  }
  const clear = () => {
    for (const mark of state.marks) for (const node of mark.nodes) node.remove();
    state.marks = [];
  };
  if (request.clear || request.fresh) clear();
  if (request.clear) return { found: true };
  state.url = location.href;

  // Without capitals or accents, letter by letter, so a place in the folded text is the same in the page's
  const fold = (text) => Array.from(text, (c) => {
    const folded = c.normalize('NFD').charAt(0).toLowerCase();
    return folded.length === c.length ? folded : c;
  }).join('');
  const shows = (r) => r.width > 0 && r.height > 0;

  // A text inside one text node is marked exactly; one split by tags, by the smallest element that holds it
  function byText(text) {
    const wanted = fold(text.trim());
    if (!wanted || !document.body) return null;
    let first = null;
    let count = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const folded = fold(node.data);
      for (let at = folded.indexOf(wanted); at !== -1; at = folded.indexOf(wanted, at + wanted.length)) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + wanted.length);
        if (!shows(range.getBoundingClientRect())) continue;
        count++;
        if (!first) first = range;
      }
    }
    if (first) return { rect: () => first.getBoundingClientRect(), element: first.startContainer.parentElement, count };
    const holders = [...document.body.querySelectorAll('*')].slice(0, 5000)
      .filter((el) => fold(el.textContent || '').includes(wanted) && shows(el.getBoundingClientRect()));
    const smallest = holders.filter((el) => !holders.some((other) => other !== el && el.contains(other)));
    if (smallest.length === 0) return null;
    return { rect: () => smallest[0].getBoundingClientRect(), element: smallest[0], count: smallest.length };
  }

  function locate(target) {
    if (typeof target.n === 'number') {
      const element = document.querySelector('[data-nyra="' + target.n + '"]');
      return element ? { rect: () => element.getBoundingClientRect(), element, count: 1 } : null;
    }
    return byText(String(target.text || ''));
  }

  const from = locate(request.from);
  if (!from) return { found: false, missing: 'from' };
  const to = request.to ? locate(request.to) : null;
  if (request.to && !to) return { found: false, missing: 'to' };

  // Marking the same again (once a hidden one came into view) replaces it rather than stacking a second one
  for (const old of [...state.marks]) {
    if (old.from.element === from.element && (old.to && old.to.element) === (to && to.element)) old.remove();
  }
  // The user's accent, only as a plain #rrggbb; the glow is the same color, see-through
  const ACCENT = /^#[0-9a-f]{6}$/i.test(request.color || '') ? request.color : '#7c4dd8';
  const GLOW = 'rgba(' + [1, 3, 5].map((i) => parseInt(ACCENT.slice(i, i + 2), 16)).join(',') + ',0.55)';
  const number = state.marks.length + 1;
  const make = (tag, style) => {
    const node = tag === 'svg' || tag === 'path'
      ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
    if (style) Object.assign(node.style, style);
    return node;
  };
  const box = make('div', {
    position: 'fixed', boxSizing: 'border-box', border: '3px solid ' + ACCENT, borderRadius: '8px',
    boxShadow: '0 0 0 3px rgba(255,255,255,0.85), 0 0 18px ' + GLOW,
  });
  const label = make('div', {
    position: 'fixed', maxWidth: '320px', padding: '6px 10px', borderRadius: '10px', background: ACCENT,
    color: '#fff', font: '600 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif',
    boxShadow: '0 4px 14px rgba(0,0,0,0.3)', whiteSpace: 'normal', overflowWrap: 'anywhere',
    pointerEvents: 'auto', cursor: 'pointer',
  });
  label.textContent = request.note ? number + ' · ' + request.note : String(number);
  const nodes = [box, label];
  let arrow = null;
  if (to) {
    arrow = make('svg', { position: 'fixed', inset: '0', width: '100%', height: '100%', overflow: 'visible' });
    const line = make('path');
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', ACCENT);
    line.setAttribute('stroke-width', '4');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    arrow.appendChild(line);
    nodes.unshift(arrow);
  }
  for (const node of nodes) state.root.appendChild(node);

  const center = (r) => [r.x + r.width / 2, r.y + r.height / 2];
  // Where the line from a point toward a box's center meets its border, so the head points at the edge
  const edge = (r, [x, y]) => {
    const [cx, cy] = center(r);
    const dx = x - cx;
    const dy = y - cy;
    const scale = Math.min(Math.abs(dx) > 0 ? r.width / 2 / Math.abs(dx) : Infinity,
      Math.abs(dy) > 0 ? r.height / 2 / Math.abs(dy) : Infinity, 1);
    return [cx + dx * scale, cy + dy * scale];
  };
  // The part of an end the user can see: cut by the window and by every container that hides what overflows it (a
  // carousel, a panel), and nothing when something else covers its middle. null when none of it shows.
  function seenRect(end) {
    const r = end.rect();
    if (!shows(r)) return null;
    let left = Math.max(r.x, 0);
    let top = Math.max(r.y, 0);
    let right = Math.min(r.x + r.width, innerWidth);
    let bottom = Math.min(r.y + r.height, innerHeight);
    for (let a = end.element && end.element.parentElement; a && a !== document.body; a = a.parentElement) {
      const style = getComputedStyle(a);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const c = a.getBoundingClientRect();
      left = Math.max(left, c.x);
      top = Math.max(top, c.y);
      right = Math.min(right, c.x + c.width);
      bottom = Math.min(bottom, c.y + c.height);
    }
    if (right - left < 2 || bottom - top < 2) return null;
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    const covered = hit && hit !== state.host && end.element && !end.element.contains(hit) && !hit.contains(end.element);
    return covered ? null : { x: left, y: top, width: right - left, height: bottom - top };
  }

  function place() {
    const r = seenRect(from);
    const shown = !!r;
    const end = to && seenRect(to);
    // The box goes on what the arrow points at; the note stays by where it starts
    const boxed = end || r;
    for (const node of nodes) node.style.display = shown ? '' : 'none';
    if (!shown) return;
    Object.assign(box.style, { left: boxed.x - 6 + 'px', top: boxed.y - 6 + 'px', width: boxed.width + 12 + 'px',
      height: boxed.height + 12 + 'px' });
    const above = r.y - label.offsetHeight - 10;
    const top = above >= 4 ? above : r.y + r.height + 10;
    const left = Math.min(Math.max(4, r.x - 6), innerWidth - label.offsetWidth - 4);
    Object.assign(label.style, { left: left + 'px', top: top + 'px' });
    if (arrow) arrow.style.display = end ? '' : 'none';
    if (arrow && end) {
      // From the border of what it starts at to just outside the box, so it neither crosses the text nor hides its head
      const grown = (rect, by) => ({ x: rect.x - by, y: rect.y - by, width: rect.width + by * 2, height: rect.height + by * 2 });
      const [sx, sy] = edge(grown(r, 3), center(end));
      const [ex, ey] = edge(grown(end, 11), [sx, sy]);
      const angle = Math.atan2(ey - sy, ex - sx);
      const head = (side) => [ex - 14 * Math.cos(angle + side * 0.45), ey - 14 * Math.sin(angle + side * 0.45)];
      const [lx, ly] = head(1);
      const [rx, ry] = head(-1);
      arrow.firstChild.setAttribute('d', 'M' + sx + ' ' + sy + ' L' + ex + ' ' + ey + ' M' + lx + ' ' + ly + ' L' + ex
        + ' ' + ey + ' L' + rx + ' ' + ry);
    }
  }
  const inside = (r, event) => 'clientX' in event && event.clientX >= r.x && event.clientX <= r.x + r.width
    && event.clientY >= r.y && event.clientY <= r.y + r.height;
  // An element is used when the event is in it; a marked text, when the click lands on the part of it that shows. A
  // hidden one isn't used by a click over where it hides: that may be the arrow that brings it into view.
  const uses = (end, event) => {
    if (!end) return false;
    const whole = end.element === document.body || end.element === document.documentElement;
    const seen = seenRect(end);
    return (!!seen && !whole && !!end.element && end.element.contains(event.target)) || (!!seen && inside(seen, event));
  };
  const mark = {
    from,
    to,
    nodes,
    place,
    usedBy: (event) => uses(from, event) || uses(to, event),
    remove: () => {
      for (const node of nodes) node.remove();
      state.marks = state.marks.filter((other) => other !== mark);
    },
  };
  label.addEventListener('click', mark.remove);
  state.marks.push(mark);
  const loop = () => {
    if (location.href !== state.url) clear();
    for (const current of state.marks) current.place();
    state.frame = state.marks.length > 0 ? requestAnimationFrame(loop) : 0;
  };
  if (!state.frame) loop();
  else place();
  from.element?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  box.animate([{ opacity: 0, transform: 'scale(1.12)' }, { opacity: 1, transform: 'scale(1)' }],
    { duration: 380, easing: 'ease-out' });
  // Once the scroll ends: whether the user sees it now, or it waits inside something that hides it (a carousel moved
  // by its arrows, a closed menu, a tab) or behind something
  return new Promise((resolve) => setTimeout(() => resolve({
    found: true, number, count: from.count, visible: !!seenRect(from) && (!to || !!seenRect(to)),
  }), 600));
})(__REQUEST__)"#;

/// What a mark did: drawn with its number, how many times the text it points at shows on the page, whether the user
/// can see it, or which of its two ends wasn't found
#[derive(Serialize, Default)]
pub struct MarkOutcome {
    found: bool,
    visible: bool,
    number: Option<u64>,
    count: Option<u64>,
    missing: Option<String>,
}

/// request: { from: { n } | { text }, to?, note, fresh?: the first of a reply, which clears the earlier ones } or
/// { clear: true }
#[tauri::command]
pub async fn browser_mark(
    app: AppHandle,
    conversation_id: String,
    request: Value,
) -> Result<MarkOutcome, String> {
    in_browser(app, move |_, browsers| {
        let session = open_session(browsers, &conversation_id)?;
        // JSON is a JS expression: the request goes in as data, never as code
        let data = serde_json::to_string(&request).map_err(to_message)?;
        let value = session.evaluate(&MARK_SCRIPT.replace("__REQUEST__", &data))?;
        Ok(MarkOutcome {
            found: value["found"].as_bool().unwrap_or(false),
            visible: value["visible"].as_bool().unwrap_or(false),
            number: value["number"].as_u64(),
            count: value["count"].as_u64(),
            missing: value["missing"].as_str().map(str::to_string),
        })
    })
    .await
}

/// The page as the model reads it, after the user used the browser
#[tauri::command]
pub async fn browser_snapshot(
    app: AppHandle,
    conversation_id: String,
) -> Result<PageState, String> {
    in_browser(app, move |_, browsers| {
        let session = open_session(browsers, &conversation_id)?;
        snapshot(&session)
    })
    .await
}

#[tauri::command]
pub fn browser_close(state: State<'_, Browsers>, conversation_id: String) {
    if let Some(session) = state.remove(&conversation_id) {
        session.close();
    }
}

/// A deleted conversation takes its browser with it
pub fn close_for(app: &AppHandle, conversation: &str) {
    if let Some(session) = app.state::<Browsers>().remove(conversation) {
        session.close();
    }
}

/// Deleting every conversation, or Nyra quitting, closes them all
pub fn close_all(app: &AppHandle) {
    let state = app.state::<Browsers>();
    let sessions: Vec<Arc<Session>> = state
        .sessions
        .lock()
        .map(|mut s| s.drain().map(|(_, session)| session).collect())
        .unwrap_or_default();
    for session in sessions {
        session.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Somewhere on screen: the real-browser tests below show its window for a moment
    const TEST_WINDOW: Placement = Placement {
        x: 120,
        y: 80,
        width: 900,
        height: 700,
    };

    /// Serves the page `page` picks from each request's first line, on a free local port it returns
    fn serve(page: impl Fn(&str) -> &'static str + Send + 'static) -> u16 {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            for mut stream in listener.incoming().flatten() {
                let mut request = [0u8; 4096];
                let read = stream.read(&mut request).unwrap_or(0);
                let request = String::from_utf8_lossy(&request[..read]);
                let body = page(request.lines().next().unwrap_or(""));
                let reply = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(reply.as_bytes());
            }
        });
        port
    }

    #[test]
    fn names_the_browser_by_where_it_is() {
        assert_eq!(
            browser_name(Path::new(
                "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
            )),
            "Microsoft Edge"
        );
        assert_eq!(
            browser_name(Path::new(
                r"C:\Program Files\Google\Chrome\Application\chrome.exe"
            )),
            "Google Chrome"
        );
        assert_eq!(browser_name(Path::new("/usr/bin/chromium")), "Chromium");
    }

    // A real browser against a login page served here: cargo test browser -- --ignored
    #[test]
    #[ignore = "opens the installed browser"]
    fn logs_in_on_a_local_page_and_takes_a_screenshot() {
        let port = serve(|request_line| {
            if request_line.starts_with("GET /panel") {
                "<html><head><title>Panel</title></head><body><h1>Hola, Marta</h1><p>Ventas: 42</p></body></html>"
            } else {
                "<html><head><title>Entrar</title></head><body><form action='/panel'>
                 <label for='u'>Usuario</label><input id='u' name='u'>
                 <label for='p'>Contraseña</label><input id='p' name='p' type='password'>
                 <button type='submit'>Entrar</button></form></body></html>"
            }
        });
        let emit: Emit = Arc::new(|_, _| {});
        let profiles = std::env::temp_dir().join(format!("nyra-browser-test-{}", now_millis()));
        let session = launch(&profiles, "test", emit, TEST_WINDOW).expect("a browser is installed");
        let before = Instant::now();
        session
            .page_call(
                "Page.navigate",
                json!({ "url": format!("http://127.0.0.1:{port}/") }),
            )
            .unwrap();
        session.settle(before);
        let page = snapshot(&session).unwrap();
        assert_eq!(page.title, "Entrar");
        let find = |label: &str| {
            page.elements
                .as_array()
                .unwrap()
                .iter()
                .find(|e| e["label"] == label)
                .and_then(|e| e["n"].as_u64())
                .unwrap() as u32
        };
        let (user, password, enter) = (find("Usuario"), find("Contraseña"), find("Entrar"));
        for (n, text) in [(user, "marta"), (password, "secreto")] {
            element_center(&session, n).unwrap();
            session
                .evaluate(&format!(
                    "document.querySelector('[data-nyra=\"{n}\"]').focus()"
                ))
                .unwrap();
            session
                .page_call("Input.insertText", json!({ "text": text }))
                .unwrap();
        }
        // The password field is named but its value never goes to the model
        let filled = snapshot(&session).unwrap();
        assert!(!serde_json::to_string(&filled.elements)
            .unwrap()
            .contains("secreto"));
        let (x, y) = element_center(&session, enter).unwrap();
        let before = Instant::now();
        for kind in ["mouseMoved", "mousePressed", "mouseReleased"] {
            mouse(&session, kind, x, y).unwrap();
        }
        session.settle(before);
        let panel = snapshot(&session).unwrap();
        assert_eq!(panel.title, "Panel");
        assert!(panel.text.contains("Ventas: 42"));
        assert!(panel.url.contains("u=marta"));
        session.close();
        // The temporary profile went with it, once the browser's helpers let go of it
        let started = Instant::now();
        while fs::read_dir(&profiles).unwrap().count() > 0 {
            assert!(
                started.elapsed() < Duration::from_secs(6),
                "the profile was deleted"
            );
            thread::sleep(Duration::from_millis(100));
        }
        let _ = fs::remove_dir_all(&profiles);
    }

    #[test]
    #[ignore = "opens the installed browser"]
    fn keeps_numbers_when_the_page_adds_elements_and_finds_text() {
        // Writing in the field adds a "Borrar" button before "Buscar", as some search boxes do
        let port = serve(|_| {
            "<html><body><p>Canción del día: Música en Ñuñoa</p><div id='box'>
            <input id='q' aria-label='Buscar texto'><button id='go'>Buscar</button></div>
            <script>document.getElementById('q').addEventListener('input', () => {
              if (document.getElementById('clear')) return;
              const b = document.createElement('button'); b.id = 'clear'; b.textContent = 'Borrar';
              document.getElementById('go').before(b); });</script></body></html>"
        });
        let emit: Emit = Arc::new(|_, _| {});
        let profiles = std::env::temp_dir().join(format!("nyra-browser-test-{}", now_millis()));
        let session =
            launch(&profiles, "numbers", emit, TEST_WINDOW).expect("a browser is installed");
        let before = Instant::now();
        session
            .page_call(
                "Page.navigate",
                json!({ "url": format!("http://127.0.0.1:{port}/") }),
            )
            .unwrap();
        session.settle(before);
        let number = |page: &PageState, label: &str| {
            page.elements
                .as_array()
                .unwrap()
                .iter()
                .find(|e| e["label"] == label)
                .and_then(|e| e["n"].as_u64())
        };
        let first = snapshot(&session).unwrap();
        let (field, search) = (
            number(&first, "Buscar texto").unwrap(),
            number(&first, "Buscar").unwrap(),
        );
        session
            .evaluate(&format!(
                "(() => {{ const el = document.querySelector('[data-nyra=\"{field}\"]'); el.focus(); return true; }})()"
            ))
            .unwrap();
        session
            .page_call("Input.insertText", json!({ "text": "Linkin Park" }))
            .unwrap();
        thread::sleep(Duration::from_millis(200));
        let after = snapshot(&session).unwrap();
        assert_eq!(
            number(&after, "Buscar"),
            Some(search),
            "{:?}",
            after.elements
        );
        assert_eq!(number(&after, "Buscar texto"), Some(field));
        assert!(number(&after, "Borrar").unwrap() > search.max(field));

        let find = |text: &str| {
            let needle = serde_json::to_string(text).unwrap();
            session
                .evaluate(&FIND_SCRIPT.replace("__NEEDLE__", &needle))
                .unwrap()
        };
        let in_field = find("linkin park");
        assert_eq!(in_field["fields"], json!([field]));
        let in_text = find("MUSICA EN NUNOA");
        assert_eq!(in_text["count"], 1);
        assert!(in_text["passages"][0]
            .as_str()
            .unwrap()
            .contains("Música en Ñuñoa"));
        assert_eq!(find("no está")["count"], 0);
        session.close();
    }

    #[test]
    fn opens_only_web_pages() {
        assert!(is_web_address("https://ejemplo.com"));
        assert!(is_web_address("HTTP://localhost:3000/panel"));
        assert!(!is_web_address("file:///etc/hosts"));
        assert!(!is_web_address("javascript:alert(1)"));
        assert!(!is_web_address("chrome://settings"));
        assert!(!is_web_address("about:blank"));
    }

    #[test]
    fn knows_the_keys_the_model_can_press() {
        assert_eq!(key_event("Enter").unwrap()["windowsVirtualKeyCode"], 13);
        assert_eq!(key_event(" tab ").unwrap()["key"], "Tab");
        assert!(key_event("F13").is_none());
    }

    // cargo test browser -- --ignored
    #[test]
    #[ignore = "opens the installed browser"]
    fn opens_a_new_tab_in_the_page_and_says_where_it_went() {
        let port = serve(|request_line| {
            if request_line.starts_with("GET /other") {
                "<html><head><title>Otra</title></head><body>Otra página</body></html>"
            } else {
                "<html><head><title>Inicio</title></head><body>
                 <a id=a href='/other' target='_blank' style='font-size:40px'>Abrir</a></body></html>"
            }
        });
        let pages = Arc::new(Mutex::new(Vec::<String>::new()));
        let seen = Arc::clone(&pages);
        let emit: Emit = Arc::new(move |event, payload| {
            if event == PAGE_EVENT {
                seen.lock()
                    .unwrap()
                    .push(payload["title"].as_str().unwrap_or_default().to_string());
            }
        });
        let profiles = std::env::temp_dir().join(format!("nyra-browser-tabs-{}", now_millis()));
        let session = launch(&profiles, "tabs", emit, TEST_WINDOW).expect("a browser is installed");
        let before = Instant::now();
        session
            .page_call(
                "Page.navigate",
                json!({ "url": format!("http://127.0.0.1:{port}/") }),
            )
            .unwrap();
        session.settle(before);
        // A click as Nyra makes it
        let link = snapshot(&session).unwrap();
        assert_eq!(link.title, "Inicio");
        let (x, y) = element_center(&session, 1).unwrap();
        for kind in ["mouseMoved", "mousePressed", "mouseReleased"] {
            mouse(&session, kind, x, y).unwrap();
        }
        let started = Instant::now();
        while snapshot(&session).map(|p| p.title).unwrap_or_default() != "Otra" {
            assert!(
                started.elapsed() < Duration::from_secs(10),
                "the new tab opened in the page"
            );
            thread::sleep(Duration::from_millis(100));
        }
        let targets = session
            .cdp
            .call("Target.getTargets", json!({}), None)
            .unwrap();
        let open_pages = targets["targetInfos"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| t["type"] == "page")
            .count();
        assert_eq!(open_pages, 1, "the other tab was closed");
        let started = Instant::now();
        while !pages.lock().unwrap().iter().any(|title| title == "Otra") {
            assert!(
                started.elapsed() < Duration::from_secs(5),
                "the chat heard where it went: {:?}",
                pages.lock().unwrap()
            );
            thread::sleep(Duration::from_millis(100));
        }
        session.close();
        let _ = fs::remove_dir_all(&profiles);
    }

    // cargo test browser -- --ignored; a Chrome window shows for a moment
    #[test]
    #[ignore = "opens the installed browser"]
    fn a_window_leaves_the_user_tabs_alone_and_ends_when_closed() {
        let closed = Arc::new(AtomicU64::new(0));
        let counted = Arc::clone(&closed);
        let emit: Emit = Arc::new(move |event, _| {
            if event == CLOSED_EVENT {
                counted.fetch_add(1, Ordering::Relaxed);
            }
        });
        let profiles = std::env::temp_dir().join(format!("nyra-browser-window-{}", now_millis()));
        let session =
            launch(&profiles, "window", emit, TEST_WINDOW).expect("a browser is installed");
        let before = Instant::now();
        let tall = "data:text/html,<div style='height:3000px'>Arriba</div><p>Abajo</p>";
        session
            .page_call("Page.navigate", json!({ "url": tall }))
            .unwrap();
        session.settle(before);
        session.evaluate("scrollTo(0, 2500)").unwrap();
        // The quality asked, from the screen's own pixels, of what is on screen
        let shot = window_screenshot(&session, |_| 2.0, "png").unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(shot["data"].as_str().unwrap())
            .unwrap();
        let width = session.evaluate("innerWidth").unwrap().as_u64().unwrap() as u32;
        assert_eq!(
            u32::from_be_bytes(bytes[16..20].try_into().unwrap()),
            width * 2
        );
        // The card's picture is a small JPEG, whatever the page's width
        let thumbnail = window_screenshot(&session, |w| THUMBNAIL_WIDTH / w, "jpeg").unwrap();
        let jpeg = base64::engine::general_purpose::STANDARD
            .decode(thumbnail["data"].as_str().unwrap())
            .unwrap();
        assert_eq!(&jpeg[..2], &[0xFF, 0xD8]);
        assert!(jpeg.len() < 120_000, "{} bytes", jpeg.len());
        // A tab the user opens is theirs: it isn't moved into Nyra's page
        session
            .cdp
            .call(
                "Target.createTarget",
                json!({ "url": "https://example.com/" }),
                None,
            )
            .unwrap();
        thread::sleep(Duration::from_millis(1500));
        let targets = session
            .cdp
            .call("Target.getTargets", json!({}), None)
            .unwrap();
        let pages = targets["targetInfos"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| t["type"] == "page")
            .count();
        assert_eq!(pages, 2);
        // Closing Nyra's page, as closing its window does, ends the browser for Nyra
        let ours = session.cdp.signals.lock().unwrap().target.clone().unwrap();
        session
            .cdp
            .call("Target.closeTarget", json!({ "targetId": ours }), None)
            .unwrap();
        let started = Instant::now();
        while closed.load(Ordering::Relaxed) == 0 {
            assert!(
                started.elapsed() < Duration::from_secs(5),
                "Nyra heard the window close"
            );
            thread::sleep(Duration::from_millis(100));
        }
        session.close();
        let _ = fs::remove_dir_all(&profiles);
    }
}
