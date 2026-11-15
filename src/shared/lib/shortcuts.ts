import type { ParseKeys } from "i18next";
import { i18n } from "@/shared/i18n/i18n";
import { altLabel, shortcutLabel } from "./platform";

// The app's keyboard shortcuts, with ⌘ on macOS and Ctrl on Windows and Linux. The code that listens for each one
// and Settings → Comandos y atajos both read them from here, so the list shown never drifts from what works.
export type Shortcut = {
  // As KeyboardEvent.key, lowercase
  key: string;
  withShift?: boolean;
  // How the key is drawn when it isn't a letter, e.g. ↩ for Enter
  symbol?: string;
  // Catalog keys, read in the interface's language when shown
  action: ParseKeys;
  detail?: ParseKeys;
};

export const SHORTCUTS = {
  chatSpace: { key: "1", action: "shortcuts.chatSpace.action", detail: "shortcuts.chatSpace.detail" },
  codeSpace: { key: "2", action: "shortcuts.codeSpace.action", detail: "shortcuts.codeSpace.detail" },
  newConversation: { key: "n", action: "shortcuts.newConversation.action", detail: "shortcuts.newConversation.detail" },
  newPrivateConversation: {
    key: "n",
    withShift: true,
    action: "shortcuts.newPrivateConversation.action",
    detail: "shortcuts.newPrivateConversation.detail",
  },
  searchConversation: { key: "f", action: "shortcuts.searchConversation.action" },
  searchAll: { key: "f", withShift: true, action: "shortcuts.searchAll.action" },
  settings: { key: ",", action: "shortcuts.settings.action" },
  workspace: {
    key: "o",
    withShift: true,
    action: "shortcuts.workspace.action",
    detail: "shortcuts.workspace.detail",
  },
  moveConversation: { key: "m", withShift: true, action: "shortcuts.moveConversation.action" },
  sidebar: {
    key: "b",
    action: "shortcuts.sidebar.action",
    detail: "shortcuts.sidebar.detail",
  },
  projectPanel: {
    key: "e",
    withShift: true,
    action: "shortcuts.projectPanel.action",
    detail: "shortcuts.projectPanel.detail",
  },
  dictate: {
    key: "d",
    withShift: true,
    action: "shortcuts.dictate.action",
    detail: "shortcuts.dictate.detail",
  },
  applyChange: {
    key: "enter",
    symbol: "↩",
    action: "shortcuts.applyChange.action",
    detail: "shortcuts.applyChange.detail",
  },
} satisfies Record<string, Shortcut>;

export const shortcutLabelOf = (shortcut: Shortcut) =>
  shortcutLabel(shortcut.symbol ?? shortcut.key, shortcut.withShift);

// Keys without ⌘ / Ctrl, which only work where they say; listed so they can be found. Built when shown, since the
// texts (and the name of the Shift key) are in the interface's language.
export function otherKeys(): { keys: string; action: string; detail?: string }[] {
  const t = i18n.t;
  return [
    { keys: "Enter", action: t("shortcuts.other.send.action"), detail: t("shortcuts.other.send.detail") },
    { keys: "/", action: t("shortcuts.other.list.action"), detail: t("shortcuts.other.list.detail") },
    { keys: "↑ ↓", action: t("shortcuts.other.moveList.action"), detail: t("shortcuts.other.moveList.detail") },
    {
      keys: `${altLabel}↑ ${altLabel}↓`,
      action: t("shortcuts.other.jumpChanges.action"),
      detail: t("shortcuts.other.jumpChanges.detail"),
    },
    {
      keys: "↑ ↓ ← →",
      action: t("shortcuts.other.moveProjects.action"),
      detail: t("shortcuts.other.moveProjects.detail"),
    },
    { keys: "F2", action: t("shortcuts.other.rename.action"), detail: t("shortcuts.other.rename.detail") },
    {
      keys: t("shortcuts.other.rowMenu.keys"),
      action: t("shortcuts.other.rowMenu.action"),
      detail: t("shortcuts.other.rowMenu.detail"),
    },
    { keys: "Esc", action: t("shortcuts.other.close.action") },
  ];
}
