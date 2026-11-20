//! Where Nyra hears from: the microphone the user chose, and what the computer itself plays. Dictation and meeting
//! recordings both take their sound from here.

use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, DeviceId, Error, ErrorKind, FromSample, SampleFormat, SizedSample};
use serde::Serialize;

use crate::i18n::{t, t_with};

/// A stream that is recording: what it heard so far, mixed to mono at its own rate, until someone takes it. Stopped
/// when dropped, in the thread that opened it.
pub struct Capture {
    _stream: cpal::Stream,
    // The device the stream reads from, made by Nyra: it goes after the stream
    #[cfg(target_os = "macos")]
    _tap: Option<tap::Tap>,
    pub heard: Arc<Mutex<Vec<f32>>>,
    pub rate: u32,
}

impl Capture {
    /// What it heard since the last time
    pub fn take(&self) -> Vec<f32> {
        self.heard
            .lock()
            .map(|mut heard| std::mem::take(&mut *heard))
            .unwrap_or_default()
    }
}

/// A microphone as Settings lists it: its id, kept to find it again, and its name
#[derive(Serialize)]
pub struct AudioInput {
    id: String,
    name: String,
}

/// The microphones connected now. Without PulseAudio's monitors on Linux, which are the computer's sound, not a
/// microphone.
#[tauri::command]
pub async fn audio_inputs() -> Result<Vec<AudioInput>, String> {
    // Asking the sound server may take a moment
    tauri::async_runtime::spawn_blocking(|| {
        let devices = cpal::default_host()
            .input_devices()
            .map_err(microphone_error)?;
        Ok(devices
            .filter_map(|device| {
                let id = device.id().ok()?;
                let name = device.description().ok()?.name().to_string();
                (!is_monitor(&id)).then(|| AudioInput {
                    id: id.to_string(),
                    name,
                })
            })
            .collect())
    })
    .await
    .map_err(|_| t("native.dictation.noMicrophone"))?
}

fn is_monitor(id: &DeviceId) -> bool {
    id.id().ends_with(".monitor")
}

/// The microphone chosen in Settings, or the system's when none was chosen or it isn't connected now
pub fn microphone(chosen: Option<&str>) -> Result<Device, String> {
    let host = cpal::default_host();
    chosen
        .and_then(|id| id.parse::<DeviceId>().ok())
        .and_then(|id| host.device_by_id(&id))
        .or_else(|| host.default_input_device())
        .ok_or_else(|| t("native.dictation.noMicrophone"))
}

/// Records what the computer plays
pub fn capture_system_sound() -> Result<Capture, String> {
    #[cfg(target_os = "macos")]
    {
        // Before macOS 14.2, or without the permission, there is no tap
        let tap = tap::Tap::new().map_err(|status| {
            t_with(
                "native.meeting.systemFailedMac",
                &[("error", &status.to_string())],
            )
        })?;
        let device = tap.device()?;
        let mut capture = capture(&device).map_err(system_sound_error)?;
        capture._tap = Some(tap);
        Ok(capture)
    }
    #[cfg(not(target_os = "macos"))]
    capture(&system_sound()?).map_err(system_sound_error)
}

/// What the computer plays, recorded like a microphone: its default output on Windows, and that output's monitor on
/// Linux with PulseAudio or PipeWire
#[cfg(not(target_os = "macos"))]
fn system_sound() -> Result<Device, String> {
    let host = cpal::default_host();
    let output = host
        .default_output_device()
        .ok_or_else(|| t("native.meeting.noSystemSound"))?;
    #[cfg(target_os = "linux")]
    {
        let id = output.id().map_err(system_sound_error)?;
        if id.host() != cpal::HostId::PulseAudio {
            return Err(t("native.meeting.noSoundServer"));
        }
        // The sound server names each output's monitor after it
        let monitor = DeviceId::new(id.host(), format!("{}.monitor", id.id()));
        host.device_by_id(&monitor)
            .ok_or_else(|| t("native.meeting.noSystemSound"))
    }
    #[cfg(windows)]
    Ok(output)
}

#[cfg(target_os = "macos")]
mod tap {
    //! Everything the computer plays, as an input device of Nyra's own: a tap of every app's sound inside a private
    //! aggregate device only Nyra sees. Not the output itself: a headset's has a microphone, which would be recorded
    //! instead of what plays.

    use std::ptr::NonNull;
    use std::thread;
    use std::time::Duration;

    use cpal::traits::HostTrait;
    use cpal::{Device, DeviceId, HostId};
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::AnyThread;
    use objc2_core_audio::{
        kAudioAggregateDeviceIsPrivateKey, kAudioAggregateDeviceNameKey,
        kAudioAggregateDeviceTapAutoStartKey, kAudioAggregateDeviceTapListKey,
        kAudioAggregateDeviceUIDKey, kAudioSubTapDriftCompensationKey, kAudioSubTapUIDKey,
        AudioHardwareCreateAggregateDevice, AudioHardwareCreateProcessTap,
        AudioHardwareDestroyAggregateDevice, AudioHardwareDestroyProcessTap, AudioObjectID,
        CATapDescription,
    };
    use objc2_core_foundation::CFDictionary;
    use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString};

    use crate::i18n::t;

    // The aggregate device takes a moment to be listed after it is made
    const LISTED_AFTER: Duration = Duration::from_millis(100);
    const LISTED_TRIES: u32 = 20;

    pub struct Tap {
        tap: AudioObjectID,
        aggregate: AudioObjectID,
        uid: String,
    }

    fn key(name: &std::ffi::CStr) -> Retained<NSString> {
        NSString::from_str(&String::from_utf8_lossy(name.to_bytes()))
    }

    /// An NSDictionary is a CFDictionary as well, which the audio calls take
    fn as_cf(dictionary: &NSDictionary<NSString, AnyObject>) -> &CFDictionary {
        // SAFETY: toll-free bridged types share their layout; the borrow keeps the dictionary alive
        unsafe { &*(dictionary as *const NSDictionary<NSString, AnyObject>).cast::<CFDictionary>() }
    }

    impl Tap {
        /// Fails with the system's status, or -1 before macOS 14.2, which has no taps
        pub fn new() -> Result<Self, i32> {
            if AnyClass::get(c"CATapDescription").is_none() {
                return Err(-1);
            }
            // SAFETY: an empty list leaves no app out; the description is only read by the call that makes the tap
            let description = unsafe {
                CATapDescription::initStereoGlobalTapButExcludeProcesses(
                    CATapDescription::alloc(),
                    &NSArray::new(),
                )
            };
            unsafe { description.setPrivate(true) };
            let mut tap: AudioObjectID = 0;
            let status = unsafe { AudioHardwareCreateProcessTap(Some(&description), &mut tap) };
            if status != 0 {
                return Err(status);
            }
            let tap_uid = unsafe { description.UUID().UUIDString() };
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default();
            let uid = format!("nyra.meeting.{}.{stamp}", std::process::id());
            let yes = NSNumber::numberWithBool(true);
            let sub_tap: Retained<NSDictionary<NSString, AnyObject>> = NSDictionary::from_slices(
                &[
                    &*key(kAudioSubTapUIDKey),
                    &*key(kAudioSubTapDriftCompensationKey),
                ],
                &[&*tap_uid, &*yes],
            );
            let taps = NSArray::from_retained_slice(&[sub_tap]);
            let name = NSString::from_str("Nyra");
            let uid_value = NSString::from_str(&uid);
            let aggregate_description: Retained<NSDictionary<NSString, AnyObject>> =
                NSDictionary::from_slices(
                    &[
                        &*key(kAudioAggregateDeviceNameKey),
                        &*key(kAudioAggregateDeviceUIDKey),
                        &*key(kAudioAggregateDeviceTapListKey),
                        &*key(kAudioAggregateDeviceTapAutoStartKey),
                        &*key(kAudioAggregateDeviceIsPrivateKey),
                    ],
                    &[&*name, &*uid_value, &*taps, &*yes, &*yes],
                );
            let mut aggregate: AudioObjectID = 0;
            // SAFETY: a description of the kind the call takes, and a place for the id it writes
            let status = unsafe {
                AudioHardwareCreateAggregateDevice(
                    as_cf(&aggregate_description),
                    NonNull::from(&mut aggregate),
                )
            };
            if status != 0 {
                unsafe { AudioHardwareDestroyProcessTap(tap) };
                return Err(status);
            }
            Ok(Tap {
                tap,
                aggregate,
                uid,
            })
        }

        /// The aggregate device as the audio library opens it
        pub fn device(&self) -> Result<Device, String> {
            let host = cpal::default_host();
            let id = DeviceId::new(HostId::CoreAudio, &self.uid);
            for _ in 0..LISTED_TRIES {
                if let Some(device) = host.device_by_id(&id) {
                    return Ok(device);
                }
                thread::sleep(LISTED_AFTER);
            }
            Err(t("native.meeting.noSystemSound"))
        }
    }

    impl Drop for Tap {
        fn drop(&mut self) {
            // SAFETY: both were made by this tap and are destroyed once
            unsafe {
                AudioHardwareDestroyAggregateDevice(self.aggregate);
                AudioHardwareDestroyProcessTap(self.tap);
            }
        }
    }
}

/// Starts recording from a device: a microphone, or an output, which the system then records as it plays
pub fn capture(device: &Device) -> Result<Capture, Error> {
    let supported = if device.supports_input() {
        device.default_input_config()
    } else {
        device.default_output_config()
    }?;
    let rate = supported.sample_rate();
    let config = supported.config();
    let heard = Arc::new(Mutex::new(Vec::new()));
    let shared = Arc::clone(&heard);
    let stream = match supported.sample_format() {
        SampleFormat::F32 => input_stream::<f32>(device, config, shared),
        SampleFormat::I16 => input_stream::<i16>(device, config, shared),
        SampleFormat::U16 => input_stream::<u16>(device, config, shared),
        SampleFormat::I32 => input_stream::<i32>(device, config, shared),
        SampleFormat::I8 => input_stream::<i8>(device, config, shared),
        SampleFormat::U8 => input_stream::<u8>(device, config, shared),
        _ => Err(Error::with_message(
            ErrorKind::UnsupportedConfig,
            "sample format",
        )),
    }?;
    stream.play()?;
    Ok(Capture {
        _stream: stream,
        #[cfg(target_os = "macos")]
        _tap: None,
        heard,
        rate,
    })
}

/// Every sample of a frame becomes one, whatever its channels and format
fn input_stream<T>(
    device: &Device,
    config: cpal::StreamConfig,
    heard: Arc<Mutex<Vec<f32>>>,
) -> Result<cpal::Stream, Error>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let channels = usize::from(config.channels).max(1);
    device.build_input_stream(
        config,
        move |data: &[T], _: &_| {
            if let Ok(mut heard) = heard.lock() {
                heard.extend(data.chunks(channels).map(|frame| {
                    frame.iter().map(|s| s.to_sample::<f32>()).sum::<f32>() / channels as f32
                }));
            }
        },
        // A late buffer (common as it starts) loses a few milliseconds and recording goes on
        |error| {
            if error.kind() != ErrorKind::Xrun {
                eprintln!("An audio stream failed: {error}");
            }
        },
        None,
    )
}

pub fn microphone_error(error: Error) -> String {
    match error.kind() {
        ErrorKind::PermissionDenied => t("native.dictation.noPermission"),
        ErrorKind::UnsupportedConfig => t("native.dictation.unsupported"),
        _ => t_with(
            "native.dictation.couldNotRecord",
            &[("error", &error.to_string())],
        ),
    }
}

pub fn system_sound_error(error: Error) -> String {
    match error.kind() {
        ErrorKind::PermissionDenied => t("native.meeting.noSystemPermission"),
        _ => t_with(
            "native.meeting.systemFailed",
            &[("error", &error.to_string())],
        ),
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    // Plays a system sound while recording what the computer plays. The first run asks to record other apps' audio
    // for the terminal; without it the tap is silent. cargo test records_what_plays -- --ignored --nocapture
    #[test]
    #[ignore = "needs sound and the permission to record other apps' audio"]
    fn records_what_plays_through_its_own_tap() {
        let capture = capture_system_sound().unwrap();
        let mut player = std::process::Command::new("/usr/bin/afplay")
            .arg("/System/Library/Sounds/Glass.aiff")
            .spawn()
            .unwrap();
        std::thread::sleep(std::time::Duration::from_secs(2));
        let _ = player.wait();
        let heard = capture.take();
        let loudest = heard.iter().fold(0.0f32, |most, s| most.max(s.abs()));
        println!(
            "{} samples at {} Hz, loudest {loudest}",
            heard.len(),
            capture.rate
        );
        assert!(!heard.is_empty());
        assert!(loudest > 0.01, "the tap heard only silence");
    }
}
