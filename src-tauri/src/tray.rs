//! Nyra's icon in the system bar (the notification area on Windows, the menu bar on macOS, the tray on Linux).
//! Closing the window hides it there instead of quitting, so a reply keeps going and its notice still arrives;
//! "Salir" in the icon's menu quits for real. The menu also starts a new conversation, reopens one of the latest and
//! opens the quick bar, showing its shortcut.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, Window, Wry};

use crate::i18n::t;

/// Sent to the window when closing it only hid it, so the frontend can say where Nyra went the first time
const KEPT_EVENT: &str = "nyra://kept-in-tray";
/// Sent to the window to open a new conversation, from the menu
const NEW_EVENT: &str = "nyra://new-conversation";
/// Sent to the window with the id of a recent conversation to open
const OPEN_EVENT: &str = "nyra://open-conversation";
const RECENT_PREFIX: &str = "recent:";
const RECENT_COUNT: usize = 5;
// A menu line, not a paragraph: longer titles end in "…"
const RECENT_TITLE_MAX: usize = 45;

// A conversation as the menu lists it: its id and title
type Recent = (String, String);

struct RecentMenu {
    submenu: Submenu<Wry>,
    listed: Option<Vec<Recent>>,
}

/// Whether closing hides the window: the user's setting, and only while there is an icon to bring it back from
pub struct Tray {
    keep: AtomicBool,
    ready: AtomicBool,
    // "Abrir Nyra", "Nueva conversación", "Chat rápido" and "Salir", kept to write them again when the interface's
    // language changes and to show the quick bar's shortcut when it changes
    items: Mutex<Option<[MenuItem<Wry>; 4]>>,
    // "Recientes", and the conversations it lists (id and title), to rebuild it only when they change; None until it
    // is first filled, or when it must be written again (another language)
    recent: Mutex<Option<RecentMenu>>,
}

impl Default for Tray {
    fn default() -> Self {
        Self {
            keep: AtomicBool::new(true),
            ready: AtomicBool::new(false),
            items: Mutex::new(None),
            recent: Mutex::new(None),
        }
    }
}

const ITEM_KEYS: [&str; 4] = [
    "native.tray.open",
    "native.tray.new",
    "native.tray.quick",
    "native.tray.quit",
];

/// The menu in the interface's current language. Runs off the main thread, so it changes the menu with no lock held:
/// each change waits for the main thread, and a command there (the quick bar's shortcut) may want the same lock.
pub fn retitle(app: &AppHandle) {
    let tray = app.state::<Tray>();
    let items = tray.items.lock().ok().and_then(|items| items.clone());
    for (item, key) in items.iter().flatten().zip(ITEM_KEYS) {
        let _ = item.set_text(t(key));
    }
    let submenu = tray.recent.lock().ok().and_then(|mut recent| {
        recent.as_mut().map(|RecentMenu { submenu, listed }| {
            // Written again, for "none yet" in the new language
            *listed = None;
            submenu.clone()
        })
    });
    if let Some(submenu) = submenu {
        let _ = submenu.set_text(t("native.tray.recent"));
    }
    refresh_recent(app);
}

/// "Recientes" with the latest conversations, after one is saved, renamed or deleted; only rebuilt when they change.
/// Their titles are the user's own, shown in their own menu. Off the main thread it holds the menu while the main
/// thread rebuilds it, so nothing on the main thread may wait for this menu (see i18n::set_language).
pub fn refresh_recent(app: &AppHandle) {
    let Ok(latest) = app.state::<crate::storage::Database>().recent(RECENT_COUNT) else {
        return;
    };
    let tray = app.state::<Tray>();
    let Ok(mut recent) = tray.recent.lock() else {
        return;
    };
    let Some(RecentMenu { submenu, listed }) = recent.as_mut() else {
        return;
    };
    if listed.as_ref() == Some(&latest) {
        return;
    }
    if let Ok(items) = submenu.items() {
        for item in items {
            let _ = submenu.remove(&item);
        }
    }
    if latest.is_empty() {
        if let Ok(none) = MenuItem::new(app, t("native.tray.noRecent"), false, None::<&str>) {
            let _ = submenu.append(&none);
        }
    }
    for (id, title) in &latest {
        let text = menu_text(title);
        if let Ok(item) = MenuItem::with_id(
            app,
            format!("{RECENT_PREFIX}{id}"),
            text,
            true,
            None::<&str>,
        ) {
            let _ = submenu.append(&item);
        }
    }
    *listed = Some(latest);
}

/// A title as a menu line: shortened, and with "&" doubled, since Windows and Linux read a single one as a shortcut
/// letter
fn menu_text(title: &str) -> String {
    let title = title.trim();
    let short: String = if title.chars().count() > RECENT_TITLE_MAX {
        let cut: String = title.chars().take(RECENT_TITLE_MAX - 1).collect();
        format!("{}…", cut.trim_end())
    } else {
        title.to_string()
    };
    short.replace('&', "&&")
}

/// Nyra comes forward with that conversation open
fn open_conversation(app: &AppHandle, id: &str) {
    show_main(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(OPEN_EVENT, id);
    }
}

/// The quick bar's shortcut beside its item, or none when it has none working. The menu only shows it: the shortcut
/// itself works anywhere, registered by quick.rs.
pub fn show_quick_shortcut(app: &AppHandle, shortcut: Option<&str>) {
    let tray = app.state::<Tray>();
    let Ok(items) = tray.items.lock() else {
        return;
    };
    if let Some([_, _, quick, _]) = items.as_ref() {
        // A shortcut the menu can't write is left out rather than shown wrong
        if quick.set_accelerator(shortcut).is_err() {
            let _ = quick.set_accelerator(None::<&str>);
        }
    }
}

/// Nyra comes forward with a new conversation in Chat, wherever it was
fn new_conversation(app: &AppHandle) {
    show_main(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(NEW_EVENT, ());
    }
}

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Nyra's glyph in one ink for the menu bar: macOS paints it to match the bar
#[cfg(target_os = "macos")]
fn bar_icon(_app: &AppHandle) -> Option<Image<'static>> {
    Image::from_bytes(include_bytes!("../icons/tray-macos@2x.png")).ok()
}

/// The taskbar's own theme, apart from the apps' (and from Nyra's, which the user can choose)
#[cfg(windows)]
fn taskbar_is_light() -> bool {
    windows_registry::CURRENT_USER
        .open(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
        .and_then(|key| key.get_u32("SystemUsesLightTheme"))
        .is_ok_and(|value| value != 0)
}

/// Windows paints nothing, so the glyph is white on a dark taskbar and nearly black on a light one
#[cfg(windows)]
fn bar_icon_for(light: bool) -> Option<Image<'static>> {
    let bytes: &'static [u8] = if light {
        include_bytes!("../icons/tray-black.png")
    } else {
        include_bytes!("../icons/tray-white.png")
    };
    Image::from_bytes(bytes).ok()
}

#[cfg(windows)]
static TASKBAR_LIGHT: AtomicBool = AtomicBool::new(false);

#[cfg(windows)]
fn bar_icon(_app: &AppHandle) -> Option<Image<'static>> {
    let light = taskbar_is_light();
    TASKBAR_LIGHT.store(light, Ordering::Relaxed);
    bar_icon_for(light)
}

/// Panels can be light or dark and nothing says which, so Linux shows the app's icon, which reads on both
#[cfg(target_os = "linux")]
fn bar_icon(app: &AppHandle) -> Option<Image<'static>> {
    app.default_window_icon().cloned().map(Image::to_owned)
}

/// Windows: read again when Nyra's window changes theme or gets focus, since the window only hears of a change when
/// the apps' theme changes too; the icon is replaced only if the taskbar's theme did change
#[cfg(windows)]
pub fn follow_taskbar_theme(app: &AppHandle) {
    let light = taskbar_is_light();
    if TASKBAR_LIGHT.swap(light, Ordering::Relaxed) == light {
        return;
    }
    if let (Some(tray), Some(icon)) = (app.tray_by_id("main"), bar_icon_for(light)) {
        let _ = tray.set_icon(Some(icon));
    }
}

/// On Linux it needs libayatana-appindicator; without it there is no icon, and closing quits as usual
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", t(ITEM_KEYS[0]), true, None::<&str>)?;
    let new = MenuItem::with_id(app, "new", t(ITEM_KEYS[1]), true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quick", t(ITEM_KEYS[2]), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", t(ITEM_KEYS[3]), true, None::<&str>)?;
    let recent = Submenu::with_id(app, "recent", t("native.tray.recent"), true)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &new, &recent, &quick, &separator, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Nyra Bot")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "new" => new_conversation(app),
            "quick" => crate::quick::open(app),
            "quit" => app.exit(0),
            id => {
                if let Some(conversation) = id.strip_prefix(RECENT_PREFIX) {
                    open_conversation(app, conversation);
                }
            }
        })
        // Windows: a click opens Nyra and the menu is on the right button. Linux never sends the click; on macOS
        // a click opens the menu, as menu bar icons do there.
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = bar_icon(app) {
        builder = builder.icon(icon);
    }
    #[cfg(target_os = "macos")]
    {
        builder = builder.icon_as_template(true);
    }
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.show_menu_on_left_click(false);
    }
    builder.build(app)?;
    let tray = app.state::<Tray>();
    if let Ok(mut items) = tray.items.lock() {
        *items = Some([open, new, quick, quit]);
    }
    if let Ok(mut listed) = tray.recent.lock() {
        *listed = Some(RecentMenu {
            submenu: recent,
            listed: None,
        });
    }
    refresh_recent(app);
    tray.ready.store(true, Ordering::Relaxed);
    // The shortcut may have been registered before the icon existed
    show_quick_shortcut(app, crate::quick::working_shortcut(app).as_deref());
    Ok(())
}

/// For the window's close button: true when it only hid the window
pub fn hide_on_close(window: &Window) -> bool {
    let tray = window.state::<Tray>();
    if !tray.keep.load(Ordering::Relaxed) || !tray.ready.load(Ordering::Relaxed) {
        return false;
    }
    let _ = window.hide();
    let _ = window.emit(KEPT_EVENT, ());
    true
}

/// Settings → General → Notificaciones; the frontend sends it on start and whenever it changes
#[tauri::command]
pub fn set_keep_in_tray(tray: State<'_, Tray>, keep: bool) {
    tray.keep.store(keep, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_a_title_as_one_menu_line() {
        assert_eq!(menu_text("  Plan de viaje "), "Plan de viaje");
        assert_eq!(menu_text("Recetas & menús"), "Recetas && menús");
        let long = "Una conversación con un título muy largo que no cabe en el menú";
        let shown = menu_text(long);
        assert!(shown.ends_with('…'));
        assert_eq!(shown.chars().count(), RECENT_TITLE_MAX);
    }
}
