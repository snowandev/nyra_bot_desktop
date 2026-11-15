import { PanelLeftClose, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SHORTCUTS, shortcutLabelOf } from "@/shared/lib/shortcuts";
import { DownloadsIndicator } from "@/features/models/DownloadsIndicator";
import { UpdateNotice } from "@/features/updates/UpdateNotice";
import { useUpdatesContext } from "@/features/updates/updatesContext";

type Props = {
  onOpenSettings: () => void;
  // Settings → Proveedores, from the downloads indicator
  onOpenModels: () => void;
  // Folds it into icons, or closes it where it is shown as a drawer
  onFold?: () => void;
  children: ReactNode;
};

// What the sidebar of both spaces shares: the settings at the bottom
export function SidebarShell({ onOpenSettings, onOpenModels, onFold, children }: Props) {
  const { t } = useTranslation();
  const updates = useUpdatesContext();
  // "Más tarde" hid the notice: a dot on Settings keeps the new version in sight until Nyra opens again
  const updateWaits = updates.isHidden && updates.step.kind === "available";
  return (
    <aside className="sidebar">
      {children}

      <div className="sidebar-footer">
        <UpdateNotice />
        <DownloadsIndicator onOpen={onOpenModels} />
        <div className="sidebar-footer-row">
          <button
            type="button"
            className="ghost-button"
            title={t("conversations.settingsWithShortcut", { shortcut: shortcutLabelOf(SHORTCUTS.settings) })}
            onClick={onOpenSettings}
          >
            <span className={updateWaits ? "update-dot" : undefined}>
              <Settings size={18} strokeWidth={1.8} />
            </span>
            {t("settings.title")}
            {updateWaits && <span className="visually-hidden">, {t("updates.settings.dot")}</span>}
          </button>
          {onFold && (
            <button
              type="button"
              className="icon-button sidebar-fold"
              aria-label={t("conversations.sidebar.fold")}
              title={t("conversations.sidebar.foldWithShortcut", { shortcut: shortcutLabelOf(SHORTCUTS.sidebar) })}
              onClick={onFold}
            >
              <PanelLeftClose size={18} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
