//! One screen captured straight from ScreenCaptureKit, in memory: faster than the system's screencapture tool, which
//! writes a PNG to read back. Only where it can take a single picture (macOS 14 and later); the framework is weakly
//! linked (build.rs), so Nyra still starts on older systems, where the capture goes through screencapture.

use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use image::RgbaImage;
use objc2::rc::Retained;
use objc2::runtime::AnyClass;
use objc2::AnyThread;
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_core_graphics::{
    kCGColorSpaceSRGB, CGBitmapContextCreate, CGColorSpace, CGContext, CGImage, CGImageAlphaInfo,
};
use objc2_foundation::{NSArray, NSError};
use objc2_screen_capture_kit::{
    SCContentFilter, SCScreenshotManager, SCShareableContent, SCStreamConfiguration,
};

// The system answers on its own queue; past this, the capture goes through screencapture instead
const WAIT: Duration = Duration::from_secs(5);

/// Whether this macOS takes a single picture with ScreenCaptureKit
pub fn available() -> bool {
    AnyClass::get(c"SCScreenshotManager").is_some()
}

/// The screen whose top-left corner, in points, is at `origin`, at `width`×`height` real pixels
pub fn capture(origin: (f64, f64), width: usize, height: usize) -> Result<RgbaImage, String> {
    if !available() {
        return Err("ScreenCaptureKit can't take a picture here".into());
    }
    let (send, receive) = mpsc::channel::<Result<RgbaImage, String>>();
    let found = RcBlock::new(
        move |content: *mut SCShareableContent, error: *mut NSError| {
            let send = send.clone();
            // SAFETY: the system hands a valid object or null, and keeps it alive for the call
            let Some(content) = (unsafe { Retained::retain(content) }) else {
                let _ = send.send(Err(describe(error)));
                return;
            };
            if let Err(e) = take(&content, origin, width, height, send.clone()) {
                let _ = send.send(Err(e));
            }
        },
    );
    // SAFETY: the block lives until the system calls it; what it gets is checked there
    unsafe { SCShareableContent::getShareableContentWithCompletionHandler(&found) };
    receive
        .recv_timeout(WAIT)
        .map_err(|_| "ScreenCaptureKit didn't answer".to_string())?
}

fn take(
    content: &SCShareableContent,
    origin: (f64, f64),
    width: usize,
    height: usize,
    send: mpsc::Sender<Result<RgbaImage, String>>,
) -> Result<(), String> {
    // SAFETY: plain reads of an object the system gave
    let displays = unsafe { content.displays() };
    let display = displays
        .iter()
        .find(|display| {
            let frame = unsafe { display.frame() };
            (frame.origin.x - origin.0).abs() < 1.0 && (frame.origin.y - origin.1).abs() < 1.0
        })
        .ok_or("ScreenCaptureKit doesn't list that screen")?;
    // SAFETY: a filter of one display with nothing left out, and a configuration of its size
    let filter = unsafe {
        SCContentFilter::initWithDisplay_excludingWindows(
            SCContentFilter::alloc(),
            &display,
            &NSArray::new(),
        )
    };
    let config = unsafe { SCStreamConfiguration::new() };
    unsafe {
        config.setWidth(width);
        config.setHeight(height);
        config.setShowsCursor(false);
    }
    let taken = RcBlock::new(move |image: *mut CGImage, error: *mut NSError| {
        // SAFETY: the system hands a valid image or null, alive during the call, where it is read
        let result = match unsafe { image.as_ref() } {
            Some(image) => to_rgba(image),
            None => Err(describe(error)),
        };
        let _ = send.send(result);
    });
    // SAFETY: filter, configuration and block outlive the call; the block is called once
    unsafe {
        SCScreenshotManager::captureImageWithFilter_configuration_completionHandler(
            &filter,
            &config,
            Some(&taken),
        )
    };
    Ok(())
}

/// The picture in sRGB, red-green-blue-alpha, whatever layout the system gave it in: drawn into a bitmap of that kind
fn to_rgba(image: &CGImage) -> Result<RgbaImage, String> {
    let width = CGImage::width(Some(image));
    let height = CGImage::height(Some(image));
    let mut pixels = vec![0u8; width * height * 4];
    // SAFETY: a static the system defines
    let srgb = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB }));
    // SAFETY: the buffer is width × height × 4 bytes and outlives the context, dropped before it is read
    let context = unsafe {
        CGBitmapContextCreate(
            pixels.as_mut_ptr().cast(),
            width,
            height,
            8,
            width * 4,
            srgb.as_deref(),
            CGImageAlphaInfo::PremultipliedLast.0,
        )
    }
    .ok_or("Couldn't prepare the screen's picture")?;
    let whole = CGRect::new(
        CGPoint::new(0.0, 0.0),
        CGSize::new(width as f64, height as f64),
    );
    CGContext::draw_image(Some(&context), whole, Some(image));
    drop(context);
    RgbaImage::from_raw(width as u32, height as u32, pixels)
        .ok_or_else(|| "Couldn't read the screen's picture".to_string())
}

fn describe(error: *mut NSError) -> String {
    // SAFETY: the system hands a valid error or null
    match unsafe { error.as_ref() } {
        Some(error) => error.localizedDescription().to_string(),
        None => "ScreenCaptureKit gave nothing".into(),
    }
}
