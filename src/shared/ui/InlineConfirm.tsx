import { type ReactNode, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  title: ReactNode;
  // What happens if confirmed, and what doesn't
  children: ReactNode;
  confirmLabel: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  // The look of the place it replaces (a folder's header, a model's row)
  className: string;
  actionsClassName: string;
  // In a list, it takes a row's place
  as?: "div" | "li";
  // Both buttons wait while the action runs
  isBusy?: boolean;
  small?: boolean;
};

// A question in place of what it is about, before something that can't be undone (or only from there): focus starts
// on Cancel, the safe choice, and Escape cancels
export function InlineConfirm(props: Props) {
  const { title, children, confirmLabel, onCancel, onConfirm, className, actionsClassName } = props;
  const { as: Element = "div", isBusy = false, small = false } = props;
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const textId = useId();

  useEffect(() => cancelRef.current?.focus(), []);

  return (
    <Element
      className={className}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={textId}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        // Escape here is this question's, not the panel or drawer around it
        e.stopPropagation();
        onCancel();
      }}
    >
      <strong id={titleId}>{title}</strong>
      <div id={textId} className="inline-confirm-text">
        {children}
      </div>
      <div className={actionsClassName}>
        <button
          ref={cancelRef}
          type="button"
          className={`outline-button ${small ? "small" : ""}`}
          disabled={isBusy}
          onClick={onCancel}
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className={`primary-button danger ${small ? "small" : ""}`}
          disabled={isBusy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Element>
  );
}
