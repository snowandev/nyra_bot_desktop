//! Nyra looking at the user's screen and pointing things out on it: a capture of the screen where the mouse is, kept
//! whole to zoom into, and a transparent window over that screen where the marks are drawn. Clicks go through the
//! window, except on the notes, which close their mark.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine;
use image::imageops::{self, FilterType};
use image::{GrayImage, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::i18n::{t, t_with};
use crate::screen_capture::{grab_screen_under_cursor, Shot};
use crate::util::to_message;

pub const MARKS_LABEL: &str = "marks";
const MARKS_EVENT: &str = "screen-marks";
// What the model gets of a screen: enough to read a settings window, measured on a 6K screen
const VIEW_WIDTH: u32 = 1600;
// Finding something on a screen of many points (a 4K one at scale 1×) needs more detail than VIEW_WIDTH gives: the
// first look to find it keeps as many pixels per point as a 1080p screen gets, up to this width. Measured with
// qwen3.8 on a 4K screen at scale 1×: 5 of 8 buttons found at 1600 px, 7 of 8 at 2400, for half a second more.
const DETAIL_PER_POINT: f64 = 1600.0 / 1920.0;
const MAX_OVERVIEW_WIDTH: u32 = 2400;
// Small text stays sharp at this JPEG quality
const VIEW_QUALITY: u8 = 85;
// A zoom shows this part of the screen's width and height, but never fewer pixels than this: a small screen would
// only come out blurred
const ZOOM_PART: u32 = 4;
const MIN_ZOOM_WIDTH: u32 = 800;
// How often the window checks whether the mouse is over a note, which takes clicks; elsewhere they go through
const HOVER_EVERY: Duration = Duration::from_millis(60);
const ACCENT: Rgba<u8> = Rgba([139, 92, 246, 255]);
// While guiding: how often the screen is compared, without the model, to see that the user did the step
const WATCH_EVERY: Duration = Duration::from_secs(2);
// Nothing changed for this long: the guide stops and asks whether the user is still there
const WATCH_IDLE: Duration = Duration::from_secs(5 * 60);
// The screen is compared in this small size, in grays: enough to see a menu open, cheap every few seconds
const COMPARE_WIDTH: u32 = 192;
// A gray that moved more than this counts as changed (the screen's own noise, a blinking cursor, stay under)
const PIXEL_CHANGE: u8 = 24;
// The step was done: this share changed around the marks (a menu, a toggle), or this share of the whole screen (a
// new window). A video or a clock elsewhere changes less.
const CHANGED_NEAR: f64 = 0.03;
const CHANGED_WHOLE: f64 = 0.2;
// Around the marks: this much of the screen on each side, for a menu that opens beside what was clicked
const NEAR_MARGIN: f64 = 0.12;
// The screen is still again (an animation ended) when less than this changed between two looks
const STILL: f64 = 0.01;
const MAX_SETTLE_LOOKS: u32 = 3;

/// A part of the screen, in fractions of its width and height, so it holds for any image of it
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// A mark on the screen: a box with a numbered note, and maybe an arrow to it from another place
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ScreenMark {
    number: u32,
    area: Area,
    note: String,
    #[serde(default)]
    from: Option<Area>,
}

/// Nyra's own pointer while it uses the mouse and keyboard: where it is on the marked screen, and what it is doing
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pointer {
    pub x: f64,
    pub y: f64,
    pub label: String,
    // How long it takes to glide there
    pub glide_ms: u64,
    // Where it comes out of the first time: the user's own mouse, in fractions of the screen
    pub start: Option<(f64, f64)>,
    // Its clicks so far: each new one shows on the screen
    pub clicks: u32,
    // Waiting for the model's next step, rather than doing what the label says
    pub thinking: bool,
    // On its way out: the window plays its goodbye before it goes
    pub leaving: bool,
}

/// A note as the marks window drew it, in its own points: where clicks close the mark instead of going through
#[derive(Deserialize, Clone, Copy, Debug)]
pub struct NoteArea {
    number: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Default)]
pub struct ScreenLooks {
    // The latest capture, whole, to zoom into, and the conversation that took it. Only one: a screen is tens of
    // megabytes, and a zoom follows its look in the same reply
    latest: Mutex<Option<(String, Arc<Shot>)>>,
    marks: Mutex<Vec<ScreenMark>>,
    notes: Mutex<Vec<NoteArea>>,
    // The capture the marks are on: which screen the marks window covers
    marked: Mutex<Option<Arc<Shot>>>,
    // Shown while Nyra acts on the screen; the window stays while it is there, even without marks
    pointer: Mutex<Option<Pointer>>,
    // Whether a thread follows the mouse over the marks; only while they are shown
    following: AtomicBool,
    // Each guide wait's stop, by the id the frontend gave it: set when the user did the step themselves, ended the
    // guide, or the reply stopped. A stop that arrives before its wait started is kept, so it is never lost.
    watches: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl ScreenLooks {
    /// Where Nyra's pointer is, while it acts
    pub(crate) fn pointer_now(&self) -> Option<Pointer> {
        self.pointer.lock().ok()?.clone()
    }
}

/// Where the marked screen is inside the marks window, in the window's own points (CSS pixels): where the marks
/// go, measured from where the window really ended up, so a window the system placed or sized a little differently
/// (a scale, a system bar, rounding) still draws them over the right spot
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
pub struct Frame {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Serialize)]
pub struct MarksNow {
    marks: Vec<ScreenMark>,
    frame: Option<Frame>,
    pointer: Option<Pointer>,
}

/// The screen inside a window whose content starts at `inner` (real pixels) with scale `window_scale`. On macOS the
/// screens are laid out in points, each one's real pixels divided by its own scale, so a screen and a window on
/// screens of different scales only line up in points; elsewhere the layout is in real pixels.
fn frame_in(shot: &Shot, inner: (i32, i32), window_scale: f64, in_points: bool) -> Frame {
    let screen_scale = if in_points { shot.scale } else { window_scale };
    Frame {
        left: f64::from(shot.position.x) / screen_scale - f64::from(inner.0) / window_scale,
        top: f64::from(shot.position.y) / screen_scale - f64::from(inner.1) / window_scale,
        width: f64::from(shot.size.width) / screen_scale,
        height: f64::from(shot.size.height) / screen_scale,
    }
}

pub(crate) fn frame_of(window: &tauri::WebviewWindow, shot: &Shot) -> Option<Frame> {
    let inner = window.inner_position().ok()?;
    let scale = window.scale_factor().ok()?;
    Some(frame_in(
        shot,
        (inner.x, inner.y),
        scale,
        cfg!(target_os = "macos"),
    ))
}

/// The marks window over the whole screen of the capture. On macOS in points: Tauri would turn real pixels into
/// points with the scale of the screen the window is on before moving, wrong when it moves to one of another scale.
fn cover_screen(window: &tauri::WebviewWindow, shot: &Shot) -> Result<(), String> {
    if cfg!(target_os = "macos") {
        let at = tauri::LogicalPosition::new(
            f64::from(shot.position.x) / shot.scale,
            f64::from(shot.position.y) / shot.scale,
        );
        let size = tauri::LogicalSize::new(
            f64::from(shot.size.width) / shot.scale,
            f64::from(shot.size.height) / shot.scale,
        );
        window.set_position(at).map_err(to_message)?;
        window.set_size(size).map_err(to_message)
    } else {
        window.set_position(shot.position).map_err(to_message)?;
        window.set_size(shot.size).map_err(to_message)
    }
}

#[derive(Serialize)]
pub struct ScreenView {
    // PNG, base64
    image: String,
    width: u32,
    height: u32,
}

/// A part of the screen made bigger, and which part it is
#[derive(Serialize)]
pub struct Zoom {
    image: String,
    area: Area,
    // The image's size, for a model that answers in its pixels
    width: u32,
    height: u32,
}

/// The largest image a model reads well: some (Claude) shrink any larger one themselves, and then the pixels they
/// answer in are no longer those of the image Nyra has
#[derive(Deserialize, Clone, Copy, Debug)]
pub struct Fit {
    width: u32,
    pixels: u64,
}

/// Whether Nyra can capture the screen here: the quick bar's capture works on macOS and Windows, not on Linux yet
#[tauri::command]
pub fn screen_look_available() -> bool {
    cfg!(any(target_os = "macos", windows))
}

/// What the model gets, as JPEG: a screen in PNG weighs several times more, sent again with every step of a task,
/// and reads no better
fn as_base64(image: &RgbaImage) -> Result<String, String> {
    let rgb = image::DynamicImage::ImageRgba8(image.clone()).to_rgb8();
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, VIEW_QUALITY)
        .encode_image(&rgb)
        .map_err(to_message)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// The image at most VIEW_WIDTH wide, or within what the model takes when it says so
fn scaled_to_view(image: &RgbaImage, fit: Option<Fit>) -> RgbaImage {
    scaled_to(image, VIEW_WIDTH, fit)
}

fn scaled_to(image: &RgbaImage, widest: u32, fit: Option<Fit>) -> RgbaImage {
    let (width, height) = image.dimensions();
    let (max_width, max_pixels) = fit.map_or((widest, u64::MAX), |fit| {
        (fit.width.min(widest), fit.pixels)
    });
    let (w, h) = (f64::from(width), f64::from(height));
    let by_pixels = (max_pixels as f64 / (w * h)).sqrt();
    let scale = (f64::from(max_width) / w).min(by_pixels).min(1.0);
    if scale >= 1.0 {
        return image.clone();
    }
    let new_width = ((w * scale).floor() as u32).max(1);
    let new_height = ((h * scale).floor() as u32).max(1);
    imageops::resize(image, new_width, new_height, FilterType::Triangle)
}

pub(crate) fn shot_of(looks: &ScreenLooks, conversation: &str) -> Result<Arc<Shot>, String> {
    looks
        .latest
        .lock()
        .map_err(to_message)?
        .as_ref()
        .filter(|(taken_by, _)| taken_by == conversation)
        .map(|(_, shot)| Arc::clone(shot))
        .ok_or_else(|| t("native.screen.noLook"))
}

/// Takes the screen where the mouse is, without the marks on it, and gives it at the size the model reads
#[tauri::command]
pub async fn screen_look(
    app: AppHandle,
    conversation_id: String,
    fit: Option<Fit>,
) -> Result<ScreenView, String> {
    // Waiting for the quick bar to leave the picture and capturing the screen block: off the async threads
    crate::workspace::blocking(move || {
        let looks = app.state::<ScreenLooks>();
        clear_marks(&app, &looks)?;
        let cache = app.path().app_cache_dir().map_err(to_message)?;
        // The quick bar, often over what the user asks about, is left out of the picture
        let shot =
            crate::quick::left_out_of_captures(&app, || grab_screen_under_cursor(&app, &cache))?
                .ok_or_else(|| t("native.screen.notTaken"))?;
        let view = scaled_to_view(&shot.image, fit);
        let (width, height) = view.dimensions();
        let image = as_base64(&view)?;
        *looks.latest.lock().map_err(to_message)? = Some((conversation_id, Arc::new(shot)));
        Ok(ScreenView {
            image,
            width,
            height,
        })
    })
    .await?
}

/// How wide the first look to find something is: as many pixels per point as a 1080p screen gets in VIEW_WIDTH
fn overview_width(shot: &Shot) -> u32 {
    let points = f64::from(shot.size.width) / shot.scale;
    ((points * DETAIL_PER_POINT).round() as u32).clamp(VIEW_WIDTH, MAX_OVERVIEW_WIDTH)
}

/// The latest capture with more detail, for finding something on a screen of many points; None when the view the
/// model already has is as detailed (a 1080p screen, a 4K one at scale 2×) or the model takes nothing bigger
#[tauri::command]
pub async fn screen_overview(
    app: AppHandle,
    conversation_id: String,
    fit: Option<Fit>,
) -> Result<Option<ScreenView>, String> {
    crate::workspace::blocking(move || {
        let shot = shot_of(&app.state::<ScreenLooks>(), &conversation_id)?;
        let overview = scaled_to(&shot.image, overview_width(&shot), fit);
        if overview.width() <= scaled_to_view(&shot.image, fit).width() {
            return Ok(None);
        }
        Ok(Some(ScreenView {
            image: as_base64(&overview)?,
            width: overview.width(),
            height: overview.height(),
        }))
    })
    .await?
}

/// The part of the screen, in pixels, that a zoom around a point shows: the screen's shape, inside it
fn zoom_area(width: u32, height: u32, x: f64, y: f64) -> (u32, u32, u32, u32) {
    let zoom_width = (width / ZOOM_PART).max(MIN_ZOOM_WIDTH).min(width);
    let zoom_height =
        ((f64::from(zoom_width) * f64::from(height) / f64::from(width)).round() as u32).min(height);
    let left = (x * f64::from(width) - f64::from(zoom_width) / 2.0)
        .clamp(0.0, f64::from(width - zoom_width)) as u32;
    let top = (y * f64::from(height) - f64::from(zoom_height) / 2.0)
        .clamp(0.0, f64::from(height - zoom_height)) as u32;
    (left, top, zoom_width, zoom_height)
}

fn fraction_of(left: u32, top: u32, width: u32, height: u32, image: &RgbaImage) -> Area {
    let (w, h) = (f64::from(image.width()), f64::from(image.height()));
    Area {
        x: f64::from(left) / w,
        y: f64::from(top) / h,
        width: f64::from(width) / w,
        height: f64::from(height) / h,
    }
}

/// The latest capture, bigger around a point (fractions of the screen): what the model looks at a second time to
/// point at something small exactly
#[tauri::command]
pub async fn screen_zoom(
    looks: State<'_, ScreenLooks>,
    conversation_id: String,
    x: f64,
    y: f64,
    fit: Option<Fit>,
) -> Result<Zoom, String> {
    let shot = shot_of(&looks, &conversation_id)?;
    let (width, height) = shot.image.dimensions();
    let (left, top, zoom_width, zoom_height) = zoom_area(width, height, x, y);
    let part = imageops::crop_imm(&shot.image, left, top, zoom_width, zoom_height).to_image();
    let view = scaled_to_view(&part, fit);
    Ok(Zoom {
        image: as_base64(&view)?,
        area: fraction_of(left, top, zoom_width, zoom_height, &shot.image),
        width: view.width(),
        height: view.height(),
    })
}

/// A box drawn on an image, `thickness` pixels wide, inside its edges
fn outline(image: &mut RgbaImage, left: u32, top: u32, width: u32, height: u32, thickness: u32) {
    let (w, h) = image.dimensions();
    let right = (left + width).min(w);
    let bottom = (top + height).min(h);
    for y in top..bottom {
        for x in left..right {
            let near = x < left + thickness
                || x + thickness >= right
                || y < top + thickness
                || y + thickness >= bottom;
            if near {
                image.put_pixel(x, y, ACCENT);
            }
        }
    }
}

/// What a mark would cover, close up and outlined, for the model to check it points at what it meant
#[tauri::command]
pub async fn screen_close_up(
    looks: State<'_, ScreenLooks>,
    conversation_id: String,
    area: Area,
    fit: Option<Fit>,
) -> Result<String, String> {
    let shot = shot_of(&looks, &conversation_id)?;
    let (width, height) = shot.image.dimensions();
    let center = (area.x + area.width / 2.0, area.y + area.height / 2.0);
    let (left, top, zoom_width, zoom_height) = zoom_area(width, height, center.0, center.1);
    let mut part = imageops::crop_imm(&shot.image, left, top, zoom_width, zoom_height).to_image();
    let box_left = (area.x * f64::from(width)).round() as i64 - i64::from(left);
    let box_top = (area.y * f64::from(height)).round() as i64 - i64::from(top);
    let thickness = (zoom_width / 300).max(3);
    let pad = i64::from(thickness) * 2;
    let clamp = |v: i64, max: u32| v.clamp(0, i64::from(max)) as u32;
    let x0 = clamp(box_left - pad, zoom_width);
    let y0 = clamp(box_top - pad, zoom_height);
    let x1 = clamp(
        box_left + (area.width * f64::from(width)).round() as i64 + pad,
        zoom_width,
    );
    let y1 = clamp(
        box_top + (area.height * f64::from(height)).round() as i64 + pad,
        zoom_height,
    );
    outline(
        &mut part,
        x0,
        y0,
        x1.saturating_sub(x0),
        y1.saturating_sub(y0),
        thickness,
    );
    as_base64(&scaled_to_view(&part, fit))
}

fn marks_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window(MARKS_LABEL)
}

/// Shows the marks over the screen of the conversation's latest capture, replacing the ones there
#[tauri::command]
pub async fn screen_mark(
    app: AppHandle,
    looks: State<'_, ScreenLooks>,
    conversation_id: String,
    marks: Vec<ScreenMark>,
) -> Result<(), String> {
    let shot = shot_of(&looks, &conversation_id)?;
    *looks.marks.lock().map_err(to_message)? = marks.clone();
    looks.notes.lock().map_err(to_message)?.clear();
    if marks.is_empty() {
        return clear_marks(&app, &looks);
    }
    let window = show_over(&app, &looks, &shot)?;
    // A window just made reads them itself once its page has loaded
    let _ = window.emit(MARKS_EVENT, &marks);
    Ok(())
}

/// The marks window shown over the capture's screen, made the first time
fn show_over(
    app: &AppHandle,
    looks: &ScreenLooks,
    shot: &Arc<Shot>,
) -> Result<tauri::WebviewWindow, String> {
    *looks.marked.lock().map_err(to_message)? = Some(Arc::clone(shot));
    let window = match marks_window(app) {
        Some(window) => window,
        None => {
            let window =
                WebviewWindowBuilder::new(app, MARKS_LABEL, WebviewUrl::App("marks.html".into()))
                    .title("Nyra")
                    .decorations(false)
                    .resizable(false)
                    .transparent(true)
                    .always_on_top(true)
                    .visible_on_all_workspaces(true)
                    .skip_taskbar(true)
                    .shadow(false)
                    .focused(false)
                    .visible(false)
                    .build()
                    .map_err(|e| {
                        t_with("native.screen.windowFailed", &[("error", &e.to_string())])
                    })?;
            // Left out of every capture, so Nyra sees the screen under its marks and they never count as a change
            let _ = window.set_content_protected(true);
            window
        }
    };
    cover_screen(&window, shot)?;
    window.set_ignore_cursor_events(true).map_err(to_message)?;
    // Shown again while Nyra acts, it could take the keyboard from the app Nyra is typing in
    if !window.is_visible().unwrap_or(false) {
        window.show().map_err(to_message)?;
    }
    follow_mouse(app.clone());
    Ok(window)
}

/// Nyra's pointer over the capture's screen, or away with None. Any marks go, so no note takes the clicks Nyra makes.
/// Gives the window, where the pointer is drawn and the real mouse is placed.
pub(crate) fn show_pointer(
    app: &AppHandle,
    conversation: &str,
    pointer: Option<Pointer>,
) -> Result<Option<tauri::WebviewWindow>, String> {
    let looks = app.state::<ScreenLooks>();
    let shown = pointer.is_some();
    *looks.pointer.lock().map_err(to_message)? = pointer;
    looks.marks.lock().map_err(to_message)?.clear();
    looks.notes.lock().map_err(to_message)?.clear();
    if !shown {
        return clear_marks(app, &looks).map(|()| None);
    }
    let shot = shot_of(&looks, conversation)?;
    let window = show_over(app, &looks, &shot)?;
    let _ = window.emit(MARKS_EVENT, Vec::<ScreenMark>::new());
    Ok(Some(window))
}

/// The capture the pointer and marks are on
pub(crate) fn marked_shot(app: &AppHandle) -> Option<Arc<Shot>> {
    app.state::<ScreenLooks>().marked.lock().ok()?.clone()
}

/// The marks to draw and where the screen is in the window, asked by the marks window when its page loads, when the
/// marks change and when it moves or changes size
#[tauri::command]
pub fn screen_marks_now(
    window: tauri::WebviewWindow,
    looks: State<'_, ScreenLooks>,
) -> Result<MarksNow, String> {
    let marks = looks.marks.lock().map_err(to_message)?.clone();
    let pointer = looks.pointer.lock().map_err(to_message)?.clone();
    let frame = looks
        .marked
        .lock()
        .map_err(to_message)?
        .as_ref()
        .and_then(|shot| frame_of(&window, shot));
    Ok(MarksNow {
        marks,
        frame,
        pointer,
    })
}

/// Where the notes ended up, so clicks on them reach the window
#[tauri::command]
pub fn screen_note_areas(
    looks: State<'_, ScreenLooks>,
    areas: Vec<NoteArea>,
) -> Result<(), String> {
    *looks.notes.lock().map_err(to_message)? = areas;
    Ok(())
}

/// The user clicked a note: its mark goes, and the window with the last one
#[tauri::command]
pub fn screen_close_mark(
    app: AppHandle,
    looks: State<'_, ScreenLooks>,
    number: u32,
) -> Result<(), String> {
    let left = {
        let mut marks = looks.marks.lock().map_err(to_message)?;
        marks.retain(|mark| mark.number != number);
        marks.clone()
    };
    looks
        .notes
        .lock()
        .map_err(to_message)?
        .retain(|note| note.number != number);
    if left.is_empty() {
        return clear_marks(&app, &looks);
    }
    if let Some(window) = marks_window(&app) {
        let _ = window.emit(MARKS_EVENT, &left);
    }
    Ok(())
}

/// The marks go: when Nyra looks again, or the user takes them away
#[tauri::command]
pub fn screen_clear(app: AppHandle, looks: State<'_, ScreenLooks>) -> Result<(), String> {
    clear_marks(&app, &looks)
}

fn clear_marks(app: &AppHandle, looks: &ScreenLooks) -> Result<(), String> {
    looks.marks.lock().map_err(to_message)?.clear();
    looks.notes.lock().map_err(to_message)?.clear();
    let pointed = looks.pointer.lock().map_err(to_message)?.is_some();
    if let Some(window) = marks_window(app) {
        let _ = window.emit(MARKS_EVENT, Vec::<ScreenMark>::new());
        // Nyra's pointer stays while it acts; the window is left out of captures, so looking doesn't need it gone
        if !pointed {
            let _ = window.hide();
        }
    }
    Ok(())
}

fn over_a_note(notes: &[NoteArea], x: f64, y: f64) -> bool {
    notes
        .iter()
        .any(|n| x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height)
}

fn shown_marks_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    marks_window(app).filter(|window| window.is_visible().unwrap_or(false))
}

/// While marks are shown: clicks reach the window only over a note, so everything else works as if it weren't there.
/// The thread ends when they are hidden, so a hidden window doesn't wake it every few milliseconds.
fn follow_mouse(app: AppHandle) {
    if app
        .state::<ScreenLooks>()
        .following
        .swap(true, Ordering::SeqCst)
    {
        return;
    }
    thread::spawn(move || {
        let mut takes_clicks = false;
        loop {
            let Some(window) = shown_marks_window(&app) else {
                let looks = app.state::<ScreenLooks>();
                looks.following.store(false, Ordering::SeqCst);
                // Shown again while this one was ending: whoever showed them found it still running
                if shown_marks_window(&app).is_some()
                    && !looks.following.swap(true, Ordering::SeqCst)
                {
                    takes_clicks = false;
                    continue;
                }
                return;
            };
            thread::sleep(HOVER_EVERY);
            let (Ok(cursor), Ok(position), Ok(scale)) = (
                app.cursor_position(),
                window.outer_position(),
                window.scale_factor(),
            ) else {
                continue;
            };
            let x = (cursor.x - f64::from(position.x)) / scale;
            let y = (cursor.y - f64::from(position.y)) / scale;
            let over = app
                .state::<ScreenLooks>()
                .notes
                .lock()
                .map(|notes| over_a_note(&notes, x, y))
                .unwrap_or(false);
            if over != takes_clicks && window.set_ignore_cursor_events(!over).is_ok() {
                takes_clicks = over;
            }
        }
    });
}

/// The screen in small grays, to compare
fn for_comparing(image: &RgbaImage) -> GrayImage {
    let (width, height) = image.dimensions();
    let small_height = ((f64::from(height) * f64::from(COMPARE_WIDTH) / f64::from(width.max(1)))
        .round() as u32)
        .max(1);
    imageops::grayscale(&imageops::thumbnail(image, COMPARE_WIDTH, small_height))
}

/// The share of grays that moved, around an area (with NEAR_MARGIN) and on the whole screen; two screens of other
/// sizes (the mouse went to another screen) are all changed
fn changed_shares(before: &GrayImage, after: &GrayImage, near: Option<Area>) -> (f64, f64) {
    if before.dimensions() != after.dimensions() {
        return (1.0, 1.0);
    }
    let (width, height) = before.dimensions();
    let bounds = near.map(|area| {
        let x0 = ((area.x - NEAR_MARGIN).max(0.0) * f64::from(width)) as u32;
        let y0 = ((area.y - NEAR_MARGIN).max(0.0) * f64::from(height)) as u32;
        let x1 = (((area.x + area.width + NEAR_MARGIN).min(1.0)) * f64::from(width)).ceil() as u32;
        let y1 =
            (((area.y + area.height + NEAR_MARGIN).min(1.0)) * f64::from(height)).ceil() as u32;
        (x0, y0, x1, y1)
    });
    let (mut changed, mut near_changed, mut near_total) = (0u32, 0u32, 0u32);
    for (x, y, pixel) in after.enumerate_pixels() {
        let moved = pixel[0].abs_diff(before.get_pixel(x, y)[0]) > PIXEL_CHANGE;
        changed += u32::from(moved);
        if let Some((x0, y0, x1, y1)) = bounds {
            if x >= x0 && x < x1 && y >= y0 && y < y1 {
                near_total += 1;
                near_changed += u32::from(moved);
            }
        }
    }
    let whole = f64::from(changed) / f64::from((width * height).max(1));
    let around = if near_total > 0 {
        f64::from(near_changed) / f64::from(near_total)
    } else {
        whole
    };
    (around, whole)
}

fn did_change(shares: (f64, f64)) -> bool {
    shares.0 > CHANGED_NEAR || shares.1 > CHANGED_WHOLE
}

/// How a guide's wait ended: the screen changed (the new one, as the model reads it), it was stopped, or nothing
/// changed for too long
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Watched {
    Changed { view: ScreenView },
    Stopped,
    Idle,
}

fn capture_now(app: &AppHandle) -> Result<Shot, String> {
    let cache = app.path().app_cache_dir().map_err(to_message)?;
    crate::quick::left_out_of_captures(app, || grab_screen_under_cursor(app, &cache))?
        .ok_or_else(|| t("native.screen.notTaken"))
}

/// While guiding: waits, comparing the screen every few seconds and without the model, until the user does the step.
/// near: the marks' area, where a change counts most. Once it changed it waits for the screen to be still (an
/// animation, a page loading) and gives that screen, which zooms and marks then use.
#[tauri::command]
pub async fn screen_watch(
    app: AppHandle,
    conversation_id: String,
    run: String,
    near: Option<Area>,
    fit: Option<Fit>,
) -> Result<Watched, String> {
    let looks = app.state::<ScreenLooks>();
    let start = shot_of(&looks, &conversation_id)?;
    let stop = Arc::clone(
        looks
            .watches
            .lock()
            .map_err(to_message)?
            .entry(run.clone())
            .or_default(),
    );
    let handle = app.clone();
    let watched = crate::workspace::blocking(move || {
        let stopped = || stop.load(Ordering::SeqCst);
        let since = Instant::now();
        let mut before = for_comparing(&start.image);
        let changed = loop {
            // Short sleeps, so a stop is heard at once
            let wake = Instant::now() + WATCH_EVERY;
            while Instant::now() < wake {
                if stopped() {
                    return Ok(Watched::Stopped);
                }
                thread::sleep(Duration::from_millis(100));
            }
            if since.elapsed() > WATCH_IDLE {
                return Ok(Watched::Idle);
            }
            let shot = capture_now(&app)?;
            let now = for_comparing(&shot.image);
            if did_change(changed_shares(&before, &now, near)) {
                break (shot, now);
            }
            before = now;
        };
        let (mut shot, mut last) = changed;
        for _ in 0..MAX_SETTLE_LOOKS {
            thread::sleep(WATCH_EVERY / 2);
            if stopped() {
                return Ok(Watched::Stopped);
            }
            let next = capture_now(&app)?;
            let now = for_comparing(&next.image);
            let (around, whole) = changed_shares(&last, &now, near);
            shot = next;
            last = now;
            if around < STILL && whole < STILL {
                break;
            }
        }
        let view = scaled_to_view(&shot.image, fit);
        let (width, height) = view.dimensions();
        let image = as_base64(&view)?;
        let looks = app.state::<ScreenLooks>();
        *looks.latest.lock().map_err(to_message)? = Some((conversation_id, Arc::new(shot)));
        Ok(Watched::Changed {
            view: ScreenView {
                image,
                width,
                height,
            },
        })
    })
    .await;
    if let Ok(mut watches) = handle.state::<ScreenLooks>().watches.lock() {
        watches.remove(&run);
    }
    watched?
}

/// Ends a guide's wait: the user did the step themselves or ended the guide, or the reply stopped. Before the wait
/// started, it starts already stopped.
#[tauri::command]
pub fn screen_watch_stop(looks: State<'_, ScreenLooks>, run: String) -> Result<(), String> {
    looks
        .watches
        .lock()
        .map_err(to_message)?
        .entry(run)
        .or_default()
        .store(true, Ordering::SeqCst);
    Ok(())
}

/// A conversation deleted takes its capture with it
pub fn forget(app: &AppHandle, conversation: &str) {
    if let Ok(mut latest) = app.state::<ScreenLooks>().latest.lock() {
        if latest
            .as_ref()
            .is_some_and(|(taken_by, _)| taken_by == conversation)
        {
            *latest = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_zoom_keeps_the_screen_shape_and_stays_inside_it() {
        // A 6K screen: a quarter of it, around the point
        assert_eq!(zoom_area(6016, 3384, 0.5, 0.5), (2256, 1269, 1504, 846));
        // By a corner it moves in rather than leaving the screen
        assert_eq!(zoom_area(6016, 3384, 0.99, 0.0), (4512, 0, 1504, 846));
        // A small screen never zooms below what reads well
        assert_eq!(zoom_area(1920, 1080, 0.5, 0.5).2, 800);
        assert_eq!(zoom_area(640, 360, 0.5, 0.5), (0, 0, 640, 360));
    }

    fn shot_at(x: i32, y: i32, width: u32, height: u32, scale: f64) -> Shot {
        Shot {
            image: RgbaImage::new(1, 1),
            position: tauri::PhysicalPosition::new(x, y),
            size: tauri::PhysicalSize::new(width, height),
            scale,
        }
    }

    #[test]
    fn finds_the_screen_inside_the_window_wherever_it_ended_up() {
        // A Retina screen (2×) right of a 1× one, 1512 points wide: a window right on it covers it exactly
        let retina = shot_at(3840, 0, 3024, 1964, 2.0);
        let exact = frame_in(&retina, (3840, 0), 2.0, true);
        assert_eq!(
            exact,
            Frame {
                left: 0.0,
                top: 0.0,
                width: 1512.0,
                height: 982.0
            }
        );
        // In points, a screen of another scale still lines up: the 1× screen left of it is at x 0 to 1920
        let external = shot_at(0, 0, 1920, 1080, 1.0);
        assert_eq!(frame_in(&external, (0, 0), 1.0, true).width, 1920.0);
        // A window the system pushed 25 points down (a menu bar) draws the marks 25 points higher
        assert_eq!(frame_in(&retina, (3840, 50), 2.0, true).top, -25.0);
        // In real pixels (Windows), with a 150 % screen
        let windows = shot_at(1920, 0, 2560, 1440, 1.5);
        assert_eq!(
            frame_in(&windows, (1920, 0), 1.5, false),
            Frame {
                left: 0.0,
                top: 0.0,
                width: 2560.0 / 1.5,
                height: 960.0
            }
        );
    }

    #[test]
    fn finds_with_more_detail_only_on_screens_of_many_points() {
        let screen = |width, height, scale| shot_at(0, 0, width, height, scale);
        assert_eq!(overview_width(&screen(1920, 1080, 1.0)), 1600);
        assert_eq!(overview_width(&screen(3840, 2160, 2.0)), 1600);
        assert_eq!(overview_width(&screen(3840, 2160, 1.5)), 2133);
        assert_eq!(overview_width(&screen(3840, 2160, 1.0)), 2400);
        assert_eq!(overview_width(&screen(6016, 3384, 2.0)), 2400);
    }

    #[test]
    fn fits_the_view_to_what_the_model_takes() {
        let screen = RgbaImage::new(6016, 3384);
        // As before: 1600 wide
        assert_eq!(scaled_to_view(&screen, None).dimensions(), (1600, 900));
        // Claude's: at most 1568 on the long side and 1.15 megapixels, so it never shrinks it again
        let fitted = scaled_to_view(
            &screen,
            Some(Fit {
                width: 1568,
                pixels: 1_150_000,
            }),
        );
        let (w, h) = fitted.dimensions();
        assert!(
            w <= 1568 && u64::from(w) * u64::from(h) <= 1_150_000,
            "{w}×{h}"
        );
        assert!(w > 1400, "{w}×{h}");
        // A small one stays as it is
        assert_eq!(
            scaled_to_view(&RgbaImage::new(800, 450), None).dimensions(),
            (800, 450)
        );
    }

    fn gray(width: u32, height: u32, value: u8) -> GrayImage {
        GrayImage::from_pixel(width, height, image::Luma([value]))
    }

    #[test]
    fn a_change_by_the_marks_counts_and_a_small_one_elsewhere_doesnt() {
        let before = gray(100, 100, 50);
        // A menu opened by the mark at the top left: a block of 10×10 changed there
        let mut menu = before.clone();
        for y in 5..15 {
            for x in 5..15 {
                menu.put_pixel(x, y, image::Luma([200]));
            }
        }
        let mark = Area {
            x: 0.05,
            y: 0.05,
            width: 0.05,
            height: 0.05,
        };
        assert!(did_change(changed_shares(&before, &menu, Some(mark))));
        // The same block far from the mark (a video, a clock) is too small a share of the screen
        let far = Area {
            x: 0.8,
            y: 0.8,
            width: 0.05,
            height: 0.05,
        };
        assert!(!did_change(changed_shares(&before, &menu, Some(far))));
        // Noise under the threshold is no change
        assert!(!did_change(changed_shares(
            &before,
            &gray(100, 100, 60),
            None
        )));
        // A new window over half the screen is one, wherever the mark is
        let mut window = before.clone();
        for y in 0..100 {
            for x in 0..50 {
                window.put_pixel(x, y, image::Luma([220]));
            }
        }
        assert!(did_change(changed_shares(&before, &window, Some(far))));
        // Another screen, of another size
        assert!(did_change(changed_shares(
            &before,
            &gray(80, 100, 50),
            None
        )));
    }

    #[test]
    fn compares_a_screen_in_small_grays() {
        let small = for_comparing(&RgbaImage::new(6016, 3384));
        assert_eq!(small.width(), COMPARE_WIDTH);
        assert_eq!(small.height(), 108);
    }

    #[test]
    fn a_box_is_drawn_on_its_edges_only() {
        let mut image = RgbaImage::from_pixel(20, 20, Rgba([0, 0, 0, 255]));
        outline(&mut image, 5, 5, 10, 10, 2);
        assert_eq!(*image.get_pixel(5, 5), ACCENT);
        assert_eq!(*image.get_pixel(14, 10), ACCENT);
        assert_eq!(*image.get_pixel(10, 10), Rgba([0, 0, 0, 255]));
        assert_eq!(*image.get_pixel(4, 4), Rgba([0, 0, 0, 255]));
    }

    #[test]
    fn clicks_reach_only_the_notes() {
        let notes = [NoteArea {
            number: 1,
            x: 100.0,
            y: 50.0,
            width: 120.0,
            height: 30.0,
        }];
        assert!(over_a_note(&notes, 150.0, 60.0));
        assert!(!over_a_note(&notes, 90.0, 60.0));
        assert!(!over_a_note(&[], 150.0, 60.0));
    }
}
