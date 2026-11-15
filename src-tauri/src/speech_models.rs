//! The models that transcribe audio on this computer. The Whisper models are the user's: added from a Hugging Face
//! repository or from a folder, in sherpa-onnx's format (an encoder, a decoder and their tokens). The voice detector,
//! the two speaker models and a small Whisper that tells the language are shared by all, and come by themselves with
//! the first Whisper added.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_http::reqwest;

use crate::i18n::{t, t_with};
use crate::transcription::{SpeechModels, WhisperFiles};
use crate::util::{data_dir, is_plain_id, to_message};
use crate::whisper_transformers;

const MODELS_DIR: &str = "speech-models";
// One folder per Whisper, by its id, with its files always under these names and what it is in INFO
const WHISPER_DIR: &str = "whisper";
const ENCODER: &str = "encoder.onnx";
const DECODER: &str = "decoder.onnx";
const TOKENS: &str = "tokens.txt";
const INFO: &str = "model.json";
// Being downloaded or copied: never taken for a model until it is complete
const STAGING: &str = ".part";

struct ModelFile {
    // As it is kept here
    name: &'static str,
    url: &'static str,
    // To show the download's size before it starts
    bytes: u64,
}

const SHARED: [ModelFile; 3] = [
    ModelFile {
        name: "silero_vad.onnx",
        url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
        bytes: 643_854,
    },
    ModelFile {
        name: "speaker-segmentation.onnx",
        url: "https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.onnx",
        bytes: 5_992_913,
    },
    // Trained on voices from many countries and languages (VoxCeleb); of the five measured, the one that split a single
    // voice the least while keeping two apart
    ModelFile {
        name: "speaker-embedding-campplus.onnx",
        url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx",
        bytes: 29_596_978,
    },
];

// Telling the language takes a Whisper of 80 mel bands, as sherpa-onnx's identifier reads it, and a model the user adds
// may have 128 (turbo); this one, the smallest that tells them (in tests, Spanish, English, French, German and Japanese
// as well as small), always does
const LANGUAGE: [ModelFile; 2] = [
    ModelFile {
        name: "tiny-encoder.int8.onnx",
        url: "https://huggingface.co/csukuangfj/sherpa-onnx-whisper-tiny/resolve/main/tiny-encoder.int8.onnx",
        bytes: 12_937_772,
    },
    ModelFile {
        name: "tiny-decoder.int8.onnx",
        url: "https://huggingface.co/csukuangfj/sherpa-onnx-whisper-tiny/resolve/main/tiny-decoder.int8.onnx",
        bytes: 89_855_401,
    },
];

// The sizes earlier versions downloaded loose in the folder: moved once into their own folders, as models the user has
const BUILT_IN: [(&str, &str); 2] = [("small", "Whisper small"), ("turbo", "Whisper turbo")];
// Models earlier versions downloaded and no longer use
const RETIRED: [&str; 1] = ["speaker-embedding.onnx"];

/// A Whisper the user added
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModel {
    id: String,
    name: String,
    // "huggingface" or "folder"
    source: String,
    // The repository or the folder's name
    origin: String,
    #[serde(default)]
    bytes: u64,
    // "onnx" (sherpa-onnx's) or "transformers" (the community's), as its files say
    #[serde(default)]
    format: String,
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(MODELS_DIR))
}

fn installed(dir: &Path, files: &[ModelFile]) -> bool {
    files.iter().all(|file| dir.join(file.name).is_file())
}

/// In sherpa-onnx's format
fn complete(model_dir: &Path) -> bool {
    [ENCODER, DECODER, TOKENS]
        .iter()
        .all(|name| model_dir.join(name).is_file())
}

/// The format of the Whisper in a folder, by its files; None when it isn't a whole one
fn format_of(model_dir: &Path) -> Option<&'static str> {
    if complete(model_dir) {
        Some("onnx")
    } else if whisper_transformers::is_model(model_dir) {
        Some("transformers")
    } else {
        None
    }
}

/// The Whisper models here, by name
fn list_models(dir: &Path) -> Vec<WhisperModel> {
    let Ok(entries) = fs::read_dir(dir.join(WHISPER_DIR)) else {
        return Vec::new();
    };
    let mut models: Vec<WhisperModel> = entries
        .flatten()
        .filter(|entry| !entry.file_name().to_string_lossy().ends_with(STAGING))
        .filter_map(|entry| {
            let path = entry.path();
            let mut model: WhisperModel =
                serde_json::from_str(&fs::read_to_string(path.join(INFO)).ok()?).ok()?;
            let format = format_of(&path)?;
            if model.id != entry.file_name().to_string_lossy() {
                return None;
            }
            model.format = format.to_string();
            model.bytes = fs::read_dir(&path)
                .map(|files| {
                    files
                        .flatten()
                        .filter_map(|f| f.metadata().ok())
                        .map(|m| m.len())
                        .sum()
                })
                .unwrap_or(0);
            Some(model)
        })
        .collect();
    models.sort_by(|a, b| a.name.cmp(&b.name));
    models
}

/// The small and turbo earlier versions downloaded become models the user added, with nothing to download again
fn adopt_built_in(dir: &Path) {
    for (size, name) in BUILT_IN {
        let loose = |part: &str| dir.join(format!("{size}-{part}"));
        let files = [
            (loose("encoder.int8.onnx"), ENCODER),
            (loose("decoder.int8.onnx"), DECODER),
            (loose("tokens.txt"), TOKENS),
        ];
        if !files.iter().all(|(from, _)| from.is_file()) {
            continue;
        }
        let target = dir.join(WHISPER_DIR).join(size);
        if fs::create_dir_all(&target).is_err() {
            continue;
        }
        for (from, to) in &files {
            let _ = fs::rename(from, target.join(to));
        }
        let model = WhisperModel {
            id: size.to_string(),
            name: name.to_string(),
            source: "huggingface".to_string(),
            origin: format!("csukuangfj/sherpa-onnx-whisper-{size}"),
            bytes: 0,
            format: "onnx".to_string(),
        };
        if let Ok(json) = serde_json::to_string(&model) {
            let _ = fs::write(target.join(INFO), json);
        }
    }
}

/// The encoder and decoder that tell the language: the small Whisper for it, or a small one an earlier version left,
/// which has 80 bands too
fn language_files(dir: &Path) -> Option<(PathBuf, PathBuf)> {
    let small = dir.join(WHISPER_DIR).join("small");
    if installed(dir, &LANGUAGE) {
        Some((dir.join(LANGUAGE[0].name), dir.join(LANGUAGE[1].name)))
    } else if complete(&small) {
        Some((small.join(ENCODER), small.join(DECODER)))
    } else {
        None
    }
}

/// What every Whisper needs besides itself and isn't here yet
fn shared_missing(dir: &Path) -> Vec<&'static ModelFile> {
    let mut files: Vec<&ModelFile> = SHARED
        .iter()
        .filter(|f| !dir.join(f.name).is_file())
        .collect();
    if language_files(dir).is_none() {
        files.extend(LANGUAGE.iter().filter(|f| !dir.join(f.name).is_file()));
    }
    files
}

/// A Whisper with the shared models, once they are all here
pub fn models_for(app: &AppHandle, id: &str) -> Result<SpeechModels, String> {
    if !is_plain_id(id) {
        return Err(t("native.transcription.unknownModel"));
    }
    let dir = models_dir(app)?;
    let folder = dir.join(WHISPER_DIR).join(id);
    let whisper = match format_of(&folder) {
        Some("onnx") => WhisperFiles::Onnx {
            encoder: folder.join(ENCODER),
            decoder: folder.join(DECODER),
            tokens: folder.join(TOKENS),
        },
        Some(_) => WhisperFiles::Transformers(folder),
        None => return Err(t("native.transcription.unknownModel")),
    };
    let (Some((language_encoder, language_decoder)), true) =
        (language_files(&dir), installed(&dir, &SHARED))
    else {
        return Err(t("native.transcription.notDownloaded"));
    };
    Ok(SpeechModels {
        whisper,
        language_encoder,
        language_decoder,
        vad: dir.join(SHARED[0].name),
        segmentation: dir.join(SHARED[1].name),
        embedding: dir.join(SHARED[2].name),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechModelsStatus {
    models: Vec<WhisperModel>,
    // What the shared models still need: downloaded with the next Whisper added
    shared_download_bytes: u64,
}

#[tauri::command]
pub fn speech_models_status(app: AppHandle) -> Result<SpeechModelsStatus, String> {
    let dir = models_dir(&app)?;
    adopt_built_in(&dir);
    Ok(SpeechModelsStatus {
        models: list_models(&dir),
        shared_download_bytes: shared_missing(&dir).iter().map(|f| f.bytes).sum(),
    })
}

/// One download at a time; the user may stop it
#[derive(Default)]
pub struct SpeechDownloads {
    running: AtomicBool,
    cancelled: AtomicBool,
    // Wakes a download waiting on the network, so stopping doesn't wait for the next piece
    stop: tokio::sync::Notify,
}

// A connection that sends nothing for this long is given up, so a stuck download doesn't block the next ones
const STALLED: Duration = Duration::from_secs(60);

fn download_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(STALLED)
        .build()
        .map_err(to_message)
}

/// The network's answer, unless the user stops the download first
async fn unless_stopped<T>(
    state: &SpeechDownloads,
    work: impl std::future::Future<Output = T>,
) -> Result<T, String> {
    let stopped = state.stop.notified();
    tokio::pin!(stopped);
    // Registered before the check, so a stop in between isn't missed
    stopped.as_mut().enable();
    if state.cancelled.load(Ordering::SeqCst) {
        return Err(t("native.transcription.downloadCancelled"));
    }
    tokio::select! {
        result = work => Ok(result),
        () = stopped => Err(t("native.transcription.downloadCancelled")),
    }
}

#[derive(Serialize, Clone)]
pub struct DownloadProgress {
    done: u64,
    total: u64,
}

/// A file to a ".part" beside it, renamed once complete, so a cut download never passes for a model
async fn download(
    client: &reqwest::Client,
    url: &str,
    target: &Path,
    state: &SpeechDownloads,
    mut on_bytes: impl FnMut(u64),
) -> Result<(), String> {
    let label = target
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let failed = || t_with("native.transcription.downloadFailed", &[("file", &label)]);
    let response = unless_stopped(state, client.get(url).send())
        .await?
        .and_then(|r| r.error_for_status())
        .map_err(|_| failed())?;
    let expected = response.content_length();
    let part = target.with_extension(format!(
        "{}{STAGING}",
        target
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default()
    ));
    let mut out = fs::File::create(&part).map_err(to_message)?;
    let mut written = 0u64;
    let mut response = response;
    loop {
        let chunk = match unless_stopped(state, response.chunk()).await {
            Ok(Ok(Some(chunk))) => chunk,
            Ok(Ok(None)) => break,
            stopped_or_failed => {
                drop(out);
                let _ = fs::remove_file(&part);
                return Err(stopped_or_failed.err().unwrap_or_else(failed));
            }
        };
        out.write_all(&chunk).map_err(to_message)?;
        written += chunk.len() as u64;
        on_bytes(chunk.len() as u64);
    }
    out.flush().map_err(to_message)?;
    drop(out);
    if expected.is_some_and(|expected| expected != written) || written == 0 {
        let _ = fs::remove_file(&part);
        return Err(failed());
    }
    fs::rename(&part, target).map_err(to_message)
}

/// "owner/name", from a repository's name or any address inside it
fn repository_of(input: &str) -> Option<String> {
    let trimmed = input.trim().trim_end_matches('/');
    let path = trimmed
        .strip_prefix("https://huggingface.co/")
        .or_else(|| trimmed.strip_prefix("http://huggingface.co/"))
        .or_else(|| trimmed.strip_prefix("huggingface.co/"))
        .unwrap_or(trimmed);
    let mut parts = path.split('/');
    let (owner, name) = (parts.next()?, parts.next()?);
    let valid = |part: &str| {
        !part.is_empty()
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    (valid(owner) && valid(name) && !name.starts_with('.')).then(|| format!("{owner}/{name}"))
}

/// Among a model's files, the encoder, the decoder and the tokens, the int8 ones when there are both: as light, and
/// as good for speech
fn whisper_files(names: &[String]) -> Option<(String, String, String)> {
    let pick = |part: &str| -> Option<String> {
        let mut found: Vec<&String> = names
            .iter()
            .filter(|n| {
                let lower = n.to_lowercase();
                lower.ends_with(".onnx") && lower.contains(part)
            })
            .collect();
        found.sort_by_key(|n| (!n.to_lowercase().contains("int8"), n.len()));
        found.first().map(|n| n.to_string())
    };
    let encoder = pick("encoder")?;
    let decoder = names
        .iter()
        .find(|n| **n == encoder.replace("encoder", "decoder"))
        .cloned()
        .or_else(|| pick("decoder"))?;
    let tokens = names
        .iter()
        .filter(|n| n.to_lowercase().ends_with("tokens.txt"))
        .min_by_key(|n| n.len())?
        .clone();
    Some((encoder, decoder, tokens))
}

/// A model in Transformers' format, by its files at the top of it: its config, its tokenizer and its weights, in
/// safetensors (maybe in parts) or else in PyTorch's older file; and whether they are the older one
fn transformers_files(names: &[String]) -> Option<(Vec<String>, bool)> {
    let top: Vec<&String> = names.iter().filter(|n| !n.contains('/')).collect();
    let has = |name: &str| top.iter().any(|n| n.as_str() == name);
    if !has(whisper_transformers::CONFIG) || !has(whisper_transformers::TOKENIZER) {
        return None;
    }
    let named = |prefix: &str, extension: &str| -> Vec<String> {
        top.iter()
            .filter(|n| n.starts_with(prefix) && n.ends_with(extension))
            .map(|n| n.to_string())
            .collect()
    };
    let safetensors = named("model", ".safetensors");
    let (weights, pytorch) = if safetensors.is_empty() {
        (named("pytorch_model", ".bin"), true)
    } else {
        (safetensors, false)
    };
    if weights.is_empty() {
        return None;
    }
    let mut files = vec![
        whisper_transformers::CONFIG.to_string(),
        whisper_transformers::TOKENIZER.to_string(),
    ];
    files.extend(weights);
    Some((files, pytorch))
}

/// What to bring of a model: each of its files and the name it takes here, and whether its weights must be turned
/// into safetensors afterwards. The error says why it can't be used.
fn plan_of(
    names: &[String],
    why_not: impl Fn(&str) -> String,
) -> Result<(Vec<(String, String)>, bool), String> {
    if let Some((encoder, decoder, tokens)) = whisper_files(names) {
        return Ok((
            vec![
                (encoder, ENCODER.into()),
                (decoder, DECODER.into()),
                (tokens, TOKENS.into()),
            ],
            false,
        ));
    }
    if let Some((files, pytorch)) = transformers_files(names) {
        return Ok((files.into_iter().map(|f| (f.clone(), f)).collect(), pytorch));
    }
    // A fine-tuning that only keeps what changed, to put on top of another model
    if names.iter().any(|n| n.ends_with("adapter_config.json")) {
        return Err(why_not("native.transcription.adapterOnly"));
    }
    Err(why_not("native.transcription.noWhisperIn"))
}

/// The older PyTorch weights of a model added, turned into safetensors, once
fn convert_weights(staging: &Path) -> Result<(), String> {
    for entry in fs::read_dir(staging).map_err(to_message)?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("pytorch_model") && name.ends_with(".bin") {
            let to = staging.join(
                name.replacen("pytorch_model", "model", 1)
                    .replace(".bin", ".safetensors"),
            );
            whisper_transformers::convert_pytorch(&entry.path(), &to)?;
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

/// A folder name for a new model from its name, different from the ones already here
fn new_id(dir: &Path, name: &str) -> String {
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let base: String = if slug.is_empty() {
        "whisper".to_string()
    } else {
        slug.chars().take(48).collect()
    };
    let root = dir.join(WHISPER_DIR);
    let mut id = base.clone();
    let mut n = 2;
    while root.join(&id).exists() {
        id = format!("{base}-{n}");
        n += 1;
    }
    id
}

/// Runs one way of adding a model: only one at a time, and whatever it leaves half done goes
async fn adding<F, Fut>(state: &SpeechDownloads, work: F) -> Result<WhisperModel, String>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<WhisperModel, String>>,
{
    if state.running.swap(true, Ordering::SeqCst) {
        return Err(t("native.transcription.downloadRunning"));
    }
    state.cancelled.store(false, Ordering::SeqCst);
    let result = work().await;
    state.running.store(false, Ordering::SeqCst);
    result
}

/// The model's folder, complete: its files are in the staging folder and the shared models are downloaded
fn finish(staging: &Path, target: &Path, model: &WhisperModel) -> Result<(), String> {
    fs::write(
        staging.join(INFO),
        serde_json::to_string(model).map_err(to_message)?,
    )
    .map_err(to_message)?;
    fs::rename(staging, target).map_err(to_message)
}

async fn download_shared(
    client: &reqwest::Client,
    dir: &Path,
    state: &SpeechDownloads,
    on_bytes: &mut impl FnMut(u64),
) -> Result<(), String> {
    for name in RETIRED {
        let _ = fs::remove_file(dir.join(name));
    }
    for file in shared_missing(dir) {
        download(
            client,
            file.url,
            &dir.join(file.name),
            state,
            &mut *on_bytes,
        )
        .await?;
    }
    Ok(())
}

/// A Whisper from a Hugging Face repository in sherpa-onnx's format, with the shared models the first time
#[tauri::command]
pub async fn speech_model_add_from_huggingface(
    app: AppHandle,
    state: State<'_, SpeechDownloads>,
    repository: String,
    on_progress: Channel<DownloadProgress>,
) -> Result<WhisperModel, String> {
    let repo = repository_of(&repository).ok_or_else(|| t("native.transcription.badRepository"))?;
    adding(&state, || async {
        let dir = models_dir(&app)?;
        let client = download_client()?;
        let not_found = || {
            t_with(
                "native.transcription.repositoryNotFound",
                &[("repository", &repo)],
            )
        };
        let text = client
            .get(format!(
                "https://huggingface.co/api/models/{repo}?blobs=true"
            ))
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|_| not_found())?
            .text()
            .await
            .map_err(|_| not_found())?;
        let listing: Value = serde_json::from_str(&text).map_err(|_| not_found())?;
        let files: Vec<(String, u64)> = listing["siblings"]
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(|f| {
                        Some((
                            f["rfilename"].as_str()?.to_string(),
                            f["size"].as_u64().unwrap_or(0),
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let names: Vec<String> = files.iter().map(|(n, _)| n.clone()).collect();
        let why_not = |key: &str| t_with(key, &[("place", &repo)]);
        let (plan, pytorch) = plan_of(&names, why_not)?;
        let url_of = |file: &str| format!("https://huggingface.co/{repo}/resolve/main/{file}");
        // Before the weights, which can be gigabytes: that it really is a Whisper
        if names.iter().any(|n| n == whisper_transformers::CONFIG)
            && !plan.iter().any(|(_, local)| local == ENCODER)
        {
            let config = client
                .get(url_of(whisper_transformers::CONFIG))
                .send()
                .await
                .and_then(|r| r.error_for_status())
                .map_err(|_| not_found())?
                .text()
                .await
                .map_err(|_| not_found())?;
            if !whisper_transformers::is_whisper_config(&config) {
                return Err(why_not("native.transcription.notWhisper"));
            }
        }
        let size_of = |name: &str| files.iter().find(|(n, _)| n == name).map_or(0, |(_, s)| *s);
        let shared: u64 = shared_missing(&dir).iter().map(|f| f.bytes).sum();
        let total = plan.iter().map(|(file, _)| size_of(file)).sum::<u64>() + shared;
        let name = repo.split('/').next_back().unwrap_or(&repo).to_string();
        let id = new_id(&dir, &name);
        let target = dir.join(WHISPER_DIR).join(&id);
        let staging = dir.join(WHISPER_DIR).join(format!("{id}{STAGING}"));
        fs::create_dir_all(&staging).map_err(to_message)?;
        let mut done = 0u64;
        let mut on_bytes = |bytes: u64| {
            done += bytes;
            let _ = on_progress.send(DownloadProgress { done, total });
        };
        let result = async {
            for (file, local) in &plan {
                download(
                    &client,
                    &url_of(file),
                    &staging.join(local),
                    &state,
                    &mut on_bytes,
                )
                .await?;
            }
            if pytorch {
                convert_weights(&staging)?;
            }
            download_shared(&client, &dir, &state, &mut on_bytes).await?;
            let model = WhisperModel {
                id,
                name,
                source: "huggingface".into(),
                origin: repo.clone(),
                bytes: 0,
                format: String::new(),
            };
            finish(&staging, &target, &model)?;
            Ok(model)
        }
        .await;
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging);
        }
        result
    })
    .await
}

/// A Whisper from a folder the user picks, copied here; None when the picker is closed
#[tauri::command]
pub async fn speech_model_add_from_folder(
    app: AppHandle,
    state: State<'_, SpeechDownloads>,
    on_progress: Channel<DownloadProgress>,
) -> Result<Option<WhisperModel>, String> {
    // The dialog waits for the user, and the copies below can be gigabytes: neither holds an async thread
    let picking = app.clone();
    let Some(folder) =
        crate::workspace::blocking(move || picking.dialog().file().blocking_pick_folder()).await?
    else {
        return Ok(None);
    };
    let folder = folder.into_path().map_err(to_message)?;
    let names: Vec<String> = fs::read_dir(&folder)
        .map_err(to_message)?
        .flatten()
        .filter(|e| e.path().is_file())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    let place = folder.display().to_string();
    let why_not = |key: &str| t_with(key, &[("place", &place)]);
    let (plan, pytorch) = plan_of(&names, why_not)?;
    let config = folder.join(whisper_transformers::CONFIG);
    if !plan.iter().any(|(_, local)| local == ENCODER)
        && !fs::read_to_string(&config)
            .is_ok_and(|text| whisper_transformers::is_whisper_config(&text))
    {
        return Err(why_not("native.transcription.notWhisper"));
    }
    let model = adding(&state, || async {
        let dir = models_dir(&app)?;
        let name = folder
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "whisper".to_string());
        let id = new_id(&dir, &name);
        let target = dir.join(WHISPER_DIR).join(&id);
        let staging = dir.join(WHISPER_DIR).join(format!("{id}{STAGING}"));
        fs::create_dir_all(&staging).map_err(to_message)?;
        let total: u64 = shared_missing(&dir).iter().map(|f| f.bytes).sum();
        let mut done = 0u64;
        let mut on_bytes = |bytes: u64| {
            done += bytes;
            let _ = on_progress.send(DownloadProgress { done, total });
        };
        let result = async {
            let (plan, from, into) = (plan.clone(), folder.clone(), staging.clone());
            crate::workspace::blocking(move || -> Result<(), String> {
                for (file, local) in &plan {
                    fs::copy(from.join(file), into.join(local)).map_err(to_message)?;
                }
                if pytorch {
                    convert_weights(&into)?;
                }
                Ok(())
            })
            .await??;
            download_shared(&download_client()?, &dir, &state, &mut on_bytes).await?;
            let model = WhisperModel {
                id,
                name,
                source: "folder".into(),
                origin: place.clone(),
                bytes: 0,
                format: String::new(),
            };
            finish(&staging, &target, &model)?;
            Ok(model)
        }
        .await;
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging);
        }
        result
    })
    .await?;
    Ok(Some(model))
}

#[tauri::command]
pub fn speech_models_cancel(state: State<'_, SpeechDownloads>) {
    state.cancelled.store(true, Ordering::SeqCst);
    state.stop.notify_waiters();
}

/// A Whisper goes; with the last one, the shared models go too
#[tauri::command]
pub fn speech_models_delete(app: AppHandle, id: String) -> Result<(), String> {
    if !is_plain_id(&id) {
        return Err(t("native.transcription.unknownModel"));
    }
    let dir = models_dir(&app)?;
    let _ = fs::remove_dir_all(dir.join(WHISPER_DIR).join(&id));
    if list_models(&dir).is_empty() {
        for file in SHARED.iter().chain(LANGUAGE.iter()) {
            let _ = fs::remove_file(dir.join(file.name));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn stopping_cuts_a_download_waiting_on_the_network() {
        let state = std::sync::Arc::new(SpeechDownloads::default());
        let waiting = {
            let state = std::sync::Arc::clone(&state);
            tokio::spawn(async move { unless_stopped(&state, std::future::pending::<()>()).await })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        state.cancelled.store(true, Ordering::SeqCst);
        state.stop.notify_waiters();
        let outcome = tokio::time::timeout(Duration::from_secs(2), waiting).await;
        assert!(outcome.expect("still waiting").expect("joined").is_err());
        // Stopped before it starts waiting, it doesn't wait at all
        assert!(unless_stopped(&state, std::future::pending::<()>())
            .await
            .is_err());
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "nyra-speech-{name}-{}",
            crate::storage::now_millis()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reads_a_repository_from_its_name_or_an_address() {
        let want = Some("csukuangfj/sherpa-onnx-whisper-medium".to_string());
        assert_eq!(repository_of("csukuangfj/sherpa-onnx-whisper-medium"), want);
        assert_eq!(
            repository_of("https://huggingface.co/csukuangfj/sherpa-onnx-whisper-medium/tree/main"),
            want
        );
        assert_eq!(
            repository_of(" huggingface.co/csukuangfj/sherpa-onnx-whisper-medium/ "),
            want
        );
        assert_eq!(repository_of("medium"), None);
        assert_eq!(repository_of("a/../b"), None);
        assert_eq!(repository_of("owner/na me"), None);
    }

    #[test]
    fn finds_a_whisper_among_a_models_files_preferring_int8() {
        let names: Vec<String> = [
            "README.md",
            "medium-encoder.onnx",
            "medium-encoder.int8.onnx",
            "medium-decoder.onnx",
            "medium-decoder.int8.onnx",
            "medium-tokens.txt",
            "test_wavs/0.wav",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(
            whisper_files(&names),
            Some((
                "medium-encoder.int8.onnx".to_string(),
                "medium-decoder.int8.onnx".to_string(),
                "medium-tokens.txt".to_string()
            ))
        );
        // The original Whisper, or whisper.cpp's file, isn't sherpa-onnx's
        assert_eq!(
            whisper_files(&["model.safetensors".into(), "ggml-medium.bin".into()]),
            None
        );
    }

    #[test]
    fn names_a_new_model_without_clashing() {
        let dir = temp_dir("ids");
        assert_eq!(
            new_id(&dir, "Sherpa ONNX Whisper Medium"),
            "sherpa-onnx-whisper-medium"
        );
        fs::create_dir_all(dir.join(WHISPER_DIR).join("medium")).unwrap();
        assert_eq!(new_id(&dir, "medium"), "medium-2");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn keeps_the_sizes_an_earlier_version_downloaded_as_models_of_the_user() {
        let dir = temp_dir("adopt");
        for part in ["encoder.int8.onnx", "decoder.int8.onnx", "tokens.txt"] {
            fs::write(dir.join(format!("small-{part}")), b"x").unwrap();
        }
        adopt_built_in(&dir);
        let models = list_models(&dir);
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "small");
        // Small tells the language: only the voice and speaker models are missing
        assert_eq!(
            language_files(&dir).unwrap().0,
            dir.join(WHISPER_DIR).join("small").join(ENCODER)
        );
        assert_eq!(shared_missing(&dir).len(), SHARED.len());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_new_install_also_needs_the_whisper_that_tells_the_language() {
        let dir = temp_dir("fresh");
        assert_eq!(shared_missing(&dir).len(), SHARED.len() + LANGUAGE.len());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn takes_a_community_model_as_published_and_says_why_not_when_it_cant() {
        let names = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let why = |key: &str| key.to_string();
        // Safetensors in parts, beside files of training that aren't needed
        let (plan, pytorch) = plan_of(
            &names(&[
                "config.json",
                "tokenizer.json",
                "model-00001-of-00002.safetensors",
                "model-00002-of-00002.safetensors",
                "model.safetensors.index.json",
                "training_args.bin",
                "README.md",
            ]),
            why,
        )
        .unwrap();
        assert!(!pytorch);
        assert_eq!(plan.len(), 4);
        // Only the older PyTorch file: brought and turned into safetensors
        let (plan, pytorch) = plan_of(
            &names(&["config.json", "tokenizer.json", "pytorch_model.bin"]),
            why,
        )
        .unwrap();
        assert!(pytorch);
        assert!(plan.iter().any(|(file, _)| file == "pytorch_model.bin"));
        // An adapter alone, or files of another kind, can't be used
        assert_eq!(
            plan_of(
                &names(&["adapter_config.json", "adapter_model.safetensors"]),
                why
            )
            .unwrap_err(),
            "native.transcription.adapterOnly"
        );
        assert_eq!(
            plan_of(&names(&["ggml-medium.bin"]), why).unwrap_err(),
            "native.transcription.noWhisperIn"
        );
        // Without its tokenizer it can't be read either
        assert!(plan_of(&names(&["config.json", "model.safetensors"]), why).is_err());
    }
}
