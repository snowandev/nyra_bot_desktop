import { Check, Layers, RefreshCw, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SHORTCUTS, shortcutLabelOf } from "@/shared/lib/shortcuts";
import type { ProposedChange } from "@/shared/types";
import type { ChangeAction } from "./useWorkspaceChanges";

type Props = {
  change: ProposedChange;
  isBusy: boolean;
  isReadyToApply: boolean;
  onAction: (action: ChangeAction) => void;
  // What each review says in its own words: once applied, before applying, and its buttons
  appliedNote: string;
  pendingNote: ReactNode;
  applyLabel: string;
  retryLabel: string;
  // A file Nyra may not write (read-only) that the review can still change as a copy (cells)
  copyNote?: string;
};

// The foot of a change's review, the same for text and for cells: what happened to it and what can be done now. A
// change Claude Code made has no copy of before in Nyra, so it can't be undone from here.
export function ChangeReviewFooter(props: Props) {
  const { change, isBusy, isReadyToApply, onAction } = props;
  const { appliedNote, pendingNote, applyLabel, retryLabel, copyNote } = props;
  const { t } = useTranslation();
  const discard = (
    <button type="button" className="ghost-button" onClick={() => onAction("discard")}>
      {t("changes.action.discard")}
    </button>
  );

  let content: ReactNode;
  if (change.status === "applied" && !change.applied) {
    content = (
      <span>
        <Check size={14} strokeWidth={2.6} className="change-review-ok" /> {t("changes.review.appliedByClaudeCode")}
      </span>
    );
  } else if (change.status === "applied") {
    content = (
      <>
        <span>
          <Check size={14} strokeWidth={2.6} className="change-review-ok" /> {appliedNote}
        </span>
        <button type="button" className="outline-button small" disabled={isBusy} onClick={() => onAction("undo")}>
          <Undo2 size={14} strokeWidth={2} />
          {t("changes.action.undo")}
        </button>
      </>
    );
  } else if (change.status === "noMatch" || change.status === "conflict") {
    content = (
      <>
        <span>{t("changes.review.cantApply")}</span>
        {discard}
        <button type="button" className="primary-button small" onClick={() => onAction("retry")}>
          <RefreshCw size={14} strokeWidth={2} />
          {retryLabel}
        </button>
      </>
    );
  } else if (change.status === "protected" && change.reason === "readOnly" && copyNote) {
    content = (
      <>
        <span>{copyNote}</span>
        {discard}
        <button type="button" className="primary-button small" disabled={isBusy} onClick={() => onAction("convert")}>
          <Layers size={14} strokeWidth={2} />
          {t("changes.action.convert")}
        </button>
      </>
    );
  } else if (change.status === "protected" || change.status === "discarded") {
    content = (
      <span>{change.status === "protected" ? t("changes.review.noWrite") : t("changes.review.discarded")}</span>
    );
  } else {
    content = (
      <>
        <span>{pendingNote}</span>
        {discard}
        <button
          type="button"
          className="primary-button small"
          disabled={!isReadyToApply}
          onClick={() => onAction("apply")}
        >
          <Check size={14} strokeWidth={2.4} />
          {applyLabel}
          <kbd>{shortcutLabelOf(SHORTCUTS.applyChange)}</kbd>
        </button>
      </>
    );
  }
  return <div className="change-review-footer">{content}</div>;
}
