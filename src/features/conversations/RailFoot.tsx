import { PanelLeftOpen, Settings } from "lucide-react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { SHORTCUTS, shortcutLabelOf } from "@/shared/lib/shortcuts";

type Props = {
  onOpenSettings: () => void;
  // The folded sidebar comes back from the bottom corner, where the open one folds it. Null in a narrow window
  // (Código): the same button opens it over the chat as a drawer instead.
  onUnfold: (() => void) | null;
  drawer?: { isOpen: boolean; onOpen: () => void };
  // Focus goes back to it when the drawer closes
  drawerButtonRef?: RefObject<HTMLButtonElement | null>;
};

// The foot of a sidebar folded into icons, the same in Chat and Código: Settings, and the button that brings it back
export function RailFoot({ onOpenSettings, onUnfold, drawer, drawerButtonRef }: Props) {
  const { t } = useTranslation();
  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label={t("settings.title")}
        title={t("conversations.settingsWithShortcut", { shortcut: shortcutLabelOf(SHORTCUTS.settings) })}
        onClick={onOpenSettings}
      >
        <Settings size={18} strokeWidth={1.8} />
      </button>
      {onUnfold || !drawer ? (
        <button
          type="button"
          className="icon-button sidebar-unfold"
          aria-label={t("conversations.sidebar.unfold")}
          title={t("conversations.sidebar.unfoldWithShortcut", { shortcut: shortcutLabelOf(SHORTCUTS.sidebar) })}
          onClick={onUnfold ?? undefined}
        >
          <PanelLeftOpen size={18} strokeWidth={2} />
        </button>
      ) : (
        <button
          ref={drawerButtonRef}
          type="button"
          className="icon-button sidebar-unfold"
          aria-label={t("projects.rail.showSidebar")}
          aria-expanded={drawer.isOpen}
          title={t("projects.rail.showSidebar")}
          onClick={drawer.onOpen}
        >
          <PanelLeftOpen size={18} strokeWidth={2} />
        </button>
      )}
    </>
  );
}
