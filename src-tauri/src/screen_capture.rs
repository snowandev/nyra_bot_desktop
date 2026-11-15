//! Capturing an area of the screen for the quick chat bar to attach. macOS has its own selection tool; on Windows
//! Nyra freezes the screen under the mouse in a window of its own, where the user drags the area to keep.

use std::io::Cursor;
use std::path::Path;
use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;
use std::time::Duration;

use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ImageEncoder, RgbaImage};
use serde::Deserialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

use crate::i18n::{t, t_with};
use crate::util::to_message;

pub const OVERLAY_LABEL: &str = "capture";
// A selection window that never answers (its page failed to load) mustn't leave the bar hidden for good
const OVERLAY_TIMEOUT: Duration = Duration::from_secs(300);

/// The area the user dragged, in the selection window's own CSS pixels, with that window's size to scale it
#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    view_width: f64,
    view_height: f64,
}

/// While the selection window is open: the frozen screen it shows, and where its answer goes
#[derive(Default)]
pub struct Capture {
    pending: Mutex<Option<Pending>>,
}

struct Pending {
    preview: Vec<u8>,
    done: Sender<Option<Selection>>,
}

/// The PNG of the area the user chose, or None if they cancelled. Blocks until then, so it runs off the main thread.
pub fn capture_area(app: &AppHandle, cache_dir: &Path) -> Result<Option<Vec<u8>>, String> {
    if cfg!(target_os = "macos") && std::env::var_os("NYRA_CAPTURE_OVERLAY").is_none() {
        return system_selection(cache_dir);
    }
    let Some(shot) = grab_screen_under_cursor(app, cache_dir)? else {
        return Ok(None);
    };
    match choose_area(app, &shot)? {
        Some(selection) => crop(&shot, selection).map(Some),
        None => Ok(None),
    }
}

/// Shows the frozen screen in a window that covers it and waits for the area the user drags there
fn choose_area(app: &AppHandle, shot: &Shot) -> Result<Option<Selection>, String> {
    let preview = encode_png(&shot.image, CompressionType::Fast)?;
    let (done, answer) = mpsc::channel();
    let capture = app.state::<Capture>();
    *capture.pending.lock().map_err(to_message)? = Some(Pending { preview, done });
    let window =
        WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App("capture.html".into()))
            .title("Nyra")
            .decorations(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .visible(false)
            .build()
            .and_then(|window| {
                window.set_position(shot.position)?;
                window.set_size(shot.size)?;
                Ok(window)
            });
    if let Err(error) = window {
        on_overlay_closed(app);
        return Err(t_with(
            "native.capture.openFailed",
            &[("error", &error.to_string())],
        ));
    }
    // The sender goes away with the window (closed, or finished): that reads as cancelled
    let selection = answer.recv_timeout(OVERLAY_TIMEOUT).ok().flatten();
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = window.destroy();
    }
    Ok(selection)
}

/// The frozen screen for the selection window, once its page has loaded
#[tauri::command]
pub fn capture_preview(app: AppHandle) -> Result<Response, String> {
    let capture = app.state::<Capture>();
    let pending = capture.pending.lock().map_err(to_message)?;
    let preview = pending
        .as_ref()
        .ok_or_else(|| t("native.capture.noneInProgress"))?;
    Ok(Response::new(preview.preview.clone()))
}

/// The selection window shows itself once the frozen screen is drawn, so it never flashes empty
#[tauri::command]
pub fn show_capture(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(OVERLAY_LABEL)
        .ok_or_else(|| t("native.capture.closed"))?;
    window.show().map_err(to_message)?;
    window.set_focus().map_err(to_message)
}

/// The area the user chose, or None when they cancelled
#[tauri::command]
pub fn finish_capture(app: AppHandle, selection: Option<Selection>) -> Result<(), String> {
    if let Some(pending) = app
        .state::<Capture>()
        .pending
        .lock()
        .map_err(to_message)?
        .take()
    {
        let _ = pending.done.send(selection);
    }
    Ok(())
}

/// Closed some other way (Alt+F4): the wait ends as cancelled
pub fn on_overlay_closed(app: &AppHandle) {
    if let Ok(mut pending) = app.state::<Capture>().pending.lock() {
        pending.take();
    }
}

fn crop(shot: &Shot, selection: Selection) -> Result<Vec<u8>, String> {
    let (width, height) = shot.image.dimensions();
    // The window may not be exactly the screen's size (scaling, a system bar), so each axis scales on its own
    let scale_x = f64::from(width) / selection.view_width.max(1.0);
    let scale_y = f64::from(height) / selection.view_height.max(1.0);
    let left = ((selection.x * scale_x).round().max(0.0) as u32).min(width.saturating_sub(1));
    let top = ((selection.y * scale_y).round().max(0.0) as u32).min(height.saturating_sub(1));
    let right = ((selection.x + selection.width) * scale_x).round().max(0.0) as u32;
    let bottom = ((selection.y + selection.height) * scale_y)
        .round()
        .max(0.0) as u32;
    let area = image::imageops::crop_imm(
        &shot.image,
        left,
        top,
        right.min(width).saturating_sub(left).max(1),
        bottom.min(height).saturating_sub(top).max(1),
    )
    .to_image();
    encode_png(&area, CompressionType::Default)
}

pub(crate) fn encode_png(
    image: &RgbaImage,
    compression: CompressionType,
) -> Result<Vec<u8>, String> {
    let mut bytes = Cursor::new(Vec::new());
    PngEncoder::new_with_quality(&mut bytes, compression, FilterType::Adaptive)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| t_with("native.capture.prepareFailed", &[("error", &e.to_string())]))?;
    Ok(bytes.into_inner())
}

/// The screen where the mouse is, and where it sits among the screens, in the system's real pixels, with that
/// screen's own scale (2 on most Retina screens)
pub(crate) struct Shot {
    pub(crate) image: RgbaImage,
    pub(crate) position: PhysicalPosition<i32>,
    pub(crate) size: PhysicalSize<u32>,
    pub(crate) scale: f64,
}

pub(crate) fn grab_screen_under_cursor(
    app: &AppHandle,
    cache_dir: &Path,
) -> Result<Option<Shot>, String> {
    let cursor = app.cursor_position().map_err(to_message)?;
    let monitor = app
        .monitor_from_point(cursor.x, cursor.y)
        .map_err(to_message)?
        .or(app.primary_monitor().map_err(to_message)?)
        .ok_or_else(|| t("native.capture.noScreen"))?;
    let (position, size, scale) = (*monitor.position(), *monitor.size(), monitor.scale_factor());
    let image = grab(&monitor, cache_dir)?;
    Ok(image.map(|image| Shot {
        image,
        position,
        size,
        scale,
    }))
}

#[cfg(windows)]
fn grab(monitor: &tauri::Monitor, _cache_dir: &Path) -> Result<Option<RgbaImage>, String> {
    let position = monitor.position();
    let screen = xcap::Monitor::from_point(position.x, position.y).map_err(|e| {
        t_with(
            "native.capture.screenNotFound",
            &[("error", &e.to_string())],
        )
    })?;
    let image = screen
        .capture_image()
        .map_err(|e| t_with("native.capture.captureFailed", &[("error", &e.to_string())]))?;
    Ok(Some(image))
}

/// Straight from ScreenCaptureKit where it can (macOS 14 on), else with the system's screencapture tool. Also for
/// trying the selection window on a Mac while developing (NYRA_CAPTURE_OVERLAY=1).
#[cfg(target_os = "macos")]
fn grab(monitor: &tauri::Monitor, cache_dir: &Path) -> Result<Option<RgbaImage>, String> {
    ensure_permission()?;
    let scale = monitor.scale_factor();
    // Screens are laid out in points; the picture is of the screen's real pixels
    let origin = (
        f64::from(monitor.position().x) / scale,
        f64::from(monitor.position().y) / scale,
    );
    let (width, height) = (
        monitor.size().width as usize,
        monitor.size().height as usize,
    );
    if let Ok(image) = crate::screen_kit::capture(origin, width, height) {
        return Ok(Some(image));
    }
    let area = format!(
        "-R{},{},{},{}",
        f64::from(monitor.position().x) / scale,
        f64::from(monitor.position().y) / scale,
        f64::from(monitor.size().width) / scale,
        f64::from(monitor.size().height) / scale,
    );
    let Some(png) = run_screencapture(&["-x", &area], cache_dir)? else {
        return Ok(None);
    };
    image::load_from_memory_with_format(&png, image::ImageFormat::Png)
        .map(|image| Some(image.to_rgba8()))
        .map_err(|e| t_with("native.capture.readFailed", &[("error", &e.to_string())]))
}

#[cfg(not(any(windows, target_os = "macos")))]
fn grab(_monitor: &tauri::Monitor, _cache_dir: &Path) -> Result<Option<RgbaImage>, String> {
    Err(t("native.capture.unavailable"))
}

/// macOS's own selection: an area, or a window with Space; Esc cancels
#[cfg(target_os = "macos")]
fn system_selection(cache_dir: &Path) -> Result<Option<Vec<u8>>, String> {
    run_screencapture(&["-i", "-x"], cache_dir)
}

#[cfg(not(target_os = "macos"))]
fn system_selection(_cache_dir: &Path) -> Result<Option<Vec<u8>>, String> {
    Err(t("native.capture.unavailable"))
}

/// The PNG screencapture wrote, or None if the user cancelled
#[cfg(target_os = "macos")]
fn run_screencapture(args: &[&str], cache_dir: &Path) -> Result<Option<Vec<u8>>, String> {
    use std::fs;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    ensure_permission()?;
    fs::create_dir_all(cache_dir).map_err(to_message)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let path = cache_dir.join(format!("capture-{stamp}.png"));
    let status = Command::new("/usr/sbin/screencapture")
        .args(args)
        .args(["-t", "png"])
        .arg(&path)
        .status()
        .map_err(|e| t_with("native.capture.toolFailed", &[("error", &e.to_string())]))?;
    // Cancelled with Esc: no file, and a failed status on some versions
    if !path.exists() {
        return if status.success() || status.code() == Some(1) {
            Ok(None)
        } else {
            Err(t("native.capture.didNotFinish"))
        };
    }
    let bytes = fs::read(&path)
        .map_err(|e| t_with("native.capture.readFailed", &[("error", &e.to_string())]));
    let _ = fs::remove_file(&path);
    bytes.map(Some)
}

/// Without Screen Recording, the capture would show only the desktop and Nyra's own windows. Asking opens the
/// system's prompt the first time; after that, only System Settings can grant it.
#[cfg(target_os = "macos")]
fn ensure_permission() -> Result<(), String> {
    if crate::system_access::screen_granted_or_ask() {
        return Ok(());
    }
    Err(t("native.capture.permission"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shot(width: u32, height: u32) -> Shot {
        Shot {
            image: RgbaImage::new(width, height),
            position: PhysicalPosition::new(0, 0),
            size: PhysicalSize::new(width, height),
            scale: 1.0,
        }
    }

    fn selection(x: f64, y: f64, width: f64, height: f64) -> Selection {
        Selection {
            x,
            y,
            width,
            height,
            view_width: 1000.0,
            view_height: 500.0,
        }
    }

    fn size_of(png: &[u8]) -> (u32, u32) {
        let image = image::load_from_memory(png).unwrap();
        (image.width(), image.height())
    }

    #[test]
    fn a_scaled_screen_crops_in_its_real_pixels() {
        // A screen at 200 %: the window measures 1000 × 500 CSS pixels over 2000 × 1000 real ones
        let png = crop(&shot(2000, 1000), selection(100.0, 50.0, 300.0, 200.0)).unwrap();
        assert_eq!(size_of(&png), (600, 400));
    }

    #[test]
    fn an_area_past_the_edge_stays_inside_the_screen() {
        let png = crop(&shot(1000, 500), selection(900.0, 400.0, 400.0, 400.0)).unwrap();
        assert_eq!(size_of(&png), (100, 100));
    }

    #[test]
    fn an_empty_area_still_gives_an_image() {
        let png = crop(&shot(1000, 500), selection(10.0, 10.0, 0.0, 0.0)).unwrap();
        assert_eq!(size_of(&png), (1, 1));
    }
}
