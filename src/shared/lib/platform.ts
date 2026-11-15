import { i18n } from "@/shared/i18n/i18n";

// Shortcuts use Cmd on macOS and Ctrl on Windows and Linux
const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
const isWindows = /Windows/.test(navigator.userAgent);

// For texts that each system writes its own way, like keyboard shortcuts
export type Platform = "mac" | "windows" | "linux";

export const platformName: Platform = isMac ? "mac" : isWindows ? "windows" : "linux";

// Each system calls its file manager differently
export const revealLabel = () => i18n.t(`platform.reveal.${platformName}`);

// Where each system puts the icons of the apps that keep running
export const trayLabel = () => i18n.t(`platform.tray.${platformName}`);
// Linux shows the tray only where the desktop has one: GNOME needs the AppIndicator extension
export const trayMayBeHidden = !isMac && !isWindows;

// Shift must match exactly, so ⌘F and ⌘⇧F are different shortcuts
export function isShortcut(event: KeyboardEvent, key: string, withShift = false) {
  const modifier = isMac ? event.metaKey : event.ctrlKey;
  return modifier && !event.altKey && event.shiftKey === withShift && event.key.toLowerCase() === key;
}

// The key the shortcuts use, as each keyboard labels it
export const modifierLabel = isMac ? "⌘" : "Ctrl";

// Option on macOS, Alt elsewhere, as each keyboard labels it
export const altLabel = isMac ? "⌥" : "Alt+";

export function shortcutLabel(key: string, withShift = false) {
  if (isMac) return `${withShift ? "⇧" : ""}⌘${key.toUpperCase()}`;
  return `Ctrl+${withShift ? "Shift+" : ""}${key.toUpperCase()}`;
}
