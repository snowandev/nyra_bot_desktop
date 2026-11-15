import { useCallback, useSyncExternalStore } from "react";

// Unsent text by place (a conversation, the welcome screen, a project's home), for as long as Nyra is open: going
// to the other space or to another conversation and back finds it again. Never written to disk. Kept outside React
// so another part of the screen can add to it (a file of the project panel into the message).
const drafts = new Map<string, string>();
const listeners = new Set<() => void>();
// The places with text, as one string: it only changes when a place gains or loses its text, not on every key
let placesSnapshot = "";

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function write(place: string, text: string) {
  if (text) drafts.set(place, text);
  else drafts.delete(place);
  const places = [...drafts.keys()].filter((key) => drafts.get(key)?.trim()).sort().join("\n");
  placesSnapshot = places;
  listeners.forEach((listener) => listener());
}

export function useDraft(place: string) {
  const draft = useSyncExternalStore(subscribe, () => drafts.get(place) ?? "");
  const setDraft = useCallback(
    (next: string | ((current: string) => string)) =>
      write(place, typeof next === "function" ? next(drafts.get(place) ?? "") : next),
    [place],
  );
  return [draft, setDraft] as const;
}

// For what only reads or writes it when something happens (sending, an undo), without being drawn again on every key
export const draftOf = (place: string) => drafts.get(place) ?? "";
export const setDraftOf = (place: string, text: string) => write(place, text);

// Adds text at the end of a place's draft, after a space
export function appendToDraft(place: string, text: string) {
  const current = drafts.get(place) ?? "";
  write(place, current && !/\s$/.test(current) ? `${current} ${text}` : `${current}${text}`);
}

// The places that have unsent text right now
export function useDraftPlaces() {
  const snapshot = useSyncExternalStore(subscribe, () => placesSnapshot);
  return snapshot ? snapshot.split("\n") : [];
}
