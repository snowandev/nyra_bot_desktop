//! Dictation: the microphone recorded here, in Rust, so it works the same on every system (the Linux WebView doesn't
//! give pages the microphone), and written with the Whisper that transcribes attached audio, on this computer.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{ErrorKind, FromSample, SampleFormat, SizedSample};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::i18n::{t, t_with};
use crate::speech_models::models_for;
use crate::transcription::{at_model_rate, transcribe, Loaded, Speakers};

// A dictation is a message, not a meeting: past this it stops by itself
const MAX_RECORDING: Duration = Duration::from_secs(10 * 60);
// How often the page hears how loud the voice is, for the button to move with it
const LEVEL_EVERY: Duration = Duration::from_millis(100);
// Less than this is a click on the button, not something said
const MIN_SECONDS: f32 = 0.3;
const START_TIMEOUT: Duration = Duration::from_secs(5);
// Whisper stays loaded this long after a dictation, for the next one to be written at once; then its memory (over
// 1 GB with turbo) is given back
const KEEP_LOADED: Duration = Duration::from_secs(5 * 60);
pub const LEVEL_EVENT: &str = "dictation-level";
pub const ENDED_EVENT: &str = "dictation-ended";

struct Captured {
    samples: Vec<f32>,
    rate: u32,
}

struct Recording {
    stop: Sender<()>,
    done: JoinHandle<Result<Captured, String>>,
}

/// Whisper loaded for a size, kept from one dictation to the next
struct Kept {
    size: String,
    loaded: Loaded,
}

/// One recording at a time, whichever window started it, and Whisper kept loaded while dictations follow each other
#[derive(Default)]
pub struct Dictation {
    recording: Mutex<Option<Recording>>,
    // Locked while loading or writing, so a dictation ending as it loads waits for it instead of loading it twice
    whisper: Mutex<Option<Kept>>,
    // Dropped by the user while it was being written: the next phrase stops it
    cancelled: AtomicBool,
    // Each dictation counts one, so letting Whisper go only happens if none came since
    uses: AtomicU64,
}

use crate::util::lock;

impl Dictation {
    fn take(&self) -> Option<Recording> {
        lock(&self.recording).take()
    }

    /// Runs with Whisper loaded for this size, loading what is missing; another size's goes first
    fn with_whisper<R>(&self, size: &str, use_it: impl FnOnce(&mut Loaded) -> R) -> R {
        let mut kept = lock(&self.whisper);
        if kept.as_ref().is_none_or(|kept| kept.size != size) {
            *kept = None;
        }
        let kept = kept.get_or_insert_with(|| Kept {
            size: size.to_string(),
            loaded: Loaded::default(),
        });
        use_it(&mut kept.loaded)
    }

    /// After KEEP_LOADED with no dictation, Whisper goes and frees its memory
    fn release_later(app: &AppHandle) {
        let dictation = app.state::<Dictation>();
        let turn = dictation.uses.fetch_add(1, Ordering::SeqCst) + 1;
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(KEEP_LOADED).await;
            let dictation = app.state::<Dictation>();
            if dictation.uses.load(Ordering::SeqCst) == turn {
                *lock(&dictation.whisper) = None;
            }
        });
    }
}

#[derive(Serialize, Clone)]
struct Level {
    level: f32,
}

fn microphone_error(error: cpal::Error) -> String {
    if error.kind() == ErrorKind::PermissionDenied {
        t("native.dictation.noPermission")
    } else {
        t_with(
            "native.dictation.couldNotRecord",
            &[("error", &error.to_string())],
        )
    }
}

/// Every sample of a frame becomes one, whatever its channels and format
fn input_stream<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    heard: Arc<Mutex<Vec<f32>>>,
) -> Result<cpal::Stream, cpal::Error>
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
                eprintln!("The microphone stream failed: {error}");
            }
        },
        None,
    )
}

/// How loud these samples are, from 0 to 1, as the button shows it
fn loudness(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let mean = samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32;
    (mean.sqrt() * 10.0).min(1.0)
}

/// Records until told to stop or the limit is reached; started says whether the microphone opened
fn record(
    app: AppHandle,
    stop: Receiver<()>,
    started: Sender<Result<(), String>>,
) -> Result<Captured, String> {
    let opened = (|| {
        let device = cpal::default_host()
            .default_input_device()
            .ok_or_else(|| t("native.dictation.noMicrophone"))?;
        let supported = device.default_input_config().map_err(microphone_error)?;
        let rate = supported.sample_rate();
        let config = supported.config();
        let heard = Arc::new(Mutex::new(Vec::new()));
        let shared = Arc::clone(&heard);
        let stream = match supported.sample_format() {
            SampleFormat::F32 => input_stream::<f32>(&device, config, shared),
            SampleFormat::I16 => input_stream::<i16>(&device, config, shared),
            SampleFormat::U16 => input_stream::<u16>(&device, config, shared),
            SampleFormat::I32 => input_stream::<i32>(&device, config, shared),
            SampleFormat::I8 => input_stream::<i8>(&device, config, shared),
            SampleFormat::U8 => input_stream::<u8>(&device, config, shared),
            _ => return Err(t("native.dictation.unsupported")),
        }
        .map_err(microphone_error)?;
        stream.play().map_err(microphone_error)?;
        Ok((stream, heard, rate))
    })();
    let (stream, heard, rate) = match opened {
        Ok(opened) => {
            let _ = started.send(Ok(()));
            opened
        }
        Err(error) => {
            let _ = started.send(Err(error.clone()));
            return Err(error);
        }
    };
    let deadline = Instant::now() + MAX_RECORDING;
    let mut told = 0;
    loop {
        match stop.recv_timeout(LEVEL_EVERY) {
            Ok(()) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {
                let level = heard
                    .lock()
                    .map(|samples| {
                        let level = loudness(&samples[told.min(samples.len())..]);
                        told = samples.len();
                        level
                    })
                    .unwrap_or(0.0);
                let _ = app.emit(LEVEL_EVENT, Level { level });
                if Instant::now() >= deadline {
                    // The page stops it as the user would, and gets what was said
                    let _ = app.emit(ENDED_EVENT, ());
                    break;
                }
            }
        }
    }
    drop(stream);
    let samples = heard
        .lock()
        .map(|mut s| std::mem::take(&mut *s))
        .unwrap_or_default();
    Ok(Captured { samples, rate })
}

/// Opens the microphone and starts recording. model: the Whisper size it will be written with, checked now so the
/// user doesn't speak for nothing.
#[tauri::command]
pub async fn dictation_start(
    app: AppHandle,
    state: State<'_, Dictation>,
    model: String,
) -> Result<(), String> {
    let models = models_for(&app, &model)?;
    let (started_tx, started) = mpsc::channel();
    {
        let mut recording = lock(&state.recording);
        if recording.is_some() {
            return Err(t("native.dictation.alreadyRecording"));
        }
        // Kept before the microphone answers, so a second start meanwhile finds it taken
        let (stop, stop_rx) = mpsc::channel();
        let recorder = app.clone();
        let done = std::thread::spawn(move || record(recorder, stop_rx, started_tx));
        *recording = Some(Recording { stop, done });
    }
    state.cancelled.store(false, Ordering::SeqCst);
    let opened = tauri::async_runtime::spawn_blocking(move || started.recv_timeout(START_TIMEOUT))
        .await
        .map_err(|_| t("native.dictation.couldNotRecord"))?;
    match opened {
        Ok(Ok(())) => {
            // Loaded while the user speaks, so what they said is written as soon as they stop
            state.uses.fetch_add(1, Ordering::SeqCst);
            let loader = app.clone();
            std::thread::spawn(move || {
                loader
                    .state::<Dictation>()
                    .with_whisper(&model, |loaded| loaded.prepare(&models))
            });
            Ok(())
        }
        failed => {
            if let Some(recording) = state.take() {
                let _ = recording.stop.send(());
            }
            match failed {
                Ok(Err(error)) => Err(error),
                _ => Err(t("native.dictation.noMicrophone")),
            }
        }
    }
}

/// Stops recording and writes what was said, in whatever language; empty if nothing was
#[tauri::command]
pub async fn dictation_stop(
    app: AppHandle,
    state: State<'_, Dictation>,
    model: String,
) -> Result<String, String> {
    let recording = state
        .take()
        .ok_or_else(|| t("native.dictation.notRecording"))?;
    let written = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || {
            let _ = recording.stop.send(());
            let captured = recording
                .done
                .join()
                .map_err(|_| t("native.dictation.couldNotRecord"))??;
            if (captured.samples.len() as f32) < captured.rate as f32 * MIN_SECONDS {
                return Ok(String::new());
            }
            let models = models_for(&app, &model)?;
            let samples = at_model_rate(captured.samples, captured.rate)?;
            let dictation = app.state::<Dictation>();
            let lines = dictation.with_whisper(&model, |loaded| {
                transcribe(
                    std::sync::Arc::new(samples),
                    &models,
                    loaded,
                    Speakers::Off,
                    |_, _| !dictation.cancelled.load(Ordering::SeqCst),
                )
            })?;
            Ok(lines
                .iter()
                .map(|line| line.text.trim())
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>()
                .join(" "))
        }
    })
    .await
    .map_err(|_| t("native.dictation.couldNotRecord"))?;
    Dictation::release_later(&app);
    written
}

/// Drops the dictation: stops the recording and forgets what was heard, or stops writing it at the next phrase
#[tauri::command]
pub fn dictation_cancel(state: State<'_, Dictation>) {
    match state.take() {
        Some(recording) => {
            let _ = recording.stop.send(());
            std::thread::spawn(move || recording.done.join());
        }
        None => state.cancelled.store(true, Ordering::SeqCst),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // With the real models in NYRA_SPEECH_MODELS (small among them), a 16 kHz recording in NYRA_SPEECH_SAMPLE and the
    // size in NYRA_WHISPER_SIZE: the second dictation reuses what the first loaded.
    // cargo test keeps_whisper_loaded -- --ignored --nocapture
    #[test]
    #[ignore = "needs the speech models and a recording"]
    fn keeps_whisper_loaded_between_dictations() {
        use std::path::PathBuf;
        let dir = PathBuf::from(std::env::var("NYRA_SPEECH_MODELS").expect("models"));
        let size = std::env::var("NYRA_WHISPER_SIZE").unwrap_or_else(|_| "small".into());
        let models = crate::transcription::SpeechModels {
            // A folder of a community model in Transformers' format, or the name of a size in sherpa-onnx's
            whisper: if dir.join(&size).is_dir() {
                crate::transcription::WhisperFiles::Transformers(dir.join(&size))
            } else {
                crate::transcription::WhisperFiles::Onnx {
                    encoder: dir.join(format!("{size}-encoder.int8.onnx")),
                    decoder: dir.join(format!("{size}-decoder.int8.onnx")),
                    tokens: dir.join(format!("{size}-tokens.txt")),
                }
            },
            language_encoder: dir.join("small-encoder.int8.onnx"),
            language_decoder: dir.join("small-decoder.int8.onnx"),
            vad: dir.join("silero_vad.onnx"),
            segmentation: dir.join("speaker-segmentation.onnx"),
            embedding: dir.join("speaker-embedding-campplus.onnx"),
        };
        let bytes = std::fs::read(std::env::var("NYRA_SPEECH_SAMPLE").expect("recording")).unwrap();
        let samples =
            std::sync::Arc::new(crate::transcription::read_audio(bytes, Some("wav")).unwrap());
        let dictation = Dictation::default();
        let mut times = Vec::new();
        for _ in 0..2 {
            let started = Instant::now();
            let lines = dictation
                .with_whisper(&size, |loaded| {
                    transcribe(
                        std::sync::Arc::clone(&samples),
                        &models,
                        loaded,
                        Speakers::Off,
                        |_, _| true,
                    )
                })
                .unwrap();
            times.push(started.elapsed());
            println!("{:?}: {}", started.elapsed(), lines[0].text);
        }
        assert!(times[1] < times[0], "{times:?}");
    }

    #[test]
    fn tells_silence_from_a_voice() {
        assert_eq!(loudness(&[]), 0.0);
        assert_eq!(loudness(&[0.0; 100]), 0.0);
        let voice: Vec<f32> = (0..1600).map(|i| (i as f32 * 0.05).sin() * 0.05).collect();
        let level = loudness(&voice);
        assert!(level > 0.2 && level <= 1.0, "{level}");
        assert_eq!(loudness(&[1.0; 10]), 1.0);
    }
}
