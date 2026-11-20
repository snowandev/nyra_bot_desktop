import { useSyncExternalStore } from "react";
import { i18n } from "@/shared/i18n/i18n";
import { errorMessage } from "@/shared/lib/errors";
import { loadPreferences } from "@/shared/storage/settings";
import type { Attachment } from "@/shared/types";
import { discardMeetingRecording, onMeetingEnded, startMeetingRecording, stopMeetingRecording } from "./meetingStorage";

// systemError: only the microphone is recorded, and why
export type MeetingState =
  | { phase: "idle"; error: string | null }
  | { phase: "starting" }
  | { phase: "recording"; startedAt: number; systemError: string | null }
  | { phase: "stopping" };

// Out of React: the recording goes on while the user moves between conversations, and the box showing it changes
let state: MeetingState = { phase: "idle", error: null };
// A recording that ended by itself, for the box on screen to attach
let endedByItself: Attachment | null = null;
let listensForTheEnd = false;
const listeners = new Set<() => void>();

function enter(next: MeetingState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const read = () => state;

export const useMeeting = () => useSyncExternalStore(subscribe, read, read);

const pad = (n: number) => String(n).padStart(2, "0");

// The recording as an attached audio, named after when it started
export function meetingAttachment(recorded: { id: string; duration: number }, startedAt: Date): Attachment {
  const date =
    `${startedAt.getFullYear()}-${pad(startedAt.getMonth() + 1)}-${pad(startedAt.getDate())} ` +
    `${pad(startedAt.getHours())}.${pad(startedAt.getMinutes())}`;
  return {
    id: recorded.id,
    kind: "audio",
    name: i18n.t("meeting.fileName", { date }),
    mimeType: "audio/wav",
    data: "",
    duration: recorded.duration,
    meeting: true,
  };
}

export async function record() {
  if (state.phase !== "idle") return;
  enter({ phase: "starting" });
  if (!listensForTheEnd) {
    listensForTheEnd = true;
    void onMeetingEnded(() => void stopByItself());
  }
  try {
    const { systemError } = await startMeetingRecording(crypto.randomUUID(), loadPreferences().microphone?.id ?? null);
    enter({ phase: "recording", startedAt: Date.now(), systemError });
  } catch (e) {
    enter({ phase: "idle", error: errorMessage(e) });
  }
}

// Stops it and gives its audio to attach; null if it couldn't be kept, the reason shown
export async function stopRecording(): Promise<Attachment | null> {
  if (state.phase !== "recording") return null;
  const startedAt = new Date(state.startedAt);
  enter({ phase: "stopping" });
  try {
    const recorded = await stopMeetingRecording();
    enter({ phase: "idle", error: null });
    return meetingAttachment(recorded, startedAt);
  } catch (e) {
    enter({ phase: "idle", error: errorMessage(e) });
    return null;
  }
}

async function stopByItself() {
  const audio = await stopRecording();
  if (!audio) return;
  endedByItself = audio;
  // A new state, so the box on screen draws again and takes it
  enter({ phase: "idle", error: null });
}

// The recording that ended by itself, once
export function takeEndedRecording() {
  const audio = endedByItself;
  endedByItself = null;
  return audio;
}

export async function discardRecording() {
  if (state.phase !== "recording") return;
  enter({ phase: "stopping" });
  try {
    await discardMeetingRecording();
    enter({ phase: "idle", error: null });
  } catch (e) {
    enter({ phase: "idle", error: errorMessage(e) });
  }
}

export function dismissMeetingError() {
  if (state.phase === "idle") enter({ phase: "idle", error: null });
}
