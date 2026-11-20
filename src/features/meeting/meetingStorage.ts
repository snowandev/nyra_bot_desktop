import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// A meeting is recorded in Rust, the microphone and the computer's sound into one stored audio

// systemError: why the computer's sound isn't recorded, when only the microphone is
export const startMeetingRecording = (id: string, microphone: string | null) =>
  invoke<{ systemError: string | null }>("meeting_start", { id, microphone });

// The stored audio, under the id it started with, and how long it lasts in seconds
export const stopMeetingRecording = () => invoke<{ id: string; duration: number }>("meeting_stop");

export const discardMeetingRecording = () => invoke<void>("meeting_discard");

// It reached the longest a transcription takes: the page stops it as the user would
export const onMeetingEnded = (handler: () => void) => listen("meeting-ended", () => handler());
