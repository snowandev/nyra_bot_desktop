import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Rust captures the screen where the mouse is and draws the marks over it, in a window of its own that clicks go
// through. Places on the screen are fractions of its width and height.

export type ScreenArea = { x: number; y: number; width: number; height: number };
// from: where its arrow starts, when it has one
export type ScreenMark = { number: number; area: ScreenArea; note: string; from?: ScreenArea };
// A JPEG, base64, at the size the model reads
type ScreenView = { image: string; width: number; height: number };
type ScreenZoom = { image: string; area: ScreenArea; width: number; height: number };
// The largest image the model reads well, when it says so: its width and pixels at most
export type ScreenFit = { width: number; pixels: number };

// Only where the capture works: macOS and Windows
export const screenLookAvailable = () => invoke<boolean>("screen_look_available");
// Takes the marks away first, so the capture is of the screen alone
export const screenLook = (conversationId: string, fit?: ScreenFit) =>
  invoke<ScreenView>("screen_look", { conversationId, fit: fit ?? null });
// The latest capture with more detail, to find something on a screen of many points (a 4K one at scale 1×); null when
// the view already has it
export const screenOverview = (conversationId: string, fit?: ScreenFit) =>
  invoke<ScreenView | null>("screen_overview", { conversationId, fit: fit ?? null });
// The latest capture, bigger around a point
export const screenZoom = (conversationId: string, x: number, y: number, fit?: ScreenFit) =>
  invoke<ScreenZoom>("screen_zoom", { conversationId, x, y, fit: fit ?? null });
// What a mark covers, close up and outlined: a PNG, base64
export const screenCloseUp = (conversationId: string, area: ScreenArea, fit?: ScreenFit) =>
  invoke<string>("screen_close_up", { conversationId, area, fit: fit ?? null });
// Replaces the marks on the screen; none takes them away
export const screenMark = (conversationId: string, marks: ScreenMark[]) =>
  invoke<void>("screen_mark", { conversationId, marks });
export const screenClear = () => invoke<void>("screen_clear");

// While guiding: waits until the user does the step (the screen changed around near, or much of it), comparing it
// without the model, and gives the screen as it is then
export type Watched = { kind: "changed"; view: ScreenView } | { kind: "stopped" } | { kind: "idle" };
// run names this wait, to stop it; a stop that arrives first still counts
export const screenWatch = (conversationId: string, run: string, near: ScreenArea | null, fit?: ScreenFit) =>
  invoke<Watched>("screen_watch", { conversationId, run, near, fit: fit ?? null });
export const screenWatchStop = (run: string) => invoke<void>("screen_watch_stop", { run });

// What Nyra does with the user's mouse and keyboard; places are those of the latest look
export type ScreenAct =
  | { kind: "click"; at: ScreenArea; press: "left" | "right" | "double"; note: string }
  | { kind: "scroll"; at: ScreenArea; lines: number; horizontal: boolean; note: string }
  | { kind: "type"; at?: ScreenArea; text: string; enter: boolean; note: string }
  | { kind: "key"; keys: string; note: string };
// stopped: the user pressed "Stop" while Nyra's pointer was on its way; ownWindow: the place is Nyra's own window;
// ownKeyboard: the keyboard is in Nyra's own window, so nothing was typed
export type Acted = "done" | "stopped" | "ownWindow" | "ownKeyboard";
export const screenAct = (conversationId: string, action: ScreenAct) =>
  invoke<Acted>("screen_act", { conversationId, action });
// Between two actions: the pointer stays and says it is working out the next one
export const screenActThinking = (conversationId: string, label: string) =>
  invoke<void>("screen_act_thinking", { conversationId, label });
// The task ended or the user stopped it: a click on its way doesn't happen, and Nyra's pointer goes with a goodbye.
// farewell: what it says first, when the task ended by itself
export const screenActEnd = (conversationId: string, farewell: string | null) =>
  invoke<void>("screen_act_end", { conversationId, farewell });

// Where the marked screen is inside the marks window, in its CSS pixels: measured from where the window really is
export type ScreenFrame = { left: number; top: number; width: number; height: number };
// Nyra's own pointer while it uses the mouse and keyboard: where it is, in fractions of the screen, and what it says;
// how long it glides there, where it first comes out (the user's mouse) and how many clicks it made
export type ScreenPointer = {
  x: number;
  y: number;
  label: string;
  glideMs: number;
  start: [number, number] | null;
  clicks: number;
  // Waiting for the model's next step
  thinking: boolean;
  // Playing its goodbye, at the end of the task
  leaving: boolean;
};

// The marks window: what to draw and where, where its notes are, and the note the user clicked
export const screenMarksNow = () =>
  invoke<{ marks: ScreenMark[]; frame: ScreenFrame | null; pointer: ScreenPointer | null }>("screen_marks_now");
export const screenNoteAreas = (areas: { number: number; x: number; y: number; width: number; height: number }[]) =>
  invoke<void>("screen_note_areas", { areas });
export const screenCloseMark = (number: number) => invoke<void>("screen_close_mark", { number });
// The marks changed (the marks window reads them again, with where the screen is now)
export const onScreenMarks = (handler: (marks: ScreenMark[]) => void) =>
  listen<ScreenMark[]>("screen-marks", ({ payload }) => handler(payload));
