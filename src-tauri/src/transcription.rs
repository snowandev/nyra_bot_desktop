//! Transcribing audio on this computer, with no service in between: the audio is read and brought to 16 kHz mono, a
//! voice detector cuts it into phrases (which give the times), Whisper writes each one in whatever language it is, and,
//! when asked, a speaker model tells the voices apart.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use crate::whisper_transformers::TransformersWhisper;
use serde::Serialize;
use sherpa_onnx::{
    FastClusteringConfig, LinearResampler, OfflineModelConfig, OfflineRecognizer,
    OfflineRecognizerConfig, OfflineSpeakerDiarization, OfflineSpeakerDiarizationConfig,
    OfflineSpeakerDiarizationSegment, OfflineSpeakerSegmentationModelConfig,
    OfflineSpeakerSegmentationPyannoteModelConfig, OfflineWhisperModelConfig, SileroVadModelConfig,
    SpeakerEmbeddingExtractorConfig, SpokenLanguageIdentification,
    SpokenLanguageIdentificationConfig, SpokenLanguageIdentificationWhisperConfig, VadModelConfig,
    VoiceActivityDetector,
};
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as AudioError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::{MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::meta::MetadataOptions;

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Manager};

use crate::i18n::t;
use crate::speech_models::models_for;
use crate::storage::Database;
use crate::util::{data_dir, is_plain_id, to_message};

// What every model here takes
const SAMPLE_RATE: i32 = 16_000;
// Whisper hears 30 seconds at a time; phrases are cut a little shorter so none loses its end
const MAX_PHRASE_SECONDS: f32 = 28.0;
// Whispers writing at once in a whole transcription: each holds its own copy, so a large one (turbo, about 1 GB
// loaded) gets fewer. Measured with an 8-minute recording on 8 cores: small went from 57 s to 45 s with three.
const WRITERS: usize = 3;
const LARGE_WRITERS: usize = 2;
const LARGE_ENCODER_BYTES: u64 = 300 * 1024 * 1024;

fn writers_for(models: &SpeechModels) -> usize {
    match &models.whisper {
        WhisperFiles::Onnx { encoder, .. }
            if fs::metadata(encoder).map_or(0, |m| m.len()) > LARGE_ENCODER_BYTES =>
        {
            LARGE_WRITERS
        }
        WhisperFiles::Onnx { .. } => WRITERS,
        // One at a time: on a Mac it takes the graphics chip, elsewhere candle already uses every core
        WhisperFiles::Transformers(_) => 1,
    }
}
// The detector's step, as the Silero model expects it
const VAD_WINDOW: usize = 512;
// The detector misses a first word said right at the start (a dictation started mid-word): it hears this much silence
// first
const LEAD_IN_SECONDS: f32 = 0.5;
// How far apart two voices are to count as two speakers, when the user didn't say how many there are. Measured with five
// voice models: none told a single noisy voice from two clear ones every time, so the guess leans on joining voices
// (an 8-minute recording of one voice gives 2, not 30), and the user's number, when given, decides.
const CLUSTER_THRESHOLD: f32 = 0.8;
// A "speaker" heard this little is noise or a scrap of someone else: their phrases go to whoever spoke before
const MIN_SPEAKER_SECONDS: f32 = 5.0;
const MIN_SPEAKER_SHARE: f32 = 0.03;
// Whisper guesses the language of each phrase on its own, and a short or noisy one passes for another (Spanish written
// as Korean or Japanese). The languages of the audio are told by its longest phrases, where the guess is sound: with one,
// every phrase is written in it; with more (a bilingual interview), each phrase long enough to tell goes in whichever
// of them it is, and a short one in the main one.
const LANGUAGE_SAMPLES: usize = 8;
// A language heard in less than this share of those phrases is a wrong guess, not one spoken
const MIN_LANGUAGE_SHARE: f32 = 0.15;
// Each language loads its own Whisper: a few at most
const MAX_LANGUAGES: usize = 3;
const MIN_SECONDS_TO_TELL: f32 = 2.0;
// Phrases of one speaker closer than this read as one line
const JOIN_GAP_SECONDS: f32 = 1.5;
// A long recording, kept in memory while it is transcribed: four hours are about 900 MB of samples
const MAX_AUDIO_BYTES: usize = 1024 * 1024 * 1024;
const MAX_SECONDS: f32 = 4.0 * 3600.0;
pub const PROGRESS_EVENT: &str = "transcription-progress";

/// Where a transcription is, for the composer to show it
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Reading,
    Speakers,
    Transcribing,
}

/// The Whisper that writes: in sherpa-onnx's format, or in Transformers' (the community's), by its folder
#[derive(Clone)]
pub enum WhisperFiles {
    Onnx {
        encoder: PathBuf,
        decoder: PathBuf,
        tokens: PathBuf,
    },
    Transformers(PathBuf),
}

/// Where each model is, once downloaded
#[derive(Clone)]
pub struct SpeechModels {
    pub whisper: WhisperFiles,
    // A Whisper of 80 mel bands, which the language identifier reads; turbo's has 128
    pub language_encoder: PathBuf,
    pub language_decoder: PathBuf,
    pub vad: PathBuf,
    // Only to tell speakers apart
    pub segmentation: PathBuf,
    pub embedding: PathBuf,
}

/// One line of the transcript: when it starts and ends, in seconds, who speaks (from 1) when speakers were told apart,
/// and what they say
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct TranscriptLine {
    pub start: f32,
    pub end: f32,
    pub speaker: Option<u32>,
    pub text: String,
}

/// A phrase the detector found, by its samples
struct Phrase {
    start: usize,
    samples: Vec<f32>,
}

fn path(path: &std::path::Path) -> Option<String> {
    Some(path.to_string_lossy().into_owned())
}

fn threads() -> i32 {
    std::thread::available_parallelism()
        .map(|n| n.get().min(8) as i32)
        .unwrap_or(2)
}

// Whisper's share of the cores while the speakers are told apart at the same time, out of 8: both asking for all of
// them made it slower than one after the other
const WRITING_SHARE: i32 = 6;

/// The threads for writing and for telling speakers apart when both run at once
fn shared_threads() -> (i32, i32) {
    let all = threads();
    let writing = ((all * WRITING_SHARE + 4) / 8).max(1);
    (writing, (all - writing).max(1))
}

/// The audio of a file as 16 kHz mono samples. extension: the file's, which helps tell its format.
pub fn read_audio(bytes: Vec<u8>, extension: Option<&str>) -> Result<Vec<f32>, String> {
    decode_audio(Box::new(Cursor::new(bytes)), extension)
}

/// The same, read from the file as it decodes: a long WAV is gigabytes that never need to be in memory at once
pub fn read_audio_file(
    path: &std::path::Path,
    extension: Option<&str>,
) -> Result<Vec<f32>, String> {
    let file = fs::File::open(path).map_err(|_| t("native.transcription.gone"))?;
    decode_audio(Box::new(file), extension)
}

fn decode_audio(
    source: Box<dyn symphonia::core::io::MediaSource>,
    extension: Option<&str>,
) -> Result<Vec<f32>, String> {
    let unreadable = || t("native.transcription.unreadable");
    let stream = MediaSourceStream::new(source, MediaSourceStreamOptions::default());
    let mut hint = Hint::new();
    if let Some(extension) = extension {
        hint.with_extension(extension);
    }
    let mut format = symphonia::default::get_probe()
        .probe(
            &hint,
            stream,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|_| unreadable())?;
    let track = format
        .default_track(TrackType::Audio)
        .ok_or_else(unreadable)?;
    let track_id = track.id;
    let params = track
        .codec_params
        .as_ref()
        .and_then(|params| params.audio())
        .ok_or_else(unreadable)?
        .clone();
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&params, &AudioDecoderOptions::default())
        .map_err(|_| unreadable())?;
    // Mixed to mono and brought to the models' rate packet by packet: the whole audio at its own rate (often 44.1 or
    // 48 kHz) was the largest copy of a long recording
    let mut out = Vec::new();
    let mut resampling: Option<Option<LinearResampler>> = None;
    let mut frame = Vec::<f32>::new();
    let mut mixed = Vec::<f32>::new();
    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            Err(AudioError::ResetRequired) => break,
            Err(_) => return Err(unreadable()),
        };
        if packet.track_id != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            // A damaged packet is skipped, as players do; the rest of the audio is still worth having
            Err(AudioError::DecodeError(_)) => continue,
            Err(_) => return Err(unreadable()),
        };
        let channels = decoded.spec().channels().count().max(1);
        let rate = decoded.spec().rate();
        if rate == 0 {
            return Err(t("native.transcription.noAudio"));
        }
        decoded.copy_to_vec_interleaved(&mut frame);
        mixed.clear();
        mixed.extend(
            frame
                .chunks(channels)
                .map(|samples| samples.iter().sum::<f32>() / channels as f32),
        );
        // Known from the first packet; a resampler keeps its state between packets
        if resampling.is_none() {
            resampling = Some(if rate as i32 == SAMPLE_RATE {
                None
            } else {
                Some(LinearResampler::create(rate as i32, SAMPLE_RATE).ok_or_else(unreadable)?)
            });
        }
        match resampling.as_ref().and_then(Option::as_ref) {
            Some(resampler) => out.extend(resampler.resample(&mixed, false)),
            None => out.extend_from_slice(&mixed),
        }
    }
    if let Some(Some(resampler)) = &resampling {
        out.extend(resampler.resample(&[], true));
    }
    if out.is_empty() {
        return Err(t("native.transcription.noAudio"));
    }
    Ok(out)
}

/// Mono samples at the rate every model here takes
pub fn at_model_rate(mono: Vec<f32>, rate: u32) -> Result<Vec<f32>, String> {
    if rate as i32 == SAMPLE_RATE {
        return Ok(mono);
    }
    let resampler = LinearResampler::create(rate as i32, SAMPLE_RATE)
        .ok_or_else(|| t("native.transcription.unreadable"))?;
    Ok(resampler.resample(&mono, true))
}

/// Where someone speaks, cut into phrases Whisper can take whole
fn phrases(samples: &[f32], models: &SpeechModels) -> Result<Vec<Phrase>, String> {
    let config = VadModelConfig {
        silero_vad: SileroVadModelConfig {
            model: path(&models.vad),
            threshold: 0.5,
            min_silence_duration: 0.4,
            min_speech_duration: 0.25,
            window_size: VAD_WINDOW as i32,
            max_speech_duration: MAX_PHRASE_SECONDS,
        },
        sample_rate: SAMPLE_RATE,
        num_threads: 1,
        ..Default::default()
    };
    let seconds = samples.len() as f32 / SAMPLE_RATE as f32;
    // Segments are taken out as they end, so it only ever holds the one being spoken; it grows if one is longer
    let buffer = (2.0 * MAX_PHRASE_SECONDS + LEAD_IN_SECONDS).min(seconds + 1.0 + LEAD_IN_SECONDS);
    let detector = VoiceActivityDetector::create(&config, buffer)
        .ok_or_else(|| t("native.transcription.modelFailed"))?;
    let lead_in = (LEAD_IN_SECONDS * SAMPLE_RATE as f32) as usize;
    let mut found = Vec::new();
    let mut take = |detector: &VoiceActivityDetector| {
        while let Some(segment) = detector.front() {
            found.push(Phrase {
                start: (segment.start().max(0) as usize).saturating_sub(lead_in),
                samples: segment.samples().to_vec(),
            });
            detector.pop();
        }
    };
    // Its times count from the audio's own start
    for window in vec![0.0; lead_in].chunks(VAD_WINDOW) {
        detector.accept_waveform(window);
    }
    for window in samples.chunks(VAD_WINDOW) {
        detector.accept_waveform(window);
        take(&detector);
    }
    detector.flush();
    take(&detector);
    Ok(found)
}

fn language_identifier(models: &SpeechModels) -> Option<SpokenLanguageIdentification> {
    SpokenLanguageIdentification::create(&SpokenLanguageIdentificationConfig {
        whisper: SpokenLanguageIdentificationWhisperConfig {
            encoder: path(&models.language_encoder),
            decoder: path(&models.language_decoder),
            tail_paddings: -1,
        },
        num_threads: threads(),
        ..Default::default()
    })
}

/// Whisper's code for the language of some speech ("es")
fn language_in(identifier: &SpokenLanguageIdentification, samples: &[f32]) -> Option<String> {
    let stream = identifier.create_stream();
    stream.accept_waveform(SAMPLE_RATE, samples);
    identifier
        .compute(&stream)
        .map(|result| result.lang)
        .filter(|lang| !lang.is_empty())
}

/// The languages spoken in the audio, by its longest phrases, each counting for its length, most heard first; empty if
/// they can't be told
fn languages_of(found: &[Phrase], identifier: &SpokenLanguageIdentification) -> Vec<String> {
    let mut longest: Vec<&Phrase> = found.iter().collect();
    longest.sort_by_key(|phrase| std::cmp::Reverse(phrase.samples.len()));
    let mut votes: HashMap<String, usize> = HashMap::new();
    for phrase in longest.into_iter().take(LANGUAGE_SAMPLES) {
        if let Some(language) = language_in(identifier, &phrase.samples) {
            *votes.entry(language).or_default() += phrase.samples.len();
        }
    }
    let total: usize = votes.values().sum();
    let mut heard: Vec<(String, usize)> = votes
        .into_iter()
        .filter(|(_, weight)| *weight as f32 >= total as f32 * MIN_LANGUAGE_SHARE)
        .collect();
    heard.sort_by_key(|(_, weight)| std::cmp::Reverse(*weight));
    heard
        .into_iter()
        .take(MAX_LANGUAGES)
        .map(|(language, _)| language)
        .collect()
}

/// One Whisper loaded to write phrases, by the engine its format needs
enum Writer {
    Onnx(OfflineRecognizer),
    Transformers(Box<TransformersWhisper>),
}

/// language: Whisper's code, or empty to let it guess each phrase
fn recognizer(models: &SpeechModels, language: &str, threads: i32) -> Result<Writer, String> {
    let (encoder, decoder, tokens) = match &models.whisper {
        WhisperFiles::Onnx {
            encoder,
            decoder,
            tokens,
        } => (encoder, decoder, tokens),
        WhisperFiles::Transformers(dir) => {
            return Ok(Writer::Transformers(Box::new(TransformersWhisper::load(
                dir,
            )?)))
        }
    };
    let config = OfflineRecognizerConfig {
        model_config: OfflineModelConfig {
            whisper: OfflineWhisperModelConfig {
                encoder: path(encoder),
                decoder: path(decoder),
                // As said, never translated
                language: Some(language.to_string()),
                task: Some("transcribe".to_string()),
                tail_paddings: -1,
                ..Default::default()
            },
            tokens: path(tokens),
            num_threads: threads,
            ..Default::default()
        },
        ..Default::default()
    };
    OfflineRecognizer::create(&config)
        .map(Writer::Onnx)
        .ok_or_else(|| t("native.transcription.modelFailed"))
}

/// Whether to tell speakers apart, and how many there are when the user said so
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Speakers {
    Off,
    Guess,
    Exactly(u32),
}

// More than this is a wrong number, not a meeting Nyra can tell apart
const MAX_SPEAKERS: u32 = 20;

impl Speakers {
    /// told: whether the user wants them told apart; count: how many the user said speak. One voice needs no telling.
    pub fn from(told: bool, count: Option<u32>) -> Self {
        match (told, count) {
            (false, _) | (true, Some(0 | 1)) => Speakers::Off,
            (true, Some(count)) => Speakers::Exactly(count.min(MAX_SPEAKERS)),
            (true, None) => Speakers::Guess,
        }
    }
}

fn diarization(
    models: &SpeechModels,
    count: Option<u32>,
    threads: i32,
) -> Result<OfflineSpeakerDiarization, String> {
    let config = OfflineSpeakerDiarizationConfig {
        segmentation: OfflineSpeakerSegmentationModelConfig {
            pyannote: OfflineSpeakerSegmentationPyannoteModelConfig {
                model: path(&models.segmentation),
                ..Default::default()
            },
            num_threads: threads,
            ..Default::default()
        },
        embedding: SpeakerEmbeddingExtractorConfig {
            model: path(&models.embedding),
            num_threads: threads,
            ..Default::default()
        },
        // With the number the user gave, the voices are shared out among that many; without it, voices closer than
        // the threshold count as one
        clustering: FastClusteringConfig {
            num_clusters: count.map_or(-1, |count| count as i32),
            threshold: CLUSTER_THRESHOLD,
            ..Default::default()
        },
        ..Default::default()
    };
    OfflineSpeakerDiarization::create(&config).ok_or_else(|| t("native.transcription.modelFailed"))
}

/// The speaker who talks the longest during a phrase, numbered from 1 in the order they first speak
fn speaker_of(
    start: f32,
    end: f32,
    turns: &[OfflineSpeakerDiarizationSegment],
    order: &[i32],
) -> Option<u32> {
    let mut best: Option<(i32, f32)> = None;
    for turn in turns {
        let overlap = end.min(turn.end) - start.max(turn.start);
        if overlap > 0.0 && best.is_none_or(|(_, longest)| overlap > longest) {
            best = Some((turn.speaker, overlap));
        }
    }
    best.and_then(|(speaker, _)| order.iter().position(|s| *s == speaker))
        .map(|i| i as u32 + 1)
}

/// The turns of those who really speak: someone heard only a few seconds is left out
fn real_speakers(
    turns: Vec<OfflineSpeakerDiarizationSegment>,
) -> Vec<OfflineSpeakerDiarizationSegment> {
    let mut talk: std::collections::HashMap<i32, f32> = std::collections::HashMap::new();
    for turn in &turns {
        *talk.entry(turn.speaker).or_default() += turn.end - turn.start;
    }
    let total: f32 = talk.values().sum();
    let heard = |speaker: i32| {
        let seconds = talk.get(&speaker).copied().unwrap_or(0.0);
        seconds >= MIN_SPEAKER_SECONDS || seconds >= total * MIN_SPEAKER_SHARE
    };
    turns
        .into_iter()
        .filter(|turn| heard(turn.speaker))
        .collect()
}

/// Whisper as loaded for one size: the language identifier and a recognizer per language heard. Loading them takes
/// seconds (turbo is about 1 GB): a transcription loads its own and lets them go, dictation keeps them for the next one.
#[derive(Default)]
pub struct Loaded {
    identifier: Option<SpokenLanguageIdentification>,
    recognizers: HashMap<String, Writer>,
}

impl Loaded {
    /// What any audio needs before its languages are known; the recognizers of languages heard before stay
    pub fn prepare(&mut self, models: &SpeechModels) {
        if self.identifier.is_none() {
            self.identifier = language_identifier(models);
        }
    }
}

type Turns = Vec<OfflineSpeakerDiarizationSegment>;

/// Tells the speakers apart in a thread of its own while Whisper writes, instead of before (it took a third of the
/// time with small). With its own copy of the audio, so a stopped transcription returns at once and leaves it to end
/// by itself: sherpa-onnx can't stop it halfway.
fn speakers_meanwhile(
    samples: Arc<Vec<f32>>,
    models: &SpeechModels,
    speakers: Speakers,
    threads: i32,
) -> Option<JoinHandle<Result<Turns, String>>> {
    let count = match speakers {
        Speakers::Off => return None,
        Speakers::Exactly(count) => Some(count),
        Speakers::Guess => None,
    };
    // Shared with Whisper rather than copied: an hour of audio is hundreds of megabytes
    let models = models.clone();
    Some(std::thread::spawn(move || {
        let turns = diarization(&models, count, threads)?
            .process(&samples)
            .map(|result| result.sort_by_start_time())
            .unwrap_or_default();
        // With the number the user gave, every voice found is one of those they meant
        Ok(if count.is_some() {
            turns
        } else {
            real_speakers(turns)
        })
    }))
}

/// A phrase as Whisper wrote it, before it has a speaker
struct Written {
    start: f32,
    end: f32,
    text: String,
}

/// What is said in the audio, line by line with its times. loaded: Whisper as loaded so far, kept loading what it
/// needs. speakers: tell the voices apart. progress: the stage and how far it is, from 0 to 1; false stops it.
pub fn transcribe(
    samples: Arc<Vec<f32>>,
    models: &SpeechModels,
    loaded: &mut Loaded,
    speakers: Speakers,
    progress: impl Fn(Stage, f32) -> bool,
) -> Result<Vec<TranscriptLine>, String> {
    let stopped = || t("native.transcription.cancelled");
    let found = phrases(&samples, models)?;
    // Both at once share the cores instead of fighting over them; alone, Whisper has them all
    let (writing_threads, telling_threads) = if speakers == Speakers::Off {
        (threads(), 0)
    } else {
        shared_threads()
    };
    let telling = speakers_meanwhile(Arc::clone(&samples), models, speakers, telling_threads);
    let plan = if speakers == Speakers::Off {
        Plan {
            workers: 1,
            threads: writing_threads,
        }
    } else {
        {
            let workers = writers_for(models);
            Plan {
                workers,
                threads: (writing_threads / workers as i32).max(1),
            }
        }
    };
    let written = write_phrases(&found, models, loaded, plan, &progress)?;
    let turns = match telling {
        Some(telling) => {
            // Whisper may finish first: the user sees what is still going on, and may stop it. The voices can't be
            // stopped halfway, so stopping only stops waiting; their thread ends on its own and is dropped.
            while !telling.is_finished() {
                if !progress(Stage::Speakers, 0.0) {
                    return Err(stopped());
                }
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
            telling
                .join()
                .map_err(|_| t("native.transcription.modelFailed"))??
        }
        None => Vec::new(),
    };
    let mut order: Vec<i32> = Vec::new();
    for turn in &turns {
        if !order.contains(&turn.speaker) {
            order.push(turn.speaker);
        }
    }
    let mut lines: Vec<TranscriptLine> = Vec::new();
    for Written { start, end, text } in written {
        let speaker = speaker_of(start, end, &turns, &order)
            .or_else(|| lines.last().and_then(|line| line.speaker));
        match lines.last_mut() {
            Some(last) if last.speaker == speaker && start - last.end < JOIN_GAP_SECONDS => {
                last.text = format!("{} {text}", last.text);
                last.end = end;
            }
            _ => lines.push(TranscriptLine {
                start,
                end,
                speaker,
                text,
            }),
        }
    }
    Ok(lines)
}

/// How Whisper writes: how many at once, each with how many threads
#[derive(Clone, Copy)]
struct Plan {
    workers: usize,
    threads: i32,
}

fn recognizer_for<'a>(
    recognizers: &'a mut HashMap<String, Writer>,
    models: &SpeechModels,
    language: &str,
    threads: i32,
) -> Result<&'a mut Writer, String> {
    if !recognizers.contains_key(language) {
        recognizers.insert(language.to_string(), recognizer(models, language, threads)?);
    }
    recognizers
        .get_mut(language)
        .ok_or_else(|| t("native.transcription.modelFailed"))
}

fn written_text(writer: &mut Writer, samples: &[f32], language: &str) -> Result<String, String> {
    match writer {
        Writer::Onnx(recognizer) => {
            let stream = recognizer.create_stream();
            stream.accept_waveform(SAMPLE_RATE, samples);
            recognizer.decode(&stream);
            Ok(stream
                .get_result()
                .map(|result| result.text)
                .unwrap_or_default())
        }
        Writer::Transformers(whisper) => whisper.write(samples, language),
    }
}

/// One phrase after another, with the recognizers kept in loaded
fn write_in_turn(
    found: &[Phrase],
    spoken: &[String],
    models: &SpeechModels,
    recognizers: &mut HashMap<String, Writer>,
    threads: i32,
    progress: &impl Fn(Stage, f32) -> bool,
) -> Result<Vec<String>, String> {
    let mut texts = Vec::with_capacity(found.len());
    for (i, (phrase, language)) in found.iter().zip(spoken).enumerate() {
        if !progress(Stage::Transcribing, i as f32 / found.len().max(1) as f32) {
            return Err(t("native.transcription.cancelled"));
        }
        let recognizer = recognizer_for(recognizers, models, language, threads)?;
        texts.push(written_text(recognizer, &phrase.samples, language)?);
    }
    Ok(texts)
}

/// Several Whispers at once, each on every n-th phrase: one gains little from more threads, so two use the cores
/// better. Each loads its own, so this is only for a whole transcription, never kept.
fn write_side_by_side(
    found: &[Phrase],
    spoken: &[String],
    models: &SpeechModels,
    plan: Plan,
    progress: &impl Fn(Stage, f32) -> bool,
) -> Result<Vec<String>, String> {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    let done = AtomicUsize::new(0);
    let stopped = AtomicBool::new(false);
    std::thread::scope(|scope| {
        let workers: Vec<_> = (0..plan.workers)
            .map(|worker| {
                let (done, stopped) = (&done, &stopped);
                scope.spawn(move || -> Result<Vec<(usize, String)>, String> {
                    let mut recognizers = HashMap::new();
                    let mut texts = Vec::new();
                    for i in (worker..found.len()).step_by(plan.workers) {
                        if stopped.load(Ordering::Relaxed) {
                            break;
                        }
                        let recognizer =
                            recognizer_for(&mut recognizers, models, &spoken[i], plan.threads)?;
                        texts.push((i, written_text(recognizer, &found[i].samples, &spoken[i])?));
                        done.fetch_add(1, Ordering::Relaxed);
                    }
                    Ok(texts)
                })
            })
            .collect();
        // The progress, and a stop, from here: the workers only write
        while workers.iter().any(|worker| !worker.is_finished()) {
            let share = done.load(Ordering::Relaxed) as f32 / found.len().max(1) as f32;
            if !progress(Stage::Transcribing, share) {
                stopped.store(true, Ordering::Relaxed);
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        let mut texts = vec![String::new(); found.len()];
        for worker in workers {
            for (i, text) in worker
                .join()
                .map_err(|_| t("native.transcription.modelFailed"))??
            {
                texts[i] = text;
            }
        }
        if stopped.load(Ordering::Relaxed) {
            return Err(t("native.transcription.cancelled"));
        }
        Ok(texts)
    })
}

/// Each phrase in its language, as Whisper writes it
fn write_phrases(
    found: &[Phrase],
    models: &SpeechModels,
    loaded: &mut Loaded,
    plan: Plan,
    progress: &impl Fn(Stage, f32) -> bool,
) -> Result<Vec<Written>, String> {
    loaded.prepare(models);
    let identifier = loaded.identifier.as_ref();
    let languages = identifier
        .map(|identifier| languages_of(found, identifier))
        .unwrap_or_default();
    let main = languages.first().cloned().unwrap_or_default();
    // Each phrase's language first, so the phrases can be shared out
    let language_of = |phrase: &Phrase| {
        let long_enough = phrase.samples.len() as f32 / SAMPLE_RATE as f32 >= MIN_SECONDS_TO_TELL;
        match identifier {
            Some(identifier) if languages.len() > 1 && long_enough => {
                language_in(identifier, &phrase.samples)
                    .filter(|language| languages.contains(language))
                    .unwrap_or_else(|| main.clone())
            }
            _ => main.clone(),
        }
    };
    let spoken: Vec<String> = found.iter().map(language_of).collect();
    let texts = if plan.workers <= 1 {
        write_in_turn(
            found,
            &spoken,
            models,
            &mut loaded.recognizers,
            plan.threads,
            progress,
        )?
    } else {
        write_side_by_side(found, &spoken, models, plan, progress)?
    };
    let mut written = Vec::new();
    for (phrase, text) in found.iter().zip(texts) {
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        let start = phrase.start as f32 / SAMPLE_RATE as f32;
        written.push(Written {
            start,
            end: start + phrase.samples.len() as f32 / SAMPLE_RATE as f32,
            text: text.to_string(),
        });
    }
    progress(Stage::Transcribing, 1.0);
    Ok(written)
}

/// One transcription at a time, as each one uses every core; the ones the user stopped, and the audio stored in this
/// session, which a message may not hold yet
#[derive(Default)]
pub struct Transcriptions {
    running: Mutex<()>,
    cancelled: Mutex<HashSet<String>>,
    stored_now: Mutex<HashSet<String>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    id: String,
    stage: Stage,
    progress: f32,
}

const AUDIO_DIR: &str = "audio";

fn audio_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(AUDIO_DIR))
}

/// Only letters and digits, short: it becomes part of a file name
fn plain_extension(extension: &str) -> String {
    extension
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(5)
        .collect::<String>()
        .to_ascii_lowercase()
}

fn audio_file(app: &AppHandle, id: &str, extension: &str) -> Result<PathBuf, String> {
    if !is_plain_id(id) {
        return Err(t("native.transcription.unreadable"));
    }
    Ok(audio_dir(app)?.join(format!("{id}.{}", plain_extension(extension))))
}

/// How long an audio lasts, from what its container says, or else by reading it whole
fn duration_of(bytes: Vec<u8>, extension: &str) -> Result<f32, String> {
    let stream = MediaSourceStream::new(
        Box::new(Cursor::new(bytes.clone())),
        MediaSourceStreamOptions::default(),
    );
    let mut hint = Hint::new();
    hint.with_extension(extension);
    let said = symphonia::default::get_probe()
        .probe(
            &hint,
            stream,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .ok()
        .and_then(|format| {
            let track = format.default_track(TrackType::Audio)?;
            let rate = track.codec_params.as_ref()?.audio()?.sample_rate?;
            Some(track.num_frames? as f32 / rate as f32)
        });
    match said {
        Some(seconds) if seconds > 0.0 => Ok(seconds),
        _ => Ok(read_audio(bytes, Some(extension))?.len() as f32 / SAMPLE_RATE as f32),
    }
}

/// An attached audio is kept as a file, not inside the conversation, which loads whole every time it opens; its raw
/// bytes come as the body, its id and extension in headers. Returns how long it lasts, in seconds.
#[tauri::command]
pub async fn store_audio(app: AppHandle, request: Request<'_>) -> Result<f32, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(t("native.transcription.unreadable"));
    };
    if bytes.len() > MAX_AUDIO_BYTES {
        return Err(t("native.transcription.tooLong"));
    }
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string()
    };
    let (id, extension) = (header("x-id"), plain_extension(&header("x-extension")));
    let path = audio_file(&app, &id, &extension)?;
    let bytes = bytes.clone();
    let (seconds, bytes) = tauri::async_runtime::spawn_blocking(move || {
        duration_of(bytes.clone(), &extension).map(|seconds| (seconds, bytes))
    })
    .await
    .map_err(|_| t("native.transcription.unreadable"))??;
    if seconds > MAX_SECONDS {
        return Err(t("native.transcription.tooLong"));
    }
    fs::create_dir_all(audio_dir(&app)?).map_err(to_message)?;
    fs::write(&path, &bytes).map_err(to_message)?;
    if let Ok(mut ids) = app.state::<Transcriptions>().stored_now.lock() {
        ids.insert(id);
    }
    Ok(seconds)
}

/// A stored audio as its transcript, with the Whisper size asked and its speakers told apart or not. Its progress goes
/// out as events under the audio's id.
#[tauri::command]
pub async fn transcribe_stored_audio(
    app: AppHandle,
    id: String,
    extension: String,
    model: String,
    speakers: bool,
    speaker_count: Option<u32>,
) -> Result<Vec<TranscriptLine>, String> {
    let speakers = Speakers::from(speakers, speaker_count);
    let path = audio_file(&app, &id, &extension)?;
    if !path.is_file() {
        return Err(t("native.transcription.gone"));
    }
    let models = models_for(&app, &model)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Transcriptions>();
        let is_cancelled = || state.cancelled.lock().is_ok_and(|ids| ids.contains(&id));
        let send = |stage: Stage, progress: f32| {
            let _ = app.emit(
                PROGRESS_EVENT,
                Progress {
                    id: id.clone(),
                    stage,
                    progress,
                },
            );
            !is_cancelled()
        };
        send(Stage::Reading, 0.0);
        let _turn = state
            .running
            .lock()
            .map_err(|_| t("native.transcription.modelFailed"))?;
        let result = (|| {
            if is_cancelled() {
                return Err(t("native.transcription.cancelled"));
            }
            let samples = read_audio_file(&path, Some(&extension))?;
            transcribe(
                Arc::new(samples),
                &models,
                &mut Loaded::default(),
                speakers,
                send,
            )
        })();
        if let Ok(mut ids) = state.cancelled.lock() {
            ids.remove(&id);
        }
        result
    })
    .await
    .map_err(|_| t("native.transcription.modelFailed"))?
}

#[tauri::command]
pub fn transcription_cancel(app: AppHandle, id: String) {
    if let Ok(mut ids) = app.state::<Transcriptions>().cancelled.lock() {
        ids.insert(id);
    }
}

/// The audio files of a private conversation that closed: they go now, not on the next start
#[tauri::command]
pub fn forget_audio(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let Ok(entries) = fs::read_dir(audio_dir(&app)?) else {
        return Ok(());
    };
    let prefixes: Vec<String> = ids
        .iter()
        .filter(|id| is_plain_id(id))
        .map(|id| format!("{id}."))
        .collect();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if prefixes.iter().any(|prefix| name.starts_with(prefix)) {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

/// The stored audio no saved message holds goes: that of deleted conversations, and that attached and never sent in
/// an earlier session. What was stored in this one may still be in the composer.
pub fn sweep_audio(app: &AppHandle) {
    let Ok(dir) = audio_dir(app) else { return };
    let Ok(entries) = fs::read_dir(&dir) else {
        return;
    };
    let kept: HashSet<String> = app
        .state::<Database>()
        .with(|c| {
            let mut statement = c.prepare(
                "SELECT id FROM attachments WHERE json_extract(data, '$.kind') = 'audio'",
            )?;
            let ids = statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<HashSet<_>>>()?;
            Ok(ids)
        })
        .unwrap_or_default();
    let fresh = app
        .state::<Transcriptions>()
        .stored_now
        .lock()
        .map(|ids| ids.clone())
        .unwrap_or_default();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let id = name.split('.').next().unwrap_or_default();
        if !kept.contains(id) && !fresh.contains(id) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stereo WAV at 44.1 kHz, built here: one second of two tones, one per channel
    fn stereo_wav() -> (Vec<u8>, Vec<f32>) {
        let rate = 44_100u32;
        let frames: Vec<(i16, i16)> = (0..rate)
            .map(|n| {
                let t = n as f32 / rate as f32;
                let left = (t * 440.0 * std::f32::consts::TAU).sin() * 0.5;
                let right = (t * 660.0 * std::f32::consts::TAU).sin() * 0.25;
                ((left * 32767.0) as i16, (right * 32767.0) as i16)
            })
            .collect();
        let data = (frames.len() * 4) as u32;
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + data).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&rate.to_le_bytes());
        wav.extend_from_slice(&(rate * 4).to_le_bytes());
        wav.extend_from_slice(&4u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&data.to_le_bytes());
        let mut mono = Vec::new();
        for (left, right) in frames {
            wav.extend_from_slice(&left.to_le_bytes());
            wav.extend_from_slice(&right.to_le_bytes());
            mono.push((f32::from(left) / 32768.0 + f32::from(right) / 32768.0) / 2.0);
        }
        (wav, mono)
    }

    #[test]
    fn resampling_while_decoding_gives_the_same_audio() {
        let (wav, mono) = stereo_wav();
        let read = read_audio(wav, Some("wav")).unwrap();
        let whole = at_model_rate(mono, 44_100).unwrap();
        assert!(
            read.len().abs_diff(whole.len()) <= 2,
            "{} vs {}",
            read.len(),
            whole.len()
        );
        let worst = read
            .iter()
            .zip(&whole)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        assert!(worst < 1e-3, "{worst}");
    }

    /// The models as Nyra names them in a folder, with Whisper of this size and small telling the language
    fn models_in(dir: &std::path::Path, size: &str) -> SpeechModels {
        SpeechModels {
            // A folder of a community model in Transformers' format, or the name of a size in sherpa-onnx's
            whisper: if dir.join(size).is_dir() {
                crate::transcription::WhisperFiles::Transformers(dir.join(size))
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
        }
    }

    // How long each stage takes, transcribing as the app does: the models in NYRA_SPEECH_MODELS, the audio in
    // NYRA_SPEECH_SAMPLE, the size in NYRA_WHISPER_SIZE (small by default) and NYRA_SPEAKERS=0 to not tell them apart.
    // Only times are printed, never what is said. In release, as the app ships:
    // cargo test --release measures_each_stage -- --ignored --nocapture
    #[test]
    #[ignore = "needs the speech models and an audio"]
    fn measures_each_stage() {
        use std::cell::RefCell;
        use std::time::{Duration, Instant};
        let dir = PathBuf::from(std::env::var("NYRA_SPEECH_MODELS").expect("models"));
        let sample = PathBuf::from(std::env::var("NYRA_SPEECH_SAMPLE").expect("audio"));
        let size = std::env::var("NYRA_WHISPER_SIZE").unwrap_or_else(|_| "small".into());
        let speakers = std::env::var("NYRA_SPEAKERS").map_or(true, |v| v != "0");
        let models = models_in(&dir, &size);
        let extension = sample
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_string);
        let seconds = |d: Duration| d.as_secs_f32();

        let started = Instant::now();
        let samples = read_audio(fs::read(&sample).unwrap(), extension.as_deref()).unwrap();
        let read = started.elapsed();
        // When each stage was first reported: the voice cut ends when speakers start, and those (with the language)
        // end when the first phrase is written
        let marks: RefCell<Vec<(Stage, Instant)>> = RefCell::new(Vec::new());
        let lines = transcribe(
            Arc::new(samples.clone()),
            &models,
            &mut Loaded::default(),
            Speakers::from(speakers, None),
            |stage, _| {
                let mut marks = marks.borrow_mut();
                if marks.last().is_none_or(|(last, _)| *last != stage) {
                    marks.push((stage, Instant::now()));
                }
                true
            },
        )
        .unwrap();
        let total = started.elapsed();
        let ended = Instant::now();
        let marks = marks.into_inner();
        let at = |stage: Stage| marks.iter().find(|(s, _)| *s == stage).map(|(_, at)| *at);
        // Speakers are told apart while Whisper writes: it reports them only when it has to wait for them after
        let writing_from = at(Stage::Transcribing).unwrap_or(ended);
        let waiting_from = at(Stage::Speakers).unwrap_or(ended);

        // The language alone: it is loaded and told before the first phrase is written
        let found = phrases(&samples, &models).unwrap();
        let language_started = Instant::now();
        let identifier = language_identifier(&models).unwrap();
        let languages = languages_of(&found, &identifier);
        let language = language_started.elapsed();

        let audio = samples.len() as f32 / SAMPLE_RATE as f32;
        let before_writing = writing_from.duration_since(started) - read;
        println!(
            "Whisper {size}, speakers {speakers}, {:.0} s of audio, {} phrases",
            audio,
            found.len()
        );
        println!("  read and 16 kHz:          {:>6.1} s", seconds(read));
        println!(
            "  cut into phrases:         {:>6.1} s",
            seconds(before_writing.saturating_sub(language))
        );
        println!(
            "  language:                 {:>6.1} s {languages:?}",
            seconds(language)
        );
        println!(
            "  writing (Whisper):        {:>6.1} s, speakers told meanwhile",
            seconds(waiting_from.duration_since(writing_from))
        );
        println!(
            "  waiting for the speakers: {:>6.1} s",
            seconds(ended.duration_since(waiting_from))
        );
        println!(
            "  TOTAL:                    {:>6.1} s ({:.2}× real time), {} lines",
            seconds(total),
            seconds(total) / audio,
            lines.len()
        );
        // A fingerprint of every word, whatever the lines and speakers: equal means the same text, without showing it
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        for line in &lines {
            for word in line.text.split_whitespace() {
                word.hash(&mut hasher);
            }
        }
        println!("  text fingerprint:          {:016x}", hasher.finish());
    }

    // With real models and a recording: NYRA_LID_ENCODER, NYRA_LID_DECODER and NYRA_LID_WAV (16 kHz wav), and the
    // language it should hear in NYRA_LID_EXPECTED. cargo test identifies_the_language -- --ignored --nocapture
    #[test]
    #[ignore = "needs downloaded models and a recording"]
    fn identifies_the_language() {
        let var = |name: &str| std::env::var(name).unwrap_or_else(|_| panic!("{name} is missing"));
        let identifier =
            SpokenLanguageIdentification::create(&SpokenLanguageIdentificationConfig {
                whisper: SpokenLanguageIdentificationWhisperConfig {
                    encoder: Some(var("NYRA_LID_ENCODER")),
                    decoder: Some(var("NYRA_LID_DECODER")),
                    tail_paddings: -1,
                },
                num_threads: threads(),
                ..Default::default()
            })
            .expect("the identifier loads");
        let samples = read_audio(fs::read(var("NYRA_LID_WAV")).unwrap(), Some("wav")).unwrap();
        let heard = language_in(&identifier, &samples);
        println!("heard: {heard:?}");
        assert_eq!(heard.as_deref(), Some(var("NYRA_LID_EXPECTED").as_str()));
    }

    fn turn(start: f32, end: f32, speaker: i32) -> OfflineSpeakerDiarizationSegment {
        OfflineSpeakerDiarizationSegment {
            start,
            end,
            speaker,
            confidence: 1.0,
        }
    }

    #[test]
    fn tells_speakers_apart_only_when_there_can_be_several() {
        assert_eq!(Speakers::from(false, Some(3)), Speakers::Off);
        assert_eq!(Speakers::from(true, Some(1)), Speakers::Off);
        assert_eq!(Speakers::from(true, Some(3)), Speakers::Exactly(3));
        assert_eq!(Speakers::from(true, Some(500)), Speakers::Exactly(20));
        assert_eq!(Speakers::from(true, None), Speakers::Guess);
    }

    #[test]
    fn leaves_out_speakers_heard_only_a_moment() {
        let turns = vec![
            turn(0.0, 60.0, 1),
            turn(60.0, 90.0, 2),
            turn(90.0, 90.8, 3),
            turn(91.0, 91.5, 4),
        ];
        let kept: Vec<i32> = real_speakers(turns).iter().map(|t| t.speaker).collect();
        assert_eq!(kept, vec![1, 2]);
    }

    #[test]
    fn gives_a_phrase_the_speaker_who_talks_longest_in_it() {
        let turns = [turn(0.0, 4.0, 7), turn(4.0, 9.0, 3), turn(9.0, 12.0, 7)];
        let order = [7, 3];
        assert_eq!(speaker_of(0.5, 3.0, &turns, &order), Some(1));
        assert_eq!(speaker_of(3.5, 8.0, &turns, &order), Some(2));
        assert_eq!(speaker_of(20.0, 22.0, &turns, &order), None);
    }

    // With the real models in NYRA_SPEECH_MODELS (as Nyra names them, small among them) and an audio in
    // NYRA_SPEECH_SAMPLE; NYRA_WHISPER_SIZE picks the Whisper that writes (small by default):
    // cargo test transcription -- --ignored --nocapture
    #[test]
    #[ignore = "needs the speech models and an audio"]
    fn transcribes_a_conversation_with_its_speakers() {
        let dir = PathBuf::from(std::env::var("NYRA_SPEECH_MODELS").expect("models"));
        let sample = PathBuf::from(std::env::var("NYRA_SPEECH_SAMPLE").expect("audio"));
        let size = std::env::var("NYRA_WHISPER_SIZE").unwrap_or_else(|_| "small".into());
        let models = models_in(&dir, &size);
        let extension = sample
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_string);
        let started = std::time::Instant::now();
        let samples = read_audio(std::fs::read(&sample).unwrap(), extension.as_deref()).unwrap();
        let read = started.elapsed();
        println!(
            "languages: {:?}",
            languages_of(
                &phrases(&samples, &models).unwrap(),
                &language_identifier(&models).unwrap()
            )
        );
        // NYRA_SPEAKER_COUNT: how many speak, as the user would say it
        let count = std::env::var("NYRA_SPEAKER_COUNT")
            .ok()
            .and_then(|n| n.parse().ok());
        let lines = transcribe(
            Arc::new(samples.clone()),
            &models,
            &mut Loaded::default(),
            Speakers::from(true, count),
            |_, _| true,
        )
        .unwrap();
        println!(
            "{:.1} s of audio, read in {:?}, transcribed in {:?}",
            samples.len() as f32 / SAMPLE_RATE as f32,
            read,
            started.elapsed() - read
        );
        for line in &lines {
            println!(
                "[{:6.1}-{:6.1}] {:?}: {}",
                line.start, line.end, line.speaker, line.text
            );
        }
        assert!(!lines.is_empty());
    }
}
