//! Recording a meeting: the microphone and what the computer plays, side by side in one WAV file (the user on the
//! left, the others on the right), so the transcript can tell the user's words from the rest. Written as it is heard,
//! so a recording cut short keeps what was said until then.

use std::fs::{self, File};
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Serialize;
use sherpa_onnx::LinearResampler;
use tauri::{AppHandle, Emitter, State};

use crate::audio_devices::{capture, capture_system_sound, microphone, microphone_error, Capture};
use crate::i18n::t;
use crate::transcription::{audio_file, stored_now, MAX_SECONDS, SAMPLE_RATE};
use crate::util::{lock, to_message};

const RATE: usize = SAMPLE_RATE as usize;
const WRITE_EVERY: Duration = Duration::from_millis(500);
// Sound arrives in bursts, and the computer's not at all while nothing plays (on Windows): each side is written this
// far behind the clock, and what is still missing by then as silence, so both stay together
const BEHIND: usize = RATE;
// A device running a little fast gets ahead of the clock; past this much, what is ahead goes
const MAX_AHEAD: usize = 2 * RATE;
const START_TIMEOUT: Duration = Duration::from_secs(5);
pub const ENDED_EVENT: &str = "meeting-ended";

struct Recording {
    id: String,
    stop: Sender<()>,
    // How many frames it wrote
    done: JoinHandle<Result<u64, String>>,
}

/// One meeting recorded at a time
#[derive(Default)]
pub struct Meeting {
    recording: Mutex<Option<Recording>>,
}

/// systemError: why the computer's sound couldn't be recorded, when only the microphone is
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    system_error: Option<String>,
}

/// The recording, stored as an attached audio is, and how long it lasts in seconds
#[derive(Serialize)]
pub struct Recorded {
    id: String,
    duration: f32,
}

/// What one source heard, at the models' rate, not written yet
struct Side {
    capture: Option<Capture>,
    resampler: Option<LinearResampler>,
    ready: Vec<f32>,
}

impl Side {
    fn new(capture: Option<Capture>) -> Result<Self, String> {
        let rate = capture.as_ref().map_or(SAMPLE_RATE, |c| c.rate as i32);
        let resampler = if rate == SAMPLE_RATE {
            None
        } else {
            Some(
                LinearResampler::create(rate, SAMPLE_RATE)
                    .ok_or_else(|| t("native.dictation.unsupported"))?,
            )
        };
        Ok(Side {
            capture,
            resampler,
            ready: Vec::new(),
        })
    }

    fn gather(&mut self) {
        let Some(capture) = &self.capture else { return };
        let heard = capture.take();
        match &self.resampler {
            Some(resampler) => self.ready.extend(resampler.resample(&heard, false)),
            None => self.ready.extend(heard),
        }
    }
}

/// The next frames of a side: what it has, and silence for what it lacks. What is too far ahead of the clock goes
/// first, so the two sides never drift apart.
fn next_frames(ready: &mut Vec<f32>, need: usize) -> Vec<f32> {
    if ready.len() > need + MAX_AHEAD {
        ready.drain(..ready.len() - need - MAX_AHEAD);
    }
    let mut frames: Vec<f32> = ready.drain(..need.min(ready.len())).collect();
    frames.resize(need, 0.0);
    frames
}

/// A 16-bit stereo WAV at the models' rate. Its header says how long it is and is updated as it grows, so a
/// recording cut short is still a file that opens.
struct WavFile {
    file: File,
    frames: u64,
}

impl WavFile {
    fn create(path: &Path) -> std::io::Result<Self> {
        let mut file = File::create(path)?;
        file.write_all(&wav_header(0))?;
        Ok(WavFile { file, frames: 0 })
    }

    fn append(&mut self, left: &[f32], right: &[f32]) -> std::io::Result<()> {
        self.file.seek(SeekFrom::End(0))?;
        self.file.write_all(&interleaved(left, right))?;
        self.frames += left.len() as u64;
        self.file.seek(SeekFrom::Start(0))?;
        self.file.write_all(&wav_header(self.frames))
    }
}

fn wav_header(frames: u64) -> [u8; 44] {
    const CHANNELS: u16 = 2;
    const BYTES_PER_FRAME: u32 = 4;
    let data = u32::try_from(frames * u64::from(BYTES_PER_FRAME)).unwrap_or(u32::MAX - 36);
    let mut header = [0u8; 44];
    let parts: [&[u8]; 13] = [
        b"RIFF",
        &(36 + data).to_le_bytes(),
        b"WAVEfmt ",
        &16u32.to_le_bytes(),
        // Plain PCM
        &1u16.to_le_bytes(),
        &CHANNELS.to_le_bytes(),
        &(RATE as u32).to_le_bytes(),
        &(RATE as u32 * BYTES_PER_FRAME).to_le_bytes(),
        &(BYTES_PER_FRAME as u16).to_le_bytes(),
        &16u16.to_le_bytes(),
        b"data",
        &data.to_le_bytes(),
        &[],
    ];
    let mut at = 0;
    for part in parts {
        header[at..at + part.len()].copy_from_slice(part);
        at += part.len();
    }
    header
}

fn interleaved(left: &[f32], right: &[f32]) -> Vec<u8> {
    let sample = |s: f32| ((s.clamp(-1.0, 1.0) * f32::from(i16::MAX)) as i16).to_le_bytes();
    left.iter()
        .zip(right)
        .flat_map(|(l, r)| [sample(*l), sample(*r)])
        .flatten()
        .collect()
}

/// Opens the microphone and the computer's sound, then writes both to the file until told to stop or the limit is
/// reached. started: whether it began, and why the computer's sound is missing if it is.
fn record(
    app: AppHandle,
    path: PathBuf,
    chosen: Option<String>,
    stop: Receiver<()>,
    started: Sender<Result<Option<String>, String>>,
) -> Result<u64, String> {
    let opened = (|| -> Result<_, String> {
        let mic = microphone(chosen.as_deref())
            .and_then(|device| capture(&device).map_err(microphone_error))?;
        let (computer, system_error) = match capture_system_sound() {
            Ok(computer) => (Some(computer), None),
            Err(error) => (None, Some(error)),
        };
        let file = WavFile::create(&path).map_err(to_message)?;
        Ok((
            [Side::new(Some(mic))?, Side::new(computer)?],
            file,
            system_error,
        ))
    })();
    let (mut sides, mut file) = match opened {
        Ok((sides, file, system_error)) => {
            let _ = started.send(Ok(system_error));
            (sides, file)
        }
        Err(error) => {
            let _ = started.send(Err(error.clone()));
            return Err(error);
        }
    };
    let began = Instant::now();
    let limit = Duration::from_secs_f32(MAX_SECONDS);
    loop {
        let finishing = !matches!(
            stop.recv_timeout(WRITE_EVERY),
            Err(RecvTimeoutError::Timeout)
        );
        let elapsed = began.elapsed();
        let reached = elapsed >= limit;
        let clock = (elapsed.as_secs_f64() * RATE as f64) as u64;
        let until = if finishing || reached {
            clock
        } else {
            clock.saturating_sub(BEHIND as u64)
        };
        sides.iter_mut().for_each(Side::gather);
        let need = until.saturating_sub(file.frames) as usize;
        if need > 0 {
            let [mine, theirs] = &mut sides;
            let left = next_frames(&mut mine.ready, need);
            let right = next_frames(&mut theirs.ready, need);
            file.append(&left, &right).map_err(to_message)?;
        }
        if reached {
            // The page stops it as the user would, and gets the recording
            let _ = app.emit(ENDED_EVENT, ());
        }
        if finishing || reached {
            return Ok(file.frames);
        }
    }
}

/// Starts recording a meeting into the stored audio with this id. microphone: the one chosen in Settings; none is
/// the system's.
#[tauri::command]
pub async fn meeting_start(
    app: AppHandle,
    state: State<'_, Meeting>,
    id: String,
    microphone: Option<String>,
) -> Result<Started, String> {
    let path = audio_file(&app, &id, "wav")?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(to_message)?;
    }
    let (started_tx, started) = mpsc::channel();
    {
        let mut recording = lock(&state.recording);
        if recording.is_some() {
            return Err(t("native.meeting.alreadyRecording"));
        }
        let (stop, stop_rx) = mpsc::channel();
        let recorder = app.clone();
        let file = path.clone();
        let done =
            std::thread::spawn(move || record(recorder, file, microphone, stop_rx, started_tx));
        *recording = Some(Recording {
            id: id.clone(),
            stop,
            done,
        });
    }
    let opened = tauri::async_runtime::spawn_blocking(move || started.recv_timeout(START_TIMEOUT))
        .await
        .map_err(|_| t("native.dictation.couldNotRecord"))?;
    match opened {
        Ok(Ok(system_error)) => {
            stored_now(&app, id);
            Ok(Started { system_error })
        }
        failed => {
            if let Some(recording) = lock(&state.recording).take() {
                let _ = recording.stop.send(());
            }
            let _ = fs::remove_file(&path);
            match failed {
                Ok(Err(error)) => Err(error),
                _ => Err(t("native.dictation.noMicrophone")),
            }
        }
    }
}

fn finish(recording: Recording) -> Result<u64, String> {
    let _ = recording.stop.send(());
    recording
        .done
        .join()
        .map_err(|_| t("native.dictation.couldNotRecord"))?
}

/// Stops recording and gives the stored audio
#[tauri::command]
pub async fn meeting_stop(state: State<'_, Meeting>) -> Result<Recorded, String> {
    let recording = lock(&state.recording)
        .take()
        .ok_or_else(|| t("native.meeting.notRecording"))?;
    let id = recording.id.clone();
    let frames = tauri::async_runtime::spawn_blocking(move || finish(recording))
        .await
        .map_err(|_| t("native.dictation.couldNotRecord"))??;
    Ok(Recorded {
        id,
        duration: frames as f32 / RATE as f32,
    })
}

/// Stops recording and throws it away
#[tauri::command]
pub async fn meeting_discard(app: AppHandle, state: State<'_, Meeting>) -> Result<(), String> {
    let Some(recording) = lock(&state.recording).take() else {
        return Ok(());
    };
    let path = audio_file(&app, &recording.id, "wav")?;
    let _ = tauri::async_runtime::spawn_blocking(move || finish(recording)).await;
    let _ = fs::remove_file(path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fills_what_a_side_lacks_with_silence_and_drops_what_runs_ahead() {
        let mut ready = vec![0.5; 3];
        assert_eq!(next_frames(&mut ready, 5), [0.5, 0.5, 0.5, 0.0, 0.0]);
        assert!(ready.is_empty());
        let mut ahead: Vec<f32> = (0..MAX_AHEAD + 10).map(|i| i as f32).collect();
        let frames = next_frames(&mut ahead, 4);
        // The oldest that ran ahead went; what is left is never more than MAX_AHEAD
        assert_eq!(frames, [6.0, 7.0, 8.0, 9.0]);
        assert_eq!(ahead.len(), MAX_AHEAD);
    }

    #[test]
    fn writes_a_stereo_wav_that_the_transcription_reads_side_by_side() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("reunion.wav");
        let mut file = WavFile::create(&path).unwrap();
        let second = RATE;
        file.append(&vec![0.25; second], &vec![-0.5; second])
            .unwrap();
        file.append(&vec![0.25; second], &vec![-0.5; second])
            .unwrap();
        let tracks = crate::transcription::tests::tracks_of(&path);
        assert_eq!(tracks.len(), 2);
        assert_eq!(tracks[0].len(), 2 * second);
        assert!((tracks[0][100] - 0.25).abs() < 0.001);
        assert!((tracks[1][100] + 0.5).abs() < 0.001);
    }
}
