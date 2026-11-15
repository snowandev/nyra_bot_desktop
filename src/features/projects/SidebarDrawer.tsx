import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  onClose: () => void;
  children: ReactNode;
};

// The whole sidebar over the chat, in a narrow window. Escape closes it unless a menu inside is open (the menu
// closes first), and so does a click outside it.
export function SidebarDrawer({ onClose, children }: Props) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("button, input")?.focus();
  }, []);

  return (
    <div className="sidebar-drawer">
      <div className="sidebar-drawer-backdrop" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        className="sidebar-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("projects.drawer")}
        onKeyDown={(e) => {
          if (e.key !== "Escape" || panelRef.current?.querySelector("[aria-haspopup][aria-expanded='true']")) return;
          e.stopPropagation();
          onClose();
        }}
      >
        {children}
      </div>
    </div>
  );
}
