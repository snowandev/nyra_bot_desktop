//! The system permissions Nyra needs to work fully: the microphone for dictation, the screen for "see the screen" and
//! captures, and Accessibility for using the mouse and keyboard. Only macOS asks for them; elsewhere there is nothing
//! to ask, and each one is None.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Access {
    Granted,
    // Refused, or asked already: only System Settings can grant it now
    Denied,
    NotAsked,
}

#[derive(Serialize)]
pub struct SystemAccess {
    microphone: Option<Access>,
    screen: Option<Access>,
    accessibility: Option<Access>,
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum AccessKind {
    Microphone,
    Screen,
    Accessibility,
}

#[tauri::command]
pub fn system_access() -> SystemAccess {
    SystemAccess {
        microphone: os::microphone(),
        screen: os::screen(),
        accessibility: os::accessibility(),
    }
}

/// The system's own prompt where it still has one; otherwise the answer stays as it was
#[tauri::command]
pub async fn request_system_access(kind: AccessKind) -> Option<Access> {
    match kind {
        AccessKind::Microphone => os::request_microphone().await,
        AccessKind::Screen => os::request_screen(),
        AccessKind::Accessibility => os::request_accessibility(),
    }
}

/// System Settings at the permission's own list, for one refused before
#[tauri::command]
pub fn open_access_settings(kind: AccessKind) -> Result<(), String> {
    os::open_settings(kind)
}

#[cfg(target_os = "macos")]
mod os {
    use std::sync::Mutex;

    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_application_services::AXIsProcessTrusted;
    use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio};
    use objc2_core_graphics::{CGPreflightScreenCaptureAccess, CGRequestScreenCaptureAccess};
    use tokio::sync::oneshot;

    use super::{Access, AccessKind};
    use crate::i18n::t;

    pub fn microphone() -> Option<Access> {
        let audio = unsafe { AVMediaTypeAudio }?;
        // SAFETY: a plain read, of the audio type the system defines
        let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(audio) };
        Some(match status {
            AVAuthorizationStatus::Authorized => Access::Granted,
            AVAuthorizationStatus::NotDetermined => Access::NotAsked,
            _ => Access::Denied,
        })
    }

    pub async fn request_microphone() -> Option<Access> {
        let audio = unsafe { AVMediaTypeAudio }?;
        let (send, answer) = oneshot::channel();
        // The block isn't Send, so it is gone before waiting; the system keeps its own copy
        {
            let send = Mutex::new(Some(send));
            let answered = RcBlock::new(move |granted: Bool| {
                if let Some(send) = crate::util::lock(&send).take() {
                    let _ = send.send(granted.as_bool());
                }
            });
            // SAFETY: the audio type the system defines; the system copies the block and calls it on its own queue
            unsafe {
                AVCaptureDevice::requestAccessForMediaType_completionHandler(audio, &answered)
            };
        }
        let granted = answer.await.unwrap_or(false);
        Some(if granted {
            Access::Granted
        } else {
            Access::Denied
        })
    }

    // The system can't say whether it was refused or never asked
    pub fn screen() -> Option<Access> {
        Some(if CGPreflightScreenCaptureAccess() {
            Access::Granted
        } else {
            Access::NotAsked
        })
    }

    // The first time, the system shows its prompt and sends the user to System Settings; after that it does nothing
    pub fn request_screen() -> Option<Access> {
        Some(if CGRequestScreenCaptureAccess() {
            Access::Granted
        } else {
            Access::Denied
        })
    }

    // Like the screen, the system can't say whether it was refused or never asked
    pub fn accessibility() -> Option<Access> {
        // SAFETY: takes nothing and only reads the app's permission
        Some(if unsafe { AXIsProcessTrusted() } {
            Access::Granted
        } else {
            Access::NotAsked
        })
    }

    // The input library shows the system's prompt, which sends the user to System Settings, when it lacks it
    pub fn request_accessibility() -> Option<Access> {
        let settings = enigo::Settings {
            open_prompt_to_get_permissions: true,
            ..enigo::Settings::default()
        };
        Some(if enigo::Enigo::new(&settings).is_ok() {
            Access::Granted
        } else {
            Access::Denied
        })
    }

    pub fn open_settings(kind: AccessKind) -> Result<(), String> {
        let pane = match kind {
            AccessKind::Microphone => "Privacy_Microphone",
            AccessKind::Screen => "Privacy_ScreenCapture",
            AccessKind::Accessibility => "Privacy_Accessibility",
        };
        std::process::Command::new("/usr/bin/open")
            .arg(format!(
                "x-apple.systempreferences:com.apple.preference.security?{pane}"
            ))
            .status()
            .map_err(|e| e.to_string())?
            .success()
            .then_some(())
            .ok_or_else(|| t("native.access.settingsFailed"))
    }
}

#[cfg(not(target_os = "macos"))]
mod os {
    use super::{Access, AccessKind};

    pub fn microphone() -> Option<Access> {
        None
    }

    pub async fn request_microphone() -> Option<Access> {
        None
    }

    pub fn screen() -> Option<Access> {
        None
    }

    pub fn request_screen() -> Option<Access> {
        None
    }

    pub fn accessibility() -> Option<Access> {
        None
    }

    pub fn request_accessibility() -> Option<Access> {
        None
    }

    pub fn open_settings(_kind: AccessKind) -> Result<(), String> {
        Ok(())
    }
}

/// Whether Nyra may record the screen, asking the system the first time (macOS)
#[cfg(target_os = "macos")]
pub fn screen_granted_or_ask() -> bool {
    os::screen() == Some(Access::Granted) || os::request_screen() == Some(Access::Granted)
}
