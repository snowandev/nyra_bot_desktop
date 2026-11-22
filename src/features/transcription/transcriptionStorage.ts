import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Audio is transcribed in Rust, on this computer, with the Whisper models the user added

// source: "huggingface" (origin is the repository) or "folder" (origin is where it was copied from). format: the
// community's Transformers one, run with candle, or sherpa-onnx's.
export type WhisperModel = {
  id: string;
  name: string;
  source: "huggingface" | "folder";
  origin: string;
  bytes: number;
  format: "transformers" | "onnx";
};
// sharedDownloadBytes: what the models every Whisper needs still take, downloaded with the next one added
export type SpeechModelsStatus = { models: WhisperModel[]; sharedDownloadBytes: number };

export const speechModelsStatus = () => invoke<SpeechModelsStatus>("speech_models_status");

function progressChannel(onProgress: (done: number, total: number) => void) {
  const channel = new Channel<{ done: number; total: number }>();
  channel.onmessage = ({ done, total }) => onProgress(done, total);
  return channel;
}

// repository: "user/name" or its address
export const addSpeechModelFromHuggingFace = (repository: string, onProgress: (done: number, total: number) => void) =>
  invoke<WhisperModel>("speech_model_add_from_huggingface", { repository, onProgress: progressChannel(onProgress) });

// Opens the folder picker; null when it is closed
export const addSpeechModelFromFolder = (onProgress: (done: number, total: number) => void) =>
  invoke<WhisperModel | null>("speech_model_add_from_folder", { onProgress: progressChannel(onProgress) });

export const cancelSpeechDownload = () => invoke<void>("speech_models_cancel");
export const deleteSpeechModel = (id: string) => invoke<void>("speech_models_delete", { id });

// One line: in seconds, and the speaker from 1 when they were told apart. you: the user, in a meeting Nyra recorded.
export type TranscriptLine = { start: number; end: number; speaker: number | null; text: string; you?: boolean };

export type TranscriptionStage = "reading" | "speakers" | "transcribing";

// An attached audio is kept as a file in Nyra's data folder, under its attachment's id; its raw bytes go as the body.
// Resolves to how long it lasts, in seconds.
export const storeAudio = (bytes: ArrayBuffer, id: string, extension: string) =>
  invoke<number>("store_audio", bytes, { headers: { "x-id": id, "x-extension": extension } });

// Where the webview plays a stored audio from: streamed from its file, never loaded whole
export const playableAudio = async (id: string, extension: string) =>
  convertFileSrc(await invoke<string>("audio_path", { id, extension }));

// The files of these attached audios go now, as a private conversation closes
export const forgetAudio = (ids: string[]) => invoke<void>("forget_audio", { ids });

// Its progress arrives as events under the audio's id
// speakerCount: how many the user said speak; one means no telling apart, none lets Nyra guess
export const transcribeStoredAudio = (options: {
  id: string;
  extension: string;
  // The Whisper's id
  model: string;
  speakers: boolean;
  speakerCount: number | null;
  meeting: boolean;
  // This run's own id, the one it is stopped by
  run: string;
}) => invoke<TranscriptLine[]>("transcribe_stored_audio", options);

export const cancelTranscription = (run: string) => invoke<void>("transcription_cancel", { run });

export const onTranscriptionProgress = (
  handler: (progress: { id: string; stage: TranscriptionStage; progress: number }) => void,
) =>
  listen<{ id: string; stage: TranscriptionStage; progress: number }>("transcription-progress", ({ payload }) =>
    handler(payload),
  );
