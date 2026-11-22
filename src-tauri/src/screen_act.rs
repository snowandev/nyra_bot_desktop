//! Nyra using the mouse and keyboard on the user's screen, for a task they allowed. Only its own pointer, drawn over
//! the marks window, moves across the screen: the user's mouse stays where they left it, and only goes to the place
//! for the instant of the click, and back, so they can keep using it. Only "Stop" ends what Nyra is doing.

use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, LogicalPosition, Manager};

use crate::screen_capture::Shot;
use crate::screen_look::{
    frame_of, marked_shot, shot_of, show_pointer, Area, Pointer, ScreenLooks, MARKS_LABEL,
};
use crate::screen_press::Pressed;
use crate::util::to_message;

// Nyra's pointer glides like a hand: a short way quickly, a long one slower, so the user sees it before it clicks
const GLIDE_MIN_MS: f64 = 300.0;
const GLIDE_MAX_MS: f64 = 750.0;
const GLIDE_MS_PER_POINT: f64 = 0.3;
// A field just clicked takes a moment to take the keyboard before Nyra types in it
const FOCUS: Duration = Duration::from_millis(120);
// After the glide, a moment for the window to draw it there
const GLIDE_MARGIN: Duration = Duration::from_millis(80);
// At the end of a task the pointer says where the answer is this long, and its goodbye lasts this long (marks.css)
const FAREWELL: Duration = Duration::from_millis(2600);
const LEAVING: Duration = Duration::from_millis(450);
// The mouse placed, the system needs a moment before a click lands where it now is, and the click a moment to be
// taken before the mouse goes back: together, a blink of the user's pointer
const SETTLE: Duration = Duration::from_millis(30);
const RELEASE: Duration = Duration::from_millis(40);
// The longest text typed in one request, and the most lines scrolled at once
const MAX_TEXT: usize = 2000;
const MAX_LINES: i32 = 30;

#[derive(Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Press {
    Left,
    Right,
    Double,
}

/// What Nyra does: places in fractions of the screen it last looked at; note is what its pointer says
#[derive(Deserialize, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Action {
    Click {
        at: Area,
        press: Press,
        note: String,
    },
    Scroll {
        at: Area,
        lines: i32,
        horizontal: bool,
        note: String,
    },
    // at: the field to click first, if any; enter: pressed after the text
    Type {
        #[serde(default)]
        at: Option<Area>,
        text: String,
        #[serde(default)]
        enter: bool,
        note: String,
    },
    Key {
        keys: String,
        note: String,
    },
}

/// How it went: done; stopped by the user while Nyra's pointer was on its way; the place is one of Nyra's own
/// windows, where it never clicks; or the keyboard is in one of them, where it never types
#[derive(Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Acted {
    Done,
    Stopped,
    OwnWindow,
    OwnKeyboard,
}

#[tauri::command]
pub async fn screen_act(
    app: AppHandle,
    conversation_id: String,
    action: Action,
) -> Result<Acted, String> {
    crate::workspace::blocking(move || act(&app, &conversation_id, action)).await?
}

/// Between two actions, while the model works out the next one: the pointer stays where it is and says so
#[tauri::command]
pub fn screen_act_thinking(
    app: AppHandle,
    conversation_id: String,
    label: String,
) -> Result<(), String> {
    say(&app, &conversation_id, label, true)
}

/// The task ended, or the user stopped it: a click Nyra's pointer was on its way to doesn't happen, and the pointer
/// goes with a short goodbye rather than all at once. farewell: what it says first, for a moment, when the task ended
/// by itself (where to find the answer).
#[tauri::command]
pub fn screen_act_end(
    app: AppHandle,
    conversation_id: String,
    farewell: Option<String>,
) -> Result<(), String> {
    let Some(shown) = app.state::<ScreenLooks>().pointer_now() else {
        return Ok(());
    };
    let staying = match farewell {
        Some(label) => {
            let saying = Pointer {
                label,
                glide_ms: 0,
                start: None,
                thinking: false,
                ..shown
            };
            show_pointer(&app, &conversation_id, Some(saying.clone()))?;
            Some(saying)
        }
        None => {
            leave(&app, &conversation_id, shown)?;
            None
        }
    };
    thread::spawn(move || {
        let now = || app.state::<ScreenLooks>().pointer_now();
        if let Some(staying) = staying {
            thread::sleep(FAREWELL);
            // A new task took the pointer meanwhile: it stays for that one
            if now().as_ref() != Some(&staying) {
                return;
            }
            if leave(&app, &conversation_id, staying).is_err() {
                return;
            }
        }
        thread::sleep(LEAVING);
        if now().is_some_and(|pointer| pointer.leaving) {
            let _ = show_pointer(&app, &conversation_id, None);
        }
    });
    Ok(())
}

/// The window plays the pointer's goodbye; it is taken away once that is over
fn leave(app: &AppHandle, conversation: &str, pointer: Pointer) -> Result<(), String> {
    let leaving = Pointer {
        glide_ms: 0,
        start: None,
        leaving: true,
        ..pointer
    };
    show_pointer(app, conversation, Some(leaving)).map(|_| ())
}

// Linux: Nyra can't see the screen there yet (screen_look_available), so it never acts on it either
#[cfg(not(any(target_os = "macos", windows)))]
mod input {
    use super::Press;

    pub struct Key;
    pub struct Input;

    impl Input {
        pub fn new() -> Result<Self, String> {
            Err(crate::i18n::t("native.capture.unavailable"))
        }
        pub fn location(&self) -> Result<(i32, i32), String> {
            Ok((0, 0))
        }
        pub fn move_back(
            &mut self,
            _window: &tauri::WebviewWindow,
            _at: (i32, i32),
        ) -> Result<(), String> {
            Ok(())
        }
        pub fn click(&mut self, _press: Press) -> Result<(), String> {
            Ok(())
        }
        pub fn scroll(&mut self, _lines: i32, _horizontal: bool) -> Result<(), String> {
            Ok(())
        }
        pub fn text(&mut self, _text: &str) -> Result<(), String> {
            Ok(())
        }
        pub fn enter(&mut self) -> Result<(), String> {
            Ok(())
        }
        pub fn keys(&mut self, _held: &[Key], _key: Key) -> Result<(), String> {
            Ok(())
        }
    }

    pub fn keys_of(_text: &str) -> Result<(Vec<Key>, Key), String> {
        Ok((Vec::new(), Key))
    }
}

/// Runs on the app's main thread, where macOS wants the keyboard read (a key's character depends on the layout, which
/// may only be asked there: elsewhere the system closes the app). The waits stay off it, so the window never freezes.
fn with_input<R: Send + 'static>(
    app: &AppHandle,
    run: impl FnOnce(&mut input::Input) -> Result<R, String> + Send + 'static,
) -> Result<R, String> {
    let (send, receive) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = send.send(input::Input::new().and_then(|mut input| run(&mut input)));
    })
    .map_err(to_message)?;
    receive.recv().map_err(to_message)?
}

fn act(app: &AppHandle, conversation: &str, action: Action) -> Result<Acted, String> {
    // Without the permission, nothing moves: the failure says where to give it
    with_input(app, |_| Ok(()))?;
    match action {
        Action::Click { at, press, note } => {
            // A plain click presses the thing itself where the system lets it, without the user's mouse
            let pressable = press == Press::Left;
            let acted = at_place(app, conversation, at, note, pressable, move |input| {
                input.click(press)
            })?;
            if acted != Acted::Done {
                return Ok(acted);
            }
        }
        Action::Scroll {
            at,
            lines,
            horizontal,
            note,
        } => {
            let lines = lines.clamp(-MAX_LINES, MAX_LINES);
            let acted = at_place(app, conversation, at, note, false, move |input| {
                input.scroll(lines, horizontal)
            })?;
            if acted != Acted::Done {
                return Ok(acted);
            }
        }
        Action::Type {
            at,
            text,
            enter,
            note,
        } => {
            let text: String = text.chars().take(MAX_TEXT).collect();
            let type_it = move |input: &mut input::Input| -> Result<(), String> {
                input.text(&text)?;
                if enter {
                    input.enter()?;
                }
                Ok(())
            };
            match at {
                // Clicked, the field takes the keyboard, and the text goes in: one step for Nyra
                Some(at) => {
                    let acted = at_place(app, conversation, at, note, false, |input| {
                        input.click(Press::Left)
                    })?;
                    if acted != Acted::Done {
                        return Ok(acted);
                    }
                    thread::sleep(FOCUS);
                    with_input(app, type_it)?;
                }
                None => {
                    if own_keyboard(app) {
                        return Ok(Acted::OwnKeyboard);
                    }
                    relabel(app, conversation, note)?;
                    with_input(app, type_it)?;
                }
            }
        }
        Action::Key { keys, note } => {
            let (held, key) = input::keys_of(&keys)?;
            if own_keyboard(app) {
                return Ok(Acted::OwnKeyboard);
            }
            relabel(app, conversation, note)?;
            with_input(app, move |input| input.keys(&held, key))?;
        }
    }
    Ok(Acted::Done)
}

/// Nyra's pointer glides to the place's center; then the user's mouse goes there for the click and comes back to where
/// they have it then, even if they moved it meanwhile. Nothing is done if the user stopped Nyra on the way, or the
/// place is one of Nyra's own windows.
fn at_place(
    app: &AppHandle,
    conversation: &str,
    at: Area,
    label: String,
    pressable: bool,
    act: impl FnOnce(&mut input::Input) -> Result<(), String> + Send + 'static,
) -> Result<Acted, String> {
    let (x, y) = (at.x + at.width / 2.0, at.y + at.height / 2.0);
    let looks = app.state::<ScreenLooks>();
    let shot = shot_of(&looks, conversation)?;
    let previous = looks.pointer_now();
    // The first time it comes out of the user's own mouse, as a second one
    let start = match previous {
        None => Some(fraction_of(
            with_input(app, |input| input.location())?,
            &shot,
        )),
        Some(_) => None,
    };
    let from = previous
        .as_ref()
        .map(|p| (p.x, p.y))
        .or(start)
        .unwrap_or((x, y));
    let glide = glide_for(from, (x, y), &shot);
    let clicks = previous.map_or(0, |p| p.clicks);
    let pointer = Pointer {
        x,
        y,
        label,
        glide_ms: glide.as_millis() as u64,
        start,
        clicks,
        thinking: false,
        leaving: false,
    };
    let window = show_pointer(app, conversation, Some(pointer.clone()))?
        .ok_or_else(|| "The marks window isn't there".to_string())?;
    thread::sleep(glide + GLIDE_MARGIN);
    // "Stop" took the pointer away while it was on its way, or it is leaving
    if looks.pointer_now().is_none_or(|pointer| pointer.leaving) {
        return Ok(Acted::Stopped);
    }
    let press = |clicks| {
        let pressed = Pointer {
            glide_ms: 0,
            start: None,
            clicks,
            ..pointer.clone()
        };
        show_pointer(app, conversation, Some(pressed)).map(|_| ())
    };
    if pressable {
        let (px, py) = screen_point((x, y), &shot);
        match crate::screen_press::press_at(px, py) {
            Pressed::Done => {
                press(clicks + 1)?;
                return Ok(Acted::Done);
            }
            Pressed::Own => return Ok(Acted::OwnWindow),
            Pressed::NotHere => {}
        }
    }
    // Where the user's mouse is now, which they may have kept using: it comes back here
    let users = with_input(app, |input| input.location())?;
    let shot = marked_shot(app).ok_or_else(|| "Nothing was looked at".to_string())?;
    let frame =
        frame_of(&window, &shot).ok_or_else(|| "The marks window has no place".to_string())?;
    // Through the marks window, which covers that screen: placed in its own points, right on any screen and scale
    window
        .set_cursor_position(LogicalPosition::new(
            frame.left + x * frame.width,
            frame.top + y * frame.height,
        ))
        .map_err(to_message)?;
    thread::sleep(SETTLE);
    let allowed = !over_own_window(app, screen_point((x, y), &shot));
    if allowed {
        press(clicks + 1)?;
    }
    let done = if allowed {
        with_input(app, act)
    } else {
        Ok(())
    };
    thread::sleep(RELEASE);
    let back = window.clone();
    with_input(app, move |input| input.move_back(&back, users))?;
    done.map(|()| {
        if allowed {
            Acted::Done
        } else {
            Acted::OwnWindow
        }
    })
}

/// What the pointer says changes where it is, for typing and keys
fn relabel(app: &AppHandle, conversation: &str, label: String) -> Result<(), String> {
    say(app, conversation, label, false)
}

fn say(app: &AppHandle, conversation: &str, label: String, thinking: bool) -> Result<(), String> {
    if let Some(shown) = app.state::<ScreenLooks>().pointer_now() {
        let pointer = Pointer {
            label,
            glide_ms: 0,
            start: None,
            thinking,
            ..shown
        };
        show_pointer(app, conversation, Some(pointer))?;
    }
    Ok(())
}

/// The user's mouse as a place on the screen: its location is in points on macOS, in real pixels on Windows
fn fraction_of((x, y): (i32, i32), shot: &Shot) -> (f64, f64) {
    let scale = if cfg!(target_os = "macos") {
        shot.scale
    } else {
        1.0
    };
    let left = f64::from(shot.position.x) / scale;
    let top = f64::from(shot.position.y) / scale;
    let width = f64::from(shot.size.width) / scale;
    let height = f64::from(shot.size.height) / scale;
    (
        ((f64::from(x) - left) / width).clamp(0.0, 1.0),
        ((f64::from(y) - top) / height).clamp(0.0, 1.0),
    )
}

/// A place on the screen in global points, as macOS's Accessibility takes it
fn screen_point((x, y): (f64, f64), shot: &Shot) -> (f64, f64) {
    let scale = shot.scale;
    (
        (f64::from(shot.position.x) + x * f64::from(shot.size.width)) / scale,
        (f64::from(shot.position.y) + y * f64::from(shot.size.height)) / scale,
    )
}

/// How long the glide takes, by how far it goes in the screen's points
fn glide_for(from: (f64, f64), to: (f64, f64), shot: &Shot) -> Duration {
    let width = f64::from(shot.size.width) / shot.scale;
    let height = f64::from(shot.size.height) / shot.scale;
    let distance = ((to.0 - from.0) * width).hypot((to.1 - from.1) * height);
    let ms = (GLIDE_MIN_MS + distance * GLIDE_MS_PER_POINT).min(GLIDE_MAX_MS);
    Duration::from_millis(ms as u64)
}

/// Nyra's own windows, where it never clicks or types: all but the one it draws its marks and pointer in, which only
/// shows over the user's screen
fn own_windows(app: &AppHandle) -> impl Iterator<Item = tauri::WebviewWindow> {
    app.webview_windows()
        .into_values()
        .filter(|window| window.label() != MARKS_LABEL)
}

/// Whether one of Nyra's windows has the keyboard: it does right after the user wrote to Nyra, and typing or a
/// shortcut there would go into Nyra itself (its message box, or Cmd+Q on it)
fn own_keyboard(app: &AppHandle) -> bool {
    own_windows(app).any(|window| window.is_focused().unwrap_or(false))
}

/// Whether the click would land on Nyra: asked to the system, so a window of Nyra behind the user's app doesn't
/// count. Where it can't tell, any of Nyra's windows under the pointer does.
fn over_own_window(app: &AppHandle, at: (f64, f64)) -> bool {
    in_front_is_own(app, at).unwrap_or_else(|| inside_own_window(app))
}

#[cfg(target_os = "macos")]
fn in_front_is_own(_app: &AppHandle, (x, y): (f64, f64)) -> Option<bool> {
    crate::screen_press::owner_at(x, y).map(|pid| pid == std::process::id() as i32)
}

/// At the pointer, which is already where the click goes
#[cfg(windows)]
fn in_front_is_own(app: &AppHandle, _at: (f64, f64)) -> Option<bool> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetAncestor, GetCursorPos, GetWindowThreadProcessId, WindowFromPoint, GA_ROOT,
    };
    let mut point = POINT { x: 0, y: 0 };
    // SAFETY: reads of the system's windows; point and pid are written by the calls
    unsafe {
        if GetCursorPos(&mut point) == 0 {
            return None;
        }
        let root = GetAncestor(WindowFromPoint(point), GA_ROOT);
        if root.is_null() {
            return None;
        }
        // The marks window lets the mouse through; if the system still names it, it can't tell what is under
        let marks = app
            .get_webview_window(MARKS_LABEL)
            .and_then(|w| w.hwnd().ok());
        if marks.is_some_and(|marks| marks.0 as usize == root as usize) {
            return None;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(root, &mut pid);
        Some(pid == std::process::id())
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
fn in_front_is_own(_app: &AppHandle, _at: (f64, f64)) -> Option<bool> {
    None
}

fn inside_own_window(app: &AppHandle) -> bool {
    let Ok(cursor) = app.cursor_position() else {
        return false;
    };
    own_windows(app).any(|window| {
        if !window.is_visible().unwrap_or(false) {
            return false;
        }
        let (Ok(at), Ok(size)) = (window.outer_position(), window.outer_size()) else {
            return false;
        };
        cursor.x >= f64::from(at.x)
            && cursor.y >= f64::from(at.y)
            && cursor.x < f64::from(at.x) + f64::from(size.width)
            && cursor.y < f64::from(at.y) + f64::from(size.height)
    })
}

#[cfg(any(target_os = "macos", windows))]
mod input {
    use enigo::{Axis, Button, Direction, Enigo, Key, Keyboard, Mouse, Settings};

    use super::Press;
    use crate::i18n::t;
    use crate::util::to_message;

    pub struct Input(Enigo);

    impl Input {
        /// Where the user's mouse is: in points on macOS, in real pixels on Windows
        pub fn location(&self) -> Result<(i32, i32), String> {
            self.0.location().map_err(to_message)
        }

        /// The user's mouse back where it was. On Windows through the marks window: the library only places it right
        /// on the main screen.
        #[cfg(target_os = "macos")]
        pub fn move_back(
            &mut self,
            _window: &tauri::WebviewWindow,
            (x, y): (i32, i32),
        ) -> Result<(), String> {
            self.0
                .move_mouse(x, y, enigo::Coordinate::Abs)
                .map_err(to_message)
        }

        #[cfg(windows)]
        pub fn move_back(
            &mut self,
            window: &tauri::WebviewWindow,
            (x, y): (i32, i32),
        ) -> Result<(), String> {
            let inner = window.inner_position().map_err(to_message)?;
            window
                .set_cursor_position(tauri::PhysicalPosition::new(x - inner.x, y - inner.y))
                .map_err(to_message)
        }

        pub fn new() -> Result<Self, String> {
            let settings = Settings {
                // The welcome and the failure ask for it; a prompt here would come in the middle of a task
                open_prompt_to_get_permissions: false,
                ..Settings::default()
            };
            Enigo::new(&settings)
                .map(Input)
                .map_err(|_| t("native.screen.noAccessibility"))
        }

        pub fn click(&mut self, press: Press) -> Result<(), String> {
            let button = if press == Press::Right {
                Button::Right
            } else {
                Button::Left
            };
            let times = if press == Press::Double { 2 } else { 1 };
            for _ in 0..times {
                self.0
                    .button(button, Direction::Click)
                    .map_err(to_message)?;
            }
            Ok(())
        }

        pub fn scroll(&mut self, lines: i32, horizontal: bool) -> Result<(), String> {
            let axis = if horizontal {
                Axis::Horizontal
            } else {
                Axis::Vertical
            };
            self.0.scroll(lines, axis).map_err(to_message)
        }

        pub fn text(&mut self, text: &str) -> Result<(), String> {
            self.0.text(text).map_err(to_message)
        }

        pub fn enter(&mut self) -> Result<(), String> {
            self.0
                .key(Key::Return, Direction::Click)
                .map_err(to_message)
        }

        pub fn keys(&mut self, held: &[Key], key: Key) -> Result<(), String> {
            let mut down = 0;
            let mut pressed = Ok(());
            for modifier in held {
                pressed = self.0.key(*modifier, Direction::Press).map_err(to_message);
                if pressed.is_err() {
                    break;
                }
                down += 1;
            }
            if pressed.is_ok() {
                pressed = self.0.key(key, Direction::Click).map_err(to_message);
            }
            // Whatever failed, the modifiers already down are released, so none stays held on the user's computer
            for modifier in held[..down].iter().rev() {
                let _ = self.0.key(*modifier, Direction::Release);
            }
            pressed
        }
    }

    /// "cmd+shift+t", "enter": the modifiers held and the key pressed. Key names, not words of a language.
    pub fn keys_of(text: &str) -> Result<(Vec<Key>, Key), String> {
        let names: Vec<String> = text
            .split('+')
            .map(|name| name.trim().to_lowercase())
            .collect();
        let (last, modifiers) = names
            .split_last()
            .filter(|(last, _)| !last.is_empty())
            .ok_or_else(|| format!("No key in \"{text}\""))?;
        let held = modifiers
            .iter()
            .map(|name| modifier_of(name).ok_or_else(|| format!("\"{name}\" isn't a modifier key")))
            .collect::<Result<Vec<_>, _>>()?;
        let key = modifier_of(last)
            .or_else(|| key_of(last))
            .ok_or_else(|| format!("\"{last}\" isn't a key"))?;
        Ok((held, key))
    }

    fn modifier_of(name: &str) -> Option<Key> {
        Some(match name {
            "cmd" | "command" | "meta" | "win" | "super" => Key::Meta,
            "ctrl" | "control" => Key::Control,
            "alt" | "option" | "opt" => Key::Alt,
            "shift" => Key::Shift,
            _ => return None,
        })
    }

    fn key_of(name: &str) -> Option<Key> {
        let mut chars = name.chars();
        if let (Some(c), None) = (chars.next(), chars.next()) {
            return Some(Key::Unicode(c));
        }
        Some(match name {
            "enter" | "return" => Key::Return,
            "tab" => Key::Tab,
            "escape" | "esc" => Key::Escape,
            "backspace" => Key::Backspace,
            "delete" | "del" => Key::Delete,
            "space" => Key::Space,
            "up" | "arrowup" => Key::UpArrow,
            "down" | "arrowdown" => Key::DownArrow,
            "left" | "arrowleft" => Key::LeftArrow,
            "right" | "arrowright" => Key::RightArrow,
            "home" => Key::Home,
            "end" => Key::End,
            "pageup" => Key::PageUp,
            "pagedown" => Key::PageDown,
            "f1" => Key::F1,
            "f2" => Key::F2,
            "f3" => Key::F3,
            "f4" => Key::F4,
            "f5" => Key::F5,
            "f6" => Key::F6,
            "f7" => Key::F7,
            "f8" => Key::F8,
            "f9" => Key::F9,
            "f10" => Key::F10,
            "f11" => Key::F11,
            "f12" => Key::F12,
            _ => return None,
        })
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn reads_keys_with_their_modifiers() {
            assert_eq!(
                keys_of("Cmd+Shift+T").unwrap(),
                (vec![Key::Meta, Key::Shift], Key::Unicode('t'))
            );
            assert_eq!(keys_of("enter").unwrap(), (vec![], Key::Return));
            assert_eq!(
                keys_of(" ctrl + f4 ").unwrap(),
                (vec![Key::Control], Key::F4)
            );
            assert_eq!(keys_of("shift").unwrap(), (vec![], Key::Shift));
        }

        #[test]
        fn refuses_what_isnt_a_key() {
            assert!(keys_of("").is_err());
            assert!(keys_of("cmd+").is_err());
            assert!(keys_of("save+s").is_err());
            assert!(keys_of("ctrl+banana").is_err());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::RgbaImage;
    use tauri::{PhysicalPosition, PhysicalSize};

    fn shot(scale: f64) -> Shot {
        Shot {
            image: RgbaImage::new(1, 1),
            position: PhysicalPosition::new(0, 0),
            size: PhysicalSize::new(2000, 1000),
            scale,
        }
    }

    #[test]
    fn a_longer_way_takes_longer_but_never_too_long() {
        let screen = shot(1.0);
        let short = glide_for((0.5, 0.5), (0.52, 0.5), &screen);
        let long = glide_for((0.0, 0.0), (0.9, 0.9), &screen);
        let ms = |glide: Duration| glide.as_millis() as f64;
        assert_eq!(ms(glide_for((0.3, 0.3), (0.3, 0.3), &screen)), GLIDE_MIN_MS);
        assert_eq!(ms(long), GLIDE_MAX_MS);
        assert!(GLIDE_MIN_MS < ms(short) && ms(short) < GLIDE_MAX_MS);
        assert!(short < long);
    }

    #[test]
    fn a_place_is_in_the_screens_points() {
        let screen = Shot {
            image: RgbaImage::new(1, 1),
            position: PhysicalPosition::new(3000, 0),
            size: PhysicalSize::new(2000, 1000),
            scale: 2.0,
        };
        assert_eq!(screen_point((0.5, 0.5), &screen), (2000.0, 250.0));
    }

    #[test]
    fn the_users_mouse_is_a_place_on_the_screen() {
        let (x, y) = fraction_of((500, 250), &shot(1.0));
        assert!((x - 0.25).abs() < 1e-9 && (y - 0.25).abs() < 1e-9);
        // Off the screen, it comes out from its edge
        assert_eq!(fraction_of((-100, 5000), &shot(1.0)), (0.0, 1.0));
    }
}
