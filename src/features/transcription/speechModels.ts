import { useEffect, useSyncExternalStore } from "react";
import { errorMessage } from "@/shared/lib/errors";
import {
  addSpeechModelFromFolder,
  addSpeechModelFromHuggingFace,
  cancelSpeechDownload,
  deleteSpeechModel,
  speechModelsStatus,
  type SpeechModelsStatus,
  type WhisperModel,
} from "./transcriptionStorage";

// The Whisper models as Settings, dictation and an attached audio all see them: those added, and the one being added,
// wherever it was started

// What is being added: from where, and how far its download is (the shared models count in it the first time)
type SpeechAdding = { from: string; done: number; total: number };
type SpeechModelsState = {
  status: SpeechModelsStatus | null;
  adding: SpeechAdding | null;
  error: string | null;
};

let state: SpeechModelsState = { status: null, adding: null, error: null };
const listeners = new Set<() => void>();
// Stopped by the user: its end isn't an error to show
let cancelling = false;

function set(change: Partial<SpeechModelsState>) {
  state = { ...state, ...change };
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export async function refreshSpeechModels() {
  try {
    const status = await speechModelsStatus();
    set({ status });
    return status;
  } catch (e) {
    set({ error: errorMessage(e) });
    return null;
  }
}

// The model to use: the chosen one if it is still there, else the first one added; null when there is none
export function activeModel(status: SpeechModelsStatus | null, chosen: string | null): WhisperModel | null {
  const models = status?.models ?? [];
  return models.find((m) => m.id === chosen) ?? models[0] ?? null;
}

// Resolves with the model added, or null when it wasn't (closed picker, stopped, failed: then the error says why)
async function add(from: string, run: (onProgress: (done: number, total: number) => void) => Promise<WhisperModel | null>) {
  if (state.adding) return null;
  cancelling = false;
  set({ adding: { from, done: 0, total: 0 }, error: null });
  try {
    return await run((done, total) => set({ adding: { from, done, total } }));
  } catch (e) {
    if (!cancelling) set({ error: errorMessage(e) });
    return null;
  } finally {
    set({ adding: null });
    await refreshSpeechModels();
  }
}

export const addFromHuggingFace = (repository: string) =>
  add(repository.trim(), (onProgress) => addSpeechModelFromHuggingFace(repository, onProgress));

export const addFromFolder = () => add("", (onProgress) => addSpeechModelFromFolder(onProgress));

export function cancelAdding() {
  cancelling = true;
  void cancelSpeechDownload();
}

export async function removeModel(id: string) {
  try {
    await deleteSpeechModel(id);
  } catch (e) {
    set({ error: errorMessage(e) });
  }
  await refreshSpeechModels();
}

// Resolves with a model to use once there is one, maybe added in Settings meanwhile; rejects if the wait is stopped
export function whenModelReady(chosen: () => string | null, signal: AbortSignal) {
  return new Promise<WhisperModel>((resolve, reject) => {
    const check = () => {
      const model = activeModel(state.status, chosen());
      if (!model) return;
      stop();
      resolve(model);
    };
    const abort = () => {
      stop();
      reject(new DOMException("Stopped", "AbortError"));
    };
    const unsubscribe = subscribe(check);
    const stop = () => {
      unsubscribe();
      signal.removeEventListener("abort", abort);
    };
    signal.addEventListener("abort", abort);
    check();
  });
}

const read = () => state;

export function useSpeechModels() {
  useEffect(() => {
    if (!state.status) void refreshSpeechModels();
  }, []);
  return useSyncExternalStore(subscribe, read, read);
}

export const percentOf = (adding: SpeechAdding) =>
  adding.total > 0 ? Math.min(100, Math.round((adding.done / adding.total) * 100)) : 0;
