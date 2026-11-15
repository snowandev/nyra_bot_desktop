import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import type { QuickSize } from "@/shared/storage/settings";

// The quick chat bar's window lives in Rust: its size, where it is and when it shows

// The content's height; the window keeps its bottom edge, so it grows upwards
export const resizeQuick = (height: number) => invoke<void>("resize_quick", { height });
// How big the chat may grow, from Settings → Chat rápido; gives the most it may grow upwards on this screen
export const setQuickSize = (size: QuickSize) => invoke<number>("set_quick_size", { size });
// From the bar's handle: the system moves the window, and its place is kept
export const dragQuick = () => invoke<void>("drag_quick");
// Forgets where the user left it: back to the bottom of the screen, centred
export const resetQuickPosition = () => invoke<void>("reset_quick_position");
export const hideQuick = () => invoke<void>("hide_quick");
// Pinned, clicking another app doesn't hide it
export const setQuickPinned = (pinned: boolean) => invoke<void>("set_quick_pinned", { pinned });
// An area of the screen, with the bar out of the way; empty if the user cancelled. Linux still lacks its own way
export const captureFromQuick = () => invoke<ArrayBuffer>("capture_from_quick");
export const canCaptureScreen = /Mac|Windows/.test(navigator.userAgent);
// "Abrir Nyra": the main window comes forward and the bar hides
export const openMainFromQuick = () => invoke<void>("open_main_from_quick");
// Each time it shows, and each time it hides (shortcut, Esc, a click elsewhere)
export const onQuickShown = (handler: () => void) => listen("nyra://quick-shown", handler);
export const onQuickHidden = (handler: () => void) => listen("nyra://quick-hidden", handler);

// Between the bar and the main window: a conversation the bar saved, for the main window's list, and one to go on
// with in the main window
const SAVED_EVENT = "nyra://quick-saved";
const CONTINUE_EVENT = "nyra://quick-continue";

export const announceQuickSaved = (conversationId: string) => emitTo("main", SAVED_EVENT, conversationId);
export async function continueInMain(conversationId: string) {
  await emitTo("main", CONTINUE_EVENT, conversationId);
  await openMainFromQuick();
}
export const onQuickSaved = (handler: (conversationId: string) => void) =>
  listen<string>(SAVED_EVENT, (event) => handler(event.payload));
export const onQuickContinue = (handler: (conversationId: string) => void) =>
  listen<string>(CONTINUE_EVENT, (event) => handler(event.payload));

// What Settings shows about the shortcut: the one in use, whether it works, and how to open the bar without one
export type ShortcutStatus = {
  shortcut: string | null;
  registered: boolean;
  error: string | null;
  // Linux on Wayland: the desktop makes the shortcut, running command
  wayland: boolean;
  command: string;
};

// null turns it off
export const setQuickShortcut = (shortcut: string | null) => invoke<ShortcutStatus>("set_quick_shortcut", { shortcut });
export const quickShortcutStatus = () => invoke<ShortcutStatus>("quick_shortcut_status");
export const onQuickShortcutStatus = (handler: (status: ShortcutStatus) => void) =>
  listen<ShortcutStatus>("nyra://quick-shortcut", (event) => handler(event.payload));

// macOS and Windows draw it translucent with the system's blur; many Linux desktops can't, so it is solid there
export const quickIsSolid = !/Mac|Windows/.test(navigator.userAgent);
