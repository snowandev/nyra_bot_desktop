//! The quick chat bar: a small window of its own, without borders, that a global shortcut shows and hides from any
//! app. It grows upwards as the chat opens, so the place where the user types stays put. It can be dragged anywhere,
//! and then it comes back where it was left.

use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::ipc::Response;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::i18n::{t, t_with};
use crate::screen_capture;
use crate::util::{data_dir, to_message};

pub const LABEL: &str = "quick";
// Passed on the command line ("nyra-bot --quick") it opens the bar: what a desktop shortcut runs where the app
// can't have a global one (Linux on Wayland)
pub const QUICK_ARG: &str = "--quick";
const BAR_HEIGHT: f64 = 64.0;
// Kept clear between the bar and the screen's edges when a size doesn't fit
const SCREEN_MARGIN: f64 = 24.0;
// Where the bar appears until the user moves it: centred, this far above the Dock or taskbar
const DEFAULT_BOTTOM_MARGIN: f64 = 80.0;
const POSITION_FILE: &str = "quick-position.json";
// Sent to the bar each time it appears, so it puts the cursor in the box, and each time it hides, so it knows how
// long ago the conversation was left
const SHOWN_EVENT: &str = "nyra://quick-shown";
const HIDDEN_EVENT: &str = "nyra://quick-hidden";
// For Settings, whenever the shortcut changes or fails
const SHORTCUT_EVENT: &str = "nyra://quick-shortcut";

/// How big the chat grows, as chosen in Settings → Chat rápido: its width and the most it grows upwards
#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum QuickSize {
    #[default]
    Normal,
    Large,
    ExtraLarge,
}

impl QuickSize {
    fn dimensions(self) -> (f64, f64) {
        match self {
            QuickSize::Normal => (680.0, 520.0),
            QuickSize::Large => (860.0, 700.0),
            QuickSize::ExtraLarge => (1080.0, 880.0),
        }
    }
}

/// Where the user left the bar: its left edge and its bottom edge, in logical pixels. The bottom, because the window
/// grows upwards and the bar is at its foot.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
struct Anchor {
    x: f64,
    bottom: f64,
}

pub struct Quick {
    anchor: Mutex<Option<Anchor>>,
    // Once the user drags the bar its place is kept; until then it follows the screen with the mouse
    placed: AtomicBool,
    // While the user selects an area to capture the bar is hidden on purpose, and losing focus mustn't count
    capturing: AtomicBool,
    // Pinned by the user: it stays while they work in other apps, until the shortcut, Esc or its close button
    pinned: AtomicBool,
    shortcut: Mutex<ShortcutStatus>,
    size: Mutex<QuickSize>,
}

/// What Settings shows about the shortcut: the one in use, if it works, and how to open the bar without one
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutStatus {
    shortcut: Option<String>,
    registered: bool,
    error: Option<String>,
    // Linux on Wayland doesn't let apps have global shortcuts: one is made in the desktop's settings instead
    wayland: bool,
    // What that desktop shortcut runs
    command: String,
}

fn is_wayland() -> bool {
    cfg!(target_os = "linux")
        && (std::env::var("XDG_SESSION_TYPE").is_ok_and(|kind| kind == "wayland")
            || std::env::var_os("WAYLAND_DISPLAY").is_some())
}

fn open_command() -> String {
    let program = std::env::current_exe()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "nyra-bot".to_string());
    format!("\"{program}\" {QUICK_ARG}")
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

fn hide(app: &AppHandle) -> Result<(), String> {
    let window = window(app).ok_or_else(|| t("native.quick.notOpen"))?;
    if !window.is_visible().unwrap_or(false) {
        return Ok(());
    }
    window.hide().map_err(to_message)?;
    window.emit(HIDDEN_EVENT, ()).map_err(to_message)
}

fn read_anchor(app: &AppHandle) -> Option<Anchor> {
    let text = fs::read_to_string(data_dir(app).ok()?.join(POSITION_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

fn save_anchor(app: &AppHandle, anchor: Anchor) {
    // Only where it reopens: losing it puts the bar back in its default place
    if let (Ok(dir), Ok(json)) = (data_dir(app), serde_json::to_string(&anchor)) {
        let _ = fs::create_dir_all(&dir);
        let _ = fs::write(dir.join(POSITION_FILE), json);
    }
}

/// Created hidden on start, so the shortcut shows it at once. Transparent with the system's own blur and rounded
/// corners on macOS and Windows; on Linux many desktops can't draw a transparent window, so it is solid there.
pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let anchor = read_anchor(app);
    app.manage(Quick {
        placed: AtomicBool::new(anchor.is_some()),
        capturing: AtomicBool::new(false),
        pinned: AtomicBool::new(false),
        anchor: Mutex::new(anchor),
        shortcut: Mutex::new(ShortcutStatus {
            wayland: is_wayland(),
            command: open_command(),
            ..ShortcutStatus::default()
        }),
        size: Mutex::new(QuickSize::default()),
    });
    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("quick.html".into()))
        .title("Nyra")
        .inner_size(QuickSize::default().dimensions().0, BAR_HEIGHT)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .visible_on_all_workspaces(true)
        .shadow(true)
        // Files dropped on it reach the page, which attaches them, as in the main window (dragDropEnabled: false)
        .disable_drag_drop_handler();
    #[cfg(not(target_os = "linux"))]
    let builder = {
        use tauri::window::{Effect, EffectState, EffectsBuilder};
        builder.transparent(true).effects(
            EffectsBuilder::new()
                .effects([Effect::Popover, Effect::Acrylic])
                .state(EffectState::Active)
                .radius(16.0)
                .build(),
        )
    };
    builder.build()?;
    Ok(())
}

/// Where the bar goes now: where the user left it, if that is still on a screen; otherwise centred on the screen
/// with the mouse
/// The chosen size, made to fit the work area of the screen the bar is on (a small screen, a large size)
fn dimensions(app: &AppHandle, window: &WebviewWindow) -> (f64, f64) {
    let (width, height) = app
        .state::<Quick>()
        .size
        .lock()
        .map(|size| size.dimensions())
        .unwrap_or_else(|_| QuickSize::default().dimensions());
    let Some(monitor) = window.current_monitor().ok().flatten() else {
        return (width, height);
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let room_width = f64::from(area.size.width) / scale - SCREEN_MARGIN * 2.0;
    let room_height = f64::from(area.size.height) / scale - SCREEN_MARGIN * 2.0;
    (
        width.min(room_width),
        height.min(room_height).max(BAR_HEIGHT),
    )
}

fn anchor_now(app: &AppHandle, window: &WebviewWindow) -> Result<Anchor, String> {
    let (width, _) = dimensions(app, window);
    let saved = app
        .state::<Quick>()
        .anchor
        .lock()
        .ok()
        .and_then(|anchor| *anchor);
    let monitors = window.available_monitors().map_err(to_message)?;
    let on_a_screen = |anchor: &Anchor| {
        monitors.iter().any(|m| {
            let scale = m.scale_factor();
            let (x, y) = (m.position().x as f64 / scale, m.position().y as f64 / scale);
            let (w, h) = (
                m.size().width as f64 / scale,
                m.size().height as f64 / scale,
            );
            anchor.x >= x
                && anchor.x + width <= x + w
                && anchor.bottom > y
                && anchor.bottom <= y + h
        })
    };
    if let Some(anchor) = saved.filter(on_a_screen) {
        return Ok(anchor);
    }
    let cursor = app.cursor_position().map_err(to_message)?;
    let monitor = app
        .monitor_from_point(cursor.x, cursor.y)
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| t("native.quick.noScreen"))?;
    let scale = monitor.scale_factor();
    // The work area leaves out the Dock, the taskbar and the menu bar
    let area = monitor.work_area();
    let (x, y) = (
        area.position.x as f64 / scale,
        area.position.y as f64 / scale,
    );
    let (w, h) = (
        area.size.width as f64 / scale,
        area.size.height as f64 / scale,
    );
    Ok(Anchor {
        x: x + (w - width) / 2.0,
        bottom: y + h - DEFAULT_BOTTOM_MARGIN,
    })
}

fn current_height(window: &WebviewWindow) -> Result<f64, String> {
    let scale = window.scale_factor().map_err(to_message)?;
    Ok(window
        .inner_size()
        .map_err(to_message)?
        .to_logical::<f64>(scale)
        .height)
}

fn place(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let anchor = anchor_now(app, window)?;
    let height = current_height(window)?;
    window
        .set_position(LogicalPosition::new(anchor.x, anchor.bottom - height))
        .map_err(to_message)
}

fn show(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    place(app, window)?;
    window.show().map_err(to_message)?;
    window.set_focus().map_err(to_message)?;
    window.emit(SHOWN_EVENT, ()).map_err(to_message)
}

/// From the icon's menu: shown, or brought forward if it already is
pub fn open(app: &AppHandle) {
    let Some(window) = window(app) else {
        return;
    };
    let result = if window.is_visible().unwrap_or(false) {
        window.set_focus().map_err(to_message)
    } else {
        show(app, &window)
    };
    if let Err(error) = result {
        eprintln!("Could not show the quick chat bar: {error}");
    }
}

/// The shortcut that opens the bar, while it works
pub fn working_shortcut(app: &AppHandle) -> Option<String> {
    let status = app.state::<Quick>().shortcut.lock().ok()?.clone();
    status.shortcut.filter(|_| status.registered)
}

/// The same shortcut opens and closes it
pub fn toggle(app: &AppHandle) {
    let Some(window) = window(app) else {
        return;
    };
    let result = if window.is_visible().unwrap_or(false) {
        hide(app)
    } else {
        show(app, &window)
    };
    if let Err(error) = result {
        eprintln!("Could not show the quick chat bar: {error}");
    }
}

/// Clicking another app hides it, as Esc does, unless it is pinned; the conversation stays for the next time
pub fn on_focus_lost(window: &tauri::Window) {
    let app = window.app_handle();
    let quick = app.state::<Quick>();
    if quick.capturing.load(Ordering::Relaxed) || quick.pinned.load(Ordering::Relaxed) {
        return;
    }
    let _ = hide(app);
}

/// After the user drags it, wherever it ends up is where it opens from then on. The app's own moves (growing,
/// reopening) keep the same bottom edge, so saving them changes nothing.
pub fn on_moved(window: &tauri::Window) {
    let app = window.app_handle();
    let quick = app.state::<Quick>();
    if !quick.placed.load(Ordering::Relaxed) {
        return;
    }
    let (Ok(position), Ok(size), Ok(scale)) = (
        window.outer_position(),
        window.inner_size(),
        window.scale_factor(),
    ) else {
        return;
    };
    let position = position.to_logical::<f64>(scale);
    let anchor = Anchor {
        x: position.x,
        bottom: position.y + size.to_logical::<f64>(scale).height,
    };
    if let Ok(mut saved) = quick.anchor.lock() {
        *saved = Some(anchor);
    }
    save_anchor(app, anchor);
}

/// The bar's content changed height (lines of text, the chat opening): the window follows, keeping its bottom edge
#[tauri::command]
pub fn resize_quick(app: AppHandle, height: f64) -> Result<(), String> {
    let window = window(&app).ok_or_else(|| t("native.quick.notOpen"))?;
    let (width, max_height) = dimensions(&app, &window);
    let height = height.clamp(BAR_HEIGHT, max_height);
    let scale = window.scale_factor().map_err(to_message)?;
    let position = window
        .outer_position()
        .map_err(to_message)?
        .to_logical::<f64>(scale);
    let bottom = position.y + current_height(&window).map_err(to_message)?;
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(to_message)?;
    window
        .set_position(LogicalPosition::new(position.x, bottom - height))
        .map_err(to_message)
}

/// Settings → Chat rápido changed how big the chat grows, or the bar opened on another screen: the window takes the new
/// width where it is, and the page learns how tall it may grow (the size, or less on a small screen)
#[tauri::command]
pub fn set_quick_size(app: AppHandle, size: QuickSize) -> Result<f64, String> {
    let window = window(&app).ok_or_else(|| t("native.quick.notOpen"))?;
    *app.state::<Quick>().size.lock().map_err(to_message)? = size;
    let (width, max_height) = dimensions(&app, &window);
    let height = current_height(&window)?.min(max_height);
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(to_message)?;
    place(&app, &window)?;
    Ok(max_height)
}

/// Pressed on the bar's handle: the system moves the window with the mouse, and its place is kept from now on
#[tauri::command]
pub fn drag_quick(app: AppHandle) -> Result<(), String> {
    let window = window(&app).ok_or_else(|| t("native.quick.notOpen"))?;
    app.state::<Quick>().placed.store(true, Ordering::Relaxed);
    window.start_dragging().map_err(to_message)
}

/// Double-clicked on the bar's handle: it goes back to its default place and follows the mouse's screen again
#[tauri::command]
pub fn reset_quick_position(app: AppHandle) -> Result<(), String> {
    let window = window(&app).ok_or_else(|| t("native.quick.notOpen"))?;
    let quick = app.state::<Quick>();
    // Before moving it, so on_moved doesn't keep the default place as the user's
    quick.placed.store(false, Ordering::Relaxed);
    if let Ok(mut saved) = quick.anchor.lock() {
        *saved = None;
    }
    place(&app, &window)?;
    match fs::remove_file(data_dir(&app)?.join(POSITION_FILE)) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(t_with(
            "native.quick.forgetPosition",
            &[("error", &error.to_string())],
        )),
        _ => Ok(()),
    }
}

/// The bar's capture button: it steps aside while the user chooses an area, and comes back with the PNG. Empty
/// when the user cancelled. Without the shown and hidden events, so the bar keeps its conversation as it was.
#[tauri::command]
pub async fn capture_from_quick(app: AppHandle) -> Result<Response, String> {
    let window = window(&app).ok_or_else(|| t("native.quick.notOpen"))?;
    let dir = app.path().app_cache_dir().map_err(to_message)?;
    let quick = app.state::<Quick>();
    quick.capturing.store(true, Ordering::Relaxed);
    let _ = window.hide();
    let handle = app.clone();
    let captured =
        tauri::async_runtime::spawn_blocking(move || screen_capture::capture_area(&handle, &dir))
            .await
            .map_err(to_message)
            .and_then(|result| result);
    let _ = window.show();
    let _ = window.set_focus();
    quick.capturing.store(false, Ordering::Relaxed);
    Ok(Response::new(captured?.unwrap_or_default()))
}

/// Runs `take` with the bar left out of screen captures: the system draws it for the user but not in the picture,
/// so what is under it shows. Not hidden: on macOS, hiding the window that has the focus brings Nyra's main window
/// to the front. Windows leaves it out from Windows 10 2004 on; before, it shows in the picture.
pub fn left_out_of_captures<R>(app: &AppHandle, take: impl FnOnce() -> R) -> R {
    let Some(window) = window(app).filter(|w| w.is_visible().unwrap_or(false)) else {
        return take();
    };
    let _ = window.set_content_protected(true);
    // The system takes a moment to leave the bar out
    std::thread::sleep(std::time::Duration::from_millis(150));
    let result = take();
    let _ = window.set_content_protected(false);
    result
}

/// The bar's pin: while on, clicking another app leaves it where it is
#[tauri::command]
pub fn set_quick_pinned(app: AppHandle, pinned: bool) {
    app.state::<Quick>().pinned.store(pinned, Ordering::Relaxed);
}

#[tauri::command]
pub fn hide_quick(app: AppHandle) -> Result<(), String> {
    hide(&app)
}

/// "Abrir Nyra" and the like: the main window comes forward and the bar steps aside
#[tauri::command]
pub fn open_main_from_quick(app: AppHandle) -> Result<(), String> {
    hide(&app)?;
    crate::tray::show_main(&app);
    Ok(())
}

/// Registers the shortcut the user chose (None turns it off) in place of the previous one. Called by the main window
/// on start and whenever Settings changes it; the result also goes to Settings as an event.
#[tauri::command]
pub fn set_quick_shortcut(
    app: AppHandle,
    shortcut: Option<String>,
) -> Result<ShortcutStatus, String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let quick = app.state::<Quick>();
    let mut status = quick.shortcut.lock().map_err(to_message)?;
    let global = app.global_shortcut();
    if let Some(previous) = status.shortcut.take().filter(|_| status.registered) {
        // Already gone if registering it had failed
        let _ = global.unregister(previous.as_str());
    }
    status.registered = false;
    status.error = None;
    if let Some(wanted) = shortcut.filter(|s| !s.trim().is_empty()) {
        if !status.wayland {
            match global.register(wanted.as_str()) {
                Ok(()) => status.registered = true,
                Err(_) => status.error = Some(t("native.quick.shortcutTaken")),
            }
        }
        status.shortcut = Some(wanted);
    }
    let current = status.clone();
    drop(status);
    crate::tray::show_quick_shortcut(
        &app,
        current.shortcut.as_deref().filter(|_| current.registered),
    );
    let _ = app.emit(SHORTCUT_EVENT, current.clone());
    Ok(current)
}

#[tauri::command]
pub fn quick_shortcut_status(app: AppHandle) -> Result<ShortcutStatus, String> {
    Ok(app
        .state::<Quick>()
        .shortcut
        .lock()
        .map_err(to_message)?
        .clone())
}

#[cfg(test)]
mod size_tests {
    use super::QuickSize;

    #[test]
    fn reads_the_sizes_the_app_sends_and_each_is_bigger() {
        let sizes: Vec<QuickSize> =
            serde_json::from_str(r#"["normal", "large", "extraLarge"]"#).unwrap();
        let dimensions: Vec<(f64, f64)> = sizes.iter().map(|size| size.dimensions()).collect();
        assert_eq!(dimensions[0], (680.0, 520.0));
        assert!(dimensions
            .windows(2)
            .all(|pair| pair[1].0 > pair[0].0 && pair[1].1 > pair[0].1));
    }
}
