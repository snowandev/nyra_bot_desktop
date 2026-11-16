import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SHORTCUTS, shortcutLabelOf } from "@/shared/lib/shortcuts";
import { RailFoot } from "./RailFoot";

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
      <RailFoot onOpenSettings={onOpenSettings} onUnfold={onUnfold} />
    </nav>
  );
}
