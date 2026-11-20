//! A Whisper in Hugging Face's Transformers format, as the community publishes its models (a Spanish one, a regional
//! accent), run with candle as it is: its weights in safetensors, its config.json and its tokenizer.json. It writes one
//! phrase at a time; finding the phrases, their language and who speaks is sherpa-onnx's, as for the other models.

use std::fs;
use std::ops::Range;
use std::path::{Path, PathBuf};

use candle_core::{DType, Device, IndexOp, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::whisper::{self as m, audio, Config};
use tokenizers::Tokenizer;

use crate::i18n::t;
use crate::util::to_message;

pub const CONFIG: &str = "config.json";
pub const TOKENIZER: &str = "tokenizer.json";
// As Whisper itself stops: a phrase of 28 s is never longer
const MAX_TOKENS: usize = 224;
// A token said this many times in a row is the model stuck in a loop, not speech
const MAX_REPEATS: usize = 12;

/// Its weights: one file, or several parts of a large model, all safetensors
pub fn weights_in(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|e| e == "safetensors"))
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files
}

/// Whether a folder holds one of these models
pub fn is_model(dir: &Path) -> bool {
    dir.join(CONFIG).is_file() && dir.join(TOKENIZER).is_file() && !weights_in(dir).is_empty()
}

/// Whether a config.json is a Whisper's
pub fn is_whisper_config(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text)
        .is_ok_and(|config| config["model_type"] == "whisper")
}

/// The weights of a PyTorch file (pytorch_model.bin) as safetensors, once when the model is added: read from the
/// older file, candle keeps them on the processor even with a graphics chip, and phrases took ten times as long
pub fn convert_pytorch(from: &Path, to: &Path) -> Result<(), String> {
    let tensors = candle_core::pickle::read_all(from).map_err(to_message)?;
    let tensors: std::collections::HashMap<String, Tensor> = tensors.into_iter().collect();
    candle_core::safetensors::save(&tensors, to).map_err(to_message)
}

/// Mel filters as Whisper was trained with them (librosa's, Slaney scale, for a window of 400 at 16 kHz): computed,
/// so no file has to come with the app. One row of 201 bins per band.
fn mel_filters(bands: usize) -> Vec<f32> {
    const RATE: f64 = 16000.0;
    const WINDOW: usize = 400;
    let f_sp = 200.0 / 3.0;
    let (min_log_hz, min_log_mel) = (1000.0, 1000.0 / f_sp);
    let logstep = 6.4f64.ln() / 27.0;
    let to_mel = |hz: f64| {
        if hz < min_log_hz {
            hz / f_sp
        } else {
            min_log_mel + (hz / min_log_hz).ln() / logstep
        }
    };
    let to_hz = |mel: f64| {
        if mel < min_log_mel {
            mel * f_sp
        } else {
            min_log_hz * ((mel - min_log_mel) * logstep).exp()
        }
    };
    let bins = WINDOW / 2 + 1;
    let top = to_mel(RATE / 2.0);
    let edges: Vec<f64> = (0..bands + 2)
        .map(|i| to_hz(top * i as f64 / (bands + 1) as f64))
        .collect();
    let mut filters = vec![0f32; bands * bins];
    for band in 0..bands {
        let norm = 2.0 / (edges[band + 2] - edges[band]);
        for bin in 0..bins {
            let hz = bin as f64 * RATE / WINDOW as f64;
            let rising = (hz - edges[band]) / (edges[band + 1] - edges[band]);
            let falling = (edges[band + 2] - hz) / (edges[band + 2] - edges[band + 1]);
            filters[band * bins + bin] = (rising.min(falling).max(0.0) * norm) as f32;
        }
    }
    filters
}

/// On the Mac's graphics chip when there is one; elsewhere, the processor
fn device() -> Device {
    #[cfg(target_os = "macos")]
    if let Ok(device) = Device::new_metal(0) {
        return device;
    }
    Device::Cpu
}

/// "Hola.Qué tal" → "Hola. Qué tal": some fine-tuned models drop the space after a sentence. By the shape of the
/// text, so scripts without capitals or spaces are left as they are.
fn spaced(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 8);
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        out.push(c);
        if matches!(c, '.' | '?' | '!') && chars.peek().is_some_and(|next| next.is_uppercase()) {
            out.push(' ');
        }
    }
    out
}

pub struct TransformersWhisper {
    model: m::model::Whisper,
    tokenizer: Tokenizer,
    config: Config,
    device: Device,
    filters: Vec<f32>,
    start: u32,
    transcribe: u32,
    no_timestamps: u32,
    end: u32,
    // The ids of the language tokens: right after the start one and before the one to translate
    languages: Range<u32>,
}

impl TransformersWhisper {
    pub fn load(dir: &Path) -> Result<Self, String> {
        let failed = |_| t("native.transcription.modelFailed");
        let config: Config =
            serde_json::from_str(&fs::read_to_string(dir.join(CONFIG)).map_err(to_message)?)
                .map_err(|_| t("native.transcription.modelFailed"))?;
        let tokenizer = Tokenizer::from_file(dir.join(TOKENIZER))
            .map_err(|_| t("native.transcription.modelFailed"))?;
        let id = |token: &str| {
            tokenizer
                .token_to_id(token)
                .ok_or_else(|| t("native.transcription.modelFailed"))
        };
        let (start, transcribe) = (id(m::SOT_TOKEN)?, id(m::TRANSCRIBE_TOKEN)?);
        let (no_timestamps, end) = (id(m::NO_TIMESTAMPS_TOKEN)?, id(m::EOT_TOKEN)?);
        let languages = start + 1..id(m::TRANSLATE_TOKEN)?;
        let device = device();
        let weights = weights_in(dir);
        // SAFETY: the files are the model's own, in Nyra's data folder, and aren't changed while it is loaded
        let vb = unsafe { VarBuilder::from_mmaped_safetensors(&weights, m::DTYPE, &device) }
            .map_err(failed)?;
        let model = m::model::Whisper::load(&vb, config.clone()).map_err(failed)?;
        let filters = mel_filters(config.num_mel_bins);
        Ok(Self {
            model,
            tokenizer,
            config,
            device,
            filters,
            start,
            transcribe,
            no_timestamps,
            end,
            languages,
        })
    }

    /// What is said in a phrase of up to 30 s at 16 kHz. language: Whisper's code ("es"), or empty to let it tell.
    pub fn write(&mut self, samples: &[f32], language: &str) -> Result<String, String> {
        let failed = |_| t("native.transcription.modelFailed");
        let bands = self.config.num_mel_bins;
        let mel = audio::pcm_to_mel(&self.config, samples, &self.filters);
        let all_frames = mel.len() / bands;
        let frames = all_frames.min(m::N_FRAMES);
        let mel = Tensor::from_vec(mel, (1, bands, all_frames), &self.device).map_err(failed)?;
        // Whisper always reads a window of 30 s
        let mel = mel.narrow(2, 0, frames).map_err(failed)?;
        let mel = if frames < m::N_FRAMES {
            mel.pad_with_zeros(2, 0, m::N_FRAMES - frames)
                .map_err(failed)?
        } else {
            mel
        };
        let features = self.model.encoder.forward(&mel, true).map_err(failed)?;
        let language = match self.tokenizer.token_to_id(&format!("<|{language}|>")) {
            Some(id) if !language.is_empty() => id,
            _ => self.language_of(&features)?,
        };
        let mut tokens = vec![self.start, language, self.transcribe, self.no_timestamps];
        let prompt = tokens.len();
        for step in 0..MAX_TOKENS {
            let next = self.next_token(&tokens, &features, step == 0)?;
            if next == self.end {
                break;
            }
            tokens.push(next);
            let repeats = tokens.iter().rev().take_while(|t| **t == next).count();
            if repeats >= MAX_REPEATS {
                tokens.truncate(tokens.len() - repeats + 1);
                break;
            }
        }
        let text = self
            .tokenizer
            .decode(&tokens[prompt..], true)
            .map_err(|_| t("native.transcription.modelFailed"))?;
        Ok(spaced(text.trim()))
    }

    fn logits(&mut self, tokens: &[u32], features: &Tensor, first: bool) -> Result<Tensor, String> {
        let failed = |_| t("native.transcription.modelFailed");
        let input = Tensor::new(tokens, &self.device)
            .and_then(|t| t.unsqueeze(0))
            .map_err(failed)?;
        let ys = self
            .model
            .decoder
            .forward(&input, features, first)
            .map_err(failed)?;
        let (_, length, _) = ys.dims3().map_err(failed)?;
        self.model
            .decoder
            .final_linear(&ys.i((..1, length - 1..)).map_err(failed)?)
            .and_then(|l| l.i(0)?.i(0)?.to_dtype(DType::F32))
            .map_err(failed)
    }

    fn next_token(
        &mut self,
        tokens: &[u32],
        features: &Tensor,
        first: bool,
    ) -> Result<u32, String> {
        let logits = self.logits(tokens, features, first)?;
        let mut scores: Vec<f32> = logits
            .to_vec1()
            .map_err(|_| t("native.transcription.modelFailed"))?;
        // What the model was told never to write (a blank at the start, some symbols), and the language and task
        // tokens, which aren't words
        for id in self
            .config
            .suppress_tokens
            .iter()
            .map(|id| *id as usize)
            .chain(self.languages.start as usize..self.no_timestamps as usize + 1)
        {
            if let Some(score) = scores.get_mut(id) {
                *score = f32::NEG_INFINITY;
            }
        }
        // Timestamps come after the special tokens; this writes without them
        for score in scores.iter_mut().skip(self.no_timestamps as usize + 1) {
            *score = f32::NEG_INFINITY;
        }
        Ok(scores
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .map_or(self.end, |(id, _)| id as u32))
    }

    /// The language Whisper hears, when none was given: the likeliest language token right after the start
    fn language_of(&mut self, features: &Tensor) -> Result<u32, String> {
        let logits = self.logits(&[self.start], features, true)?;
        let scores: Vec<f32> = logits
            .to_vec1()
            .map_err(|_| t("native.transcription.modelFailed"))?;
        Ok(self
            .languages
            .clone()
            .max_by(|a, b| scores[*a as usize].total_cmp(&scores[*b as usize]))
            .unwrap_or(self.languages.start))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_the_mel_filters_whisper_was_trained_with() {
        // Values of the filters that come with candle's own Whisper example, 80 bands
        let filters = mel_filters(80);
        assert_eq!(filters.len(), 80 * 201);
        let at = |band: usize, bin: usize| filters[band * 201 + bin];
        assert!((at(0, 1) - 0.024_862_595).abs() < 1e-7);
        assert!((at(79, 190) - 0.002_232_055).abs() < 1e-7);
        assert_eq!(at(10, 20), 0.0);
        assert_eq!(mel_filters(128).len(), 128 * 201);
    }

    #[test]
    fn puts_back_the_space_some_models_drop_after_a_sentence() {
        assert_eq!(
            spaced("Buenos días.Esta es una prueba."),
            "Buenos días. Esta es una prueba."
        );
        assert_eq!(spaced("¿Vienes?Sí."), "¿Vienes? Sí.");
        assert_eq!(spaced("v2.5 y 3.14"), "v2.5 y 3.14");
        assert_eq!(spaced("今日は。明日"), "今日は。明日");
    }

    #[test]
    fn tells_a_whisper_config_from_another_models() {
        assert!(is_whisper_config(
            r#"{"model_type": "whisper", "num_mel_bins": 80}"#
        ));
        assert!(!is_whisper_config(r#"{"model_type": "wav2vec2"}"#));
        assert!(!is_whisper_config("not json"));
    }

    // A community model in a folder (config.json, tokenizer.json, model.safetensors), a Spanish recording at 16 kHz
    // and, optionally, a word it says: NYRA_TRANSFORMERS_MODEL=… NYRA_SPEECH_SAMPLE=….wav NYRA_SPEECH_WORD=…
    // cargo test whisper_transformers -- --ignored --nocapture
    #[test]
    #[ignore = "needs a community model and a recording"]
    fn writes_a_phrase_with_a_community_model() {
        let dir = PathBuf::from(std::env::var("NYRA_TRANSFORMERS_MODEL").expect("model"));
        let sample = PathBuf::from(std::env::var("NYRA_SPEECH_SAMPLE").expect("audio"));
        let samples =
            crate::transcription::read_audio(fs::read(sample).unwrap(), Some("wav")).unwrap();
        let started = std::time::Instant::now();
        let mut whisper = TransformersWhisper::load(&dir).unwrap();
        let loaded = started.elapsed();
        let given = whisper.write(&samples, "es").unwrap();
        let written = started.elapsed() - loaded;
        let guessed = whisper.write(&samples, "").unwrap();
        println!("loaded in {loaded:?}, written in {written:?}\nes: {given}\nguessed: {guessed}");
        if let Ok(word) = std::env::var("NYRA_SPEECH_WORD") {
            assert!(
                given.to_lowercase().contains(&word.to_lowercase()),
                "{word}"
            );
        }
        assert_eq!(given, guessed);
    }
}
