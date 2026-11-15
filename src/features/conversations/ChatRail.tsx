import { PanelLeftOpen, Plus, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SHORTCUTS, shortcutLabelOf } from "@/shared/lib/shortcuts";

type Props = {
  onUnfold: () => void;
  onNew: () => void;
  onOpenSettings: () => void;
  // The Chat / Código switch, upright
  spaceSwitch: ReactNode;
};

// The Chat sidebar folded into icons, so the conversation has more room; the list comes back from the bottom corner,
// where the open sidebar folds it
export function ChatRail({ onUnfold, onNew, onOpenSettings, spaceSwitch }: Props) {
  const { t } = useTranslation();
  return (
    <nav className="sidebar-rail" aria-label={t("conversations.rail.label")}>
      {spaceSwitch}
      <span className="sidebar-rail-separator" aria-hidden="true" />
      <button
        type="button"
        className="icon-button"
        aria-label={t("conversations.new")}
        title={t("conversations.newWithShortcut", { shortcut: shortcutLabelOf(SHORTCUTS.newConversation) })}
        onClick={onNew}
      >
        <Plus size={18} strokeWidth={2} />
      </button>
      <span className="sidebar-rail-spacer" />
      <button
        type="button"
        className="icon-button"
        aria-label={t("settings.title")}
        title={t("conversations.settingsWithShortcut", { shortcut: shortcutLabelOf(SHORTCUTS.settings) })}
        onClick={onOpenSettings}
      >
        <Settings size={18} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        className="icon-button sidebar-unfold"
        aria-label={t("conversations.sidebar.unfold")}
        title={t("conversations.sidebar.unfoldWithShortcut", { shortcut: shortcutLabelOf(SHORTCUTS.sidebar) })}
        onClick={onUnfold}
      >
        <PanelLeftOpen size={18} strokeWidth={2} />
      </button>
    </nav>
  );
}
