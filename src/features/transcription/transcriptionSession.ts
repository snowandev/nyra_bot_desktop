import { useSyncExternalStore } from "react";
import type { TranscriptionStage } from "./transcriptionStorage";

// The transcription a reply is making in each conversation, for the strip above the composer: waiting for the user
// to download the model, or on its way. Only while it lasts; its result goes with the user's message.

export type TranscriptionState = { kind: "needsModel" } | { kind: TranscriptionStage; progress: number };
type Transcription = { name: string; state: TranscriptionState; cancel: () => void };

const sessions = new Map<string, Transcription>();
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

export function showTranscription(conversationId: string, transcription: Transcription) {
  sessions.set(conversationId, transcription);
  notify();
}

export function endTranscription(conversationId: string) {
  if (sessions.delete(conversationId)) notify();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useTranscription(conversationId: string) {
  const read = () => sessions.get(conversationId) ?? null;
  return useSyncExternalStore(subscribe, read, read);
}
