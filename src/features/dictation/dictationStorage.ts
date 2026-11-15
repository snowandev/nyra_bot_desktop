import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// The microphone is recorded in Rust and written there with the Whisper chosen for audio

// model: the Whisper's id
export const startDictation = (model: string) => invoke<void>("dictation_start", { model });

// What was said; empty if nothing was
export const stopDictation = (model: string) => invoke<string>("dictation_stop", { model });

// Recording, it stops and forgets it; being written, it stops at the next phrase
export const cancelDictation = () => invoke<void>("dictation_cancel");

// How loud the voice is now, from 0 to 1, about ten times a second while recording
export const onDictationLevel = (handler: (level: number) => void) =>
  listen<{ level: number }>("dictation-level", ({ payload }) => handler(payload.level));

// It reached its limit: the page stops it as the user would
export const onDictationEnded = (handler: () => void) => listen("dictation-ended", () => handler());
