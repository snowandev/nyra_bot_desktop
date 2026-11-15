import { Check, List } from "lucide-react";
import type { ChangeAction } from "./useWorkspaceChanges";
import { changeStats } from "./fileChanges";
import { useTranslation } from "react-i18next";
import type { ProposedChange } from "@/shared/types";
import { ChangeCard } from "./ChangeCard";

type Props = {
  changes: ProposedChange[];
  onAction: (id: string, action: ChangeAction) => void;
  onApplyAll: () => void;
  onDiscardAll: () => void;
  busy: ReadonlySet<string>;
  // Being redone by Nyra ("Corrigiendo…")
  fixing: ReadonlySet<string>;
  errors: ReadonlyMap<string, string>;
  // The change open in the review panel
  openId?: string;
};

// The changes a reply proposed, one card per file; with several, a header and "Aplicar los N" once all are reviewed
export function ChangeProposals(props: Props) {
  const { changes, onAction, onApplyAll, onDiscardAll, busy, fixing, errors, openId } = props;
  const { t } = useTranslation();
  // Lines of the text files and cells of the spreadsheets, each counted as what it is
  const totals = changes.reduce(
    (sum, c) => {
      const s = changeStats(c);
      if (c.kind === "cells") return { ...sum, cells: sum.cells + s.added };
      return { ...sum, added: sum.added + s.added, removed: sum.removed + s.removed, hasText: true };
    },
    { added: 0, removed: 0, cells: 0, hasText: false },
  );
  const pending = changes.filter((c) => c.status === "pending");
  const reviewed = pending.filter((c) => c.reviewed).length;
  const decided = changes.filter((c) => c.status === "applied" || c.status === "discarded").length;
  const allReviewed = pending.length > 0 && reviewed === pending.length;

  return (
    <section className="change-proposals" aria-label={t("changes.proposals.label")}>
      {changes.length > 1 && (
        <div className="change-proposals-header">
          <List size={16} strokeWidth={2} aria-hidden="true" />
          <strong>{t("changes.proposals.label")}</strong>
          <span>
            {t("changes.files", { count: changes.length })}
            {totals.hasText && (
              <>
                {" "}
                · <span className="diff-added-count">+{totals.added}</span>{" "}
                <span className="diff-removed-count">−{totals.removed}</span>
              </>
            )}
            {totals.cells > 0 && ` · ${t("cells.count", { count: totals.cells })}`}
          </span>
          <span className="change-proposals-progress">
            {t("changes.proposals.decided", { decided, total: changes.length })}
          </span>
        </div>
      )}
      <ul className="change-proposals-list">
        {changes.map((change) => (
          <ChangeCard
            key={change.id}
            change={change}
            onAction={(action) => onAction(change.id, action)}
            isBusy={busy.has(change.id) || fixing.has(change.id)}
            isFixing={fixing.has(change.id)}
            error={errors.get(change.id)}
            isOpen={openId === change.id}
          />
        ))}
      </ul>
      {pending.length > 1 && (
        <div className="change-proposals-footer">
          <span>
            {allReviewed
              ? t("changes.proposals.allReviewed", { total: pending.length })
              : t("changes.proposals.reviewEach", { reviewed, total: pending.length })}
          </span>
          <button type="button" className="ghost-button" onClick={onDiscardAll}>
            {t("changes.action.discardAll")}
          </button>
          <button
            type="button"
            className={allReviewed ? "primary-button small" : "outline-button small"}
            disabled={!allReviewed || busy.size > 0}
            onClick={onApplyAll}
          >
            <Check size={14} strokeWidth={2.4} />
            {t("changes.action.applyAll", { total: pending.length })}
          </button>
        </div>
      )}
    </section>
  );
}
