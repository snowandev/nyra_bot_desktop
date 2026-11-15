import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useStableCallback } from "@/shared/hooks/useStableCallback";

type Props = {
  onUndo: () => void;
  // Time is up: the deletion stays
  onExpire: () => void;
};

const UNDO_MS = 8000;

// Above the composer after deleting a message; the keyboard lands on "Deshacer"
export function MessageUndoNotice({ onUndo, onExpire }: Props) {
  const { t } = useTranslation();
  const undoRef = useRef<HTMLButtonElement>(null);
  const expire = useStableCallback(onExpire);

  useEffect(() => {
    undoRef.current?.focus({ preventScroll: true });
    const timer = window.setTimeout(expire, UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [expire]);

  return (
    <div className="message-undo" role="status">
      <span>{t("chat.undo.deleted")}</span>
      <button ref={undoRef} type="button" className="ghost-button" onClick={onUndo}>
        {t("chat.undo.action")}
      </button>
    </div>
  );
}
