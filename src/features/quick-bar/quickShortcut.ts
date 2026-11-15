import { i18n } from "@/shared/i18n/i18n";
import type { Platform } from "@/shared/lib/platform";

// The quick chat bar's global shortcut, kept as the plugin reads it ("Control+Shift+KeyK"): modifiers, then the
// key by its position on the keyboard, so it doesn't change with the keyboard's language

type KeyPress = { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; code: string };

// Pressing only these is still choosing; a shortcut needs another key with them
const MODIFIER_KEYS = /^(Meta|Control|Alt|Shift|OS)(Left|Right)?$/;

// The combination being pressed, or null while it isn't one: it needs Cmd, Ctrl, Alt or Super, since a shortcut with
// only Shift would take a capital letter from every app
export function acceleratorFromKeys(press: KeyPress): string | null {
  if (MODIFIER_KEYS.test(press.code) || !press.code) return null;
  const modifiers = [
    press.ctrlKey && "Control",
    press.altKey && "Alt",
    press.shiftKey && "Shift",
    press.metaKey && "Super",
  ].filter((m): m is string => !!m);
  if (!modifiers.some((m) => m !== "Shift")) return null;
  return [...modifiers, press.code].join("+");
}

const MAC_MODIFIERS: Record<string, string> = {
  CommandOrControl: "⌘",
  Super: "⌘",
  Control: "⌃",
  Alt: "⌥",
  Shift: "⇧",
};
const PC_MODIFIERS: Record<string, string> = {
  CommandOrControl: "Ctrl",
  Super: "Win",
  Control: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
};
// Keys named with a word, which the interface's language says its own way
const WORD_KEYS = { Space: "space", Enter: "enter", Backspace: "backspace" } as const;
const KEY_NAMES: Record<string, string> = {
  Tab: "Tab",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

function keyName(code: string) {
  if (code in WORD_KEYS) return i18n.t(`quick.keys.${WORD_KEYS[code as keyof typeof WORD_KEYS]}`);
  return KEY_NAMES[code] ?? code.replace(/^Key|^Digit/, "");
}

// As each system writes it: "⌘⇧Espacio" on macOS, "Ctrl+Shift+Espacio" on Windows and Linux ("Super" there for the
// key Windows calls Win)
export function acceleratorLabel(accelerator: string, platform: Platform) {
  const parts = accelerator.split("+");
  const key = keyName(parts.pop() ?? "");
  if (platform === "mac") return parts.map((m) => MAC_MODIFIERS[m] ?? m).join("") + key;
  const names = parts.map((m) => (m === "Super" && platform === "linux" ? "Super" : (PC_MODIFIERS[m] ?? m)));
  return [...names, key].join("+");
}
