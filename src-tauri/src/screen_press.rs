//! A click without the user's mouse: on macOS, what is at a place on the screen is pressed through Accessibility, the
//! way a screen reader does, so the button, link or box itself gets it and the mouse never moves. Where that can't
//! be done (an app that doesn't say what it shows, a text field that needs the keyboard), the caller clicks with the
//! mouse as before.

/// How a press went: done; nothing there takes it, so the mouse clicks instead; or it is one of Nyra's own windows
#[derive(Debug, PartialEq)]
pub enum Pressed {
    Done,
    NotHere,
    Own,
}

/// Presses what is at this place of the screen, in global points from the top-left of the main screen
#[cfg(target_os = "macos")]
pub fn press_at(x: f64, y: f64) -> Pressed {
    mac::press_at(x, y)
}

#[cfg(not(target_os = "macos"))]
pub fn press_at(_x: f64, _y: f64) -> Pressed {
    Pressed::NotHere
}

#[cfg(target_os = "macos")]
mod mac {
    use std::collections::HashSet;
    use std::ptr::{self, NonNull};
    use std::sync::{LazyLock, Mutex};
    use std::thread;
    use std::time::Duration;

    use objc2_application_services::{AXError, AXUIElement};
    use objc2_core_foundation::{kCFBooleanTrue, CFArray, CFRetained, CFString, CFType};

    use super::Pressed;
    use crate::util::lock;

    const PRESS: &str = "AXPress";
    // What was hit is often a label inside the button: a few steps up find it, never past these, where a press would
    // be on the whole window or page
    const UP_LEVELS: usize = 4;
    const BOUNDARIES: [&str; 6] = [
        "AXWindow",
        "AXApplication",
        "AXWebArea",
        "AXScrollArea",
        "AXSplitGroup",
        "AXSheet",
    ];
    // A field needs the keyboard, which only a real click gives it
    const TYPING: [&str; 3] = ["AXTextField", "AXTextArea", "AXComboBox"];
    // An app that doesn't answer is left after this, and the mouse clicks instead
    const TIMEOUT_SECONDS: f32 = 1.0;
    // Chromium browsers and Electron apps describe their pages only once asked to: the first time, a moment to do it
    const BUILD_TREE: Duration = Duration::from_millis(300);

    // Apps already asked to describe their pages
    static DESCRIBED: LazyLock<Mutex<HashSet<i32>>> = LazyLock::new(Mutex::default);

    pub fn press_at(x: f64, y: f64) -> Pressed {
        // SAFETY: the system-wide element is always there; the timeout only bounds the calls that follow
        let system = unsafe { AXUIElement::new_system_wide() };
        unsafe { system.set_messaging_timeout(TIMEOUT_SECONDS) };
        let (found, pid) = find(&system, x, y);
        let found = match (found, pid) {
            (Found::Nothing, Some(pid)) if ask_to_describe(pid) => {
                thread::sleep(BUILD_TREE);
                find(&system, x, y).0
            }
            (found, _) => found,
        };
        match found {
            Found::Pressable(element) => {
                // SAFETY: a live element and an action it said it takes
                let done = unsafe { element.perform_action(&CFString::from_str(PRESS)) };
                if done == AXError::Success {
                    Pressed::Done
                } else {
                    Pressed::NotHere
                }
            }
            Found::Own => Pressed::Own,
            Found::Nothing => Pressed::NotHere,
        }
    }

    enum Found {
        Pressable(CFRetained<AXUIElement>),
        Own,
        Nothing,
    }

    /// What takes the press at that place, and the app it belongs to
    fn find(system: &AXUIElement, x: f64, y: f64) -> (Found, Option<i32>) {
        let Some(hit) = element_at(system, x, y) else {
            return (Found::Nothing, None);
        };
        let pid = pid_of(&hit);
        if pid == Some(std::process::id() as i32) {
            return (Found::Own, pid);
        }
        if role_of(&hit).is_some_and(|role| TYPING.contains(&role.as_str())) {
            return (Found::Nothing, pid);
        }
        let mut current = hit;
        for _ in 0..=UP_LEVELS {
            if role_of(&current).is_some_and(|role| BOUNDARIES.contains(&role.as_str())) {
                break;
            }
            if can_press(&current) {
                return (Found::Pressable(current), pid);
            }
            match parent_of(&current) {
                Some(parent) => current = parent,
                None => break,
            }
        }
        (Found::Nothing, pid)
    }

    /// Once per app: true when it was just asked, so looking again is worth it
    fn ask_to_describe(pid: i32) -> bool {
        if !lock(&DESCRIBED).insert(pid) {
            return false;
        }
        // SAFETY: an app element for a live process; an app that doesn't know the attribute just refuses it
        let app = unsafe { AXUIElement::new_application(pid) };
        if let Some(yes) = unsafe { kCFBooleanTrue } {
            let _ = unsafe {
                app.set_attribute_value(&CFString::from_str("AXManualAccessibility"), yes)
            };
        }
        true
    }

    fn element_at(system: &AXUIElement, x: f64, y: f64) -> Option<CFRetained<AXUIElement>> {
        let mut out: *const AXUIElement = ptr::null();
        // SAFETY: out is written only on success, with an element the caller owns
        let error =
            unsafe { system.copy_element_at_position(x as f32, y as f32, NonNull::from(&mut out)) };
        if error != AXError::Success {
            return None;
        }
        NonNull::new(out.cast_mut()).map(|element| unsafe { CFRetained::from_raw(element) })
    }

    fn attribute(element: &AXUIElement, name: &str) -> Option<CFRetained<CFType>> {
        let mut out: *const CFType = ptr::null();
        // SAFETY: as above, the value is the caller's once written
        let error = unsafe {
            element.copy_attribute_value(&CFString::from_str(name), NonNull::from(&mut out))
        };
        if error != AXError::Success {
            return None;
        }
        NonNull::new(out.cast_mut()).map(|value| unsafe { CFRetained::from_raw(value) })
    }

    fn role_of(element: &AXUIElement) -> Option<String> {
        let role = attribute(element, "AXRole")?;
        role.downcast_ref::<CFString>().map(ToString::to_string)
    }

    fn parent_of(element: &AXUIElement) -> Option<CFRetained<AXUIElement>> {
        let parent = attribute(element, "AXParent")?;
        parent.downcast_ref::<AXUIElement>().map(|p| {
            // SAFETY: a valid element, kept alive by its own retain
            unsafe { CFRetained::retain(NonNull::from(p)) }
        })
    }

    fn pid_of(element: &AXUIElement) -> Option<i32> {
        let mut pid = 0;
        // SAFETY: pid is written on success
        let error = unsafe { element.pid(NonNull::from(&mut pid)) };
        (error == AXError::Success).then_some(pid)
    }

    fn can_press(element: &AXUIElement) -> bool {
        let mut names: *const CFArray = ptr::null();
        // SAFETY: as above
        let error = unsafe { element.copy_action_names(NonNull::from(&mut names)) };
        let Some(names) = (error == AXError::Success)
            .then_some(())
            .and_then(|()| NonNull::new(names.cast_mut()))
            .map(|names| unsafe { CFRetained::from_raw(names) })
        else {
            return false;
        };
        (0..names.count()).any(|i| {
            // SAFETY: an index within the array, whose items are the action names, as strings
            let name = unsafe { names.value_at_index(i) }.cast::<CFString>();
            unsafe { name.as_ref() }.is_some_and(|name| name.to_string() == PRESS)
        })
    }
}
