import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";

type Props = {
  onClose: () => void;
  // Its name for screen readers: the id of its title, or a label when it has none to show
  labelledBy?: string;
  label?: string;
  // The window's own look: its size and layout
  className: string;
  // The backdrop, when it isn't the shared one (the file viewer has its own spacing)
  backdropClassName?: string;
  children: ReactNode;
};

// A window over the app: Escape or a click outside closes it, focus starts inside (on what asks for it with
// data-autofocus, or its first control) and goes back to where it was when it closes
export function Dialog({ onClose, labelledBy, label, className, backdropClassName = "dialog-backdrop", children }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  useEscapeKey(onClose);

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first =
      panel.current?.querySelector<HTMLElement>("[data-autofocus]") ??
      panel.current?.querySelector<HTMLElement>("button, input, textarea, [tabindex='0']");
    first?.focus();
    return () => before?.focus();
  }, []);

  return createPortal(
    <div className={backdropClassName} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={label}
        className={className}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
