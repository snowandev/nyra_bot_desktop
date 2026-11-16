import { Lock, RefreshCw, TriangleAlert } from "lucide-react";
import { type KeyboardEvent, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { isShortcut } from "@/shared/lib/platform";
import { SHORTCUTS } from "@/shared/lib/shortcuts";
import type { ProposedChange } from "@/shared/types";
import { cellChanges, fileExtension, orderedBySheet } from "./cellGrid";
import { CellsReview } from "./CellsReview";
import { ChangeReviewFooter } from "./ChangeReviewFooter";
import { ChangeReviewHeader } from "./ChangeReviewHeader";
import { ChangeReviewTabs } from "./ChangeReviewTabs";
import type { ChangeAction, SheetReview } from "./useWorkspaceChanges";
import { cellKey } from "./workspaceChanges";
import { SKIP_REASON_LABEL } from "./workspace";
import { fileName } from "@/shared/lib/paths";

type Props = {
  changes: ProposedChange[];
  change: ProposedChange;
  // Undefined while the workbook is read
  review?: SheetReview;
  onSelect: (id: string) => void;
  onAction: (action: ChangeAction) => void;
  onClose: () => void;
  isBusy: boolean;
  error?: string;
};


// The review of a workbook of the folder: what applying would write, cell by cell
export function CellsReviewPanel({ changes, change, review, onSelect, onAction, onClose, isBusy, error }: Props) {
  const { t } = useTranslation();
  const [readError, setReadError] = useState<string | null>(null);
  const settled = change.status === "applied" || change.status === "undone";
  const canApply = change.status === "pending" || change.status === "undone";

  useEscapeKey(onClose);

  const all = useMemo(() => {
    // Once applied, the file has the new values: what each cell held was kept with the change
    const stored = new Map((change.cellsBefore ?? []).map((c) => [cellKey(c.sheet, c.cell), c]));
    const before = (sheet: string, cell: string) =>
      settled && change.cellsBefore ? stored.get(cellKey(sheet, cell)) : review?.before.get(cellKey(sheet, cell));
    return orderedBySheet(cellChanges(change.cells ?? [], before));
  }, [change, review, settled]);
  const sheetCount = new Set(all.map((c) => c.sheet)).size;

  // The button and the shortcut alike: only once the user can see the cells it changes
  const isReadyToApply = canApply && !isBusy && !!review;

  function handleKey(e: KeyboardEvent) {
    if (isShortcut(e.nativeEvent, SHORTCUTS.applyChange.key) && isReadyToApply) {
      e.preventDefault();
      onAction("apply");
    }
  }

  return (
    <aside
      className="change-review cells-review"
      aria-label={t("cells.panel.label", { path: change.path })}
      onKeyDown={handleKey}
    >
      <ChangeReviewHeader
        change={change}
        onClose={onClose}
        meta={
          <>
            <span className="change-tag">{t("cells.panel.tag", { extension: fileExtension(change.path) })}</span>
            <span>
              {t("cells.panel.cellsInSheets", {
                cells: t("cells.count", { count: all.length }),
                sheets: t("cells.sheetCount", { count: sheetCount }),
              })}
            </span>
          </>
        }
      />

      <ChangeReviewTabs changes={changes} openId={change.id} onSelect={onSelect} />

      {change.status === "conflict" && (
        <div className="change-review-notice" role="alert">
          <RefreshCw size={16} strokeWidth={2} />
          <p>
            <Trans
              i18nKey="cells.panel.conflict"
              values={{ name: fileName(change.path) }}
              components={{ strong: <strong /> }}
            />
          </p>
        </div>
      )}
      {change.status === "noMatch" && (
        <div className="change-review-notice" role="alert">
          <TriangleAlert size={16} strokeWidth={2} />
          <p>
            <Trans i18nKey="cells.panel.noMatch" components={{ strong: <strong /> }} />
          </p>
        </div>
      )}
      {change.status === "protected" && change.reason && (
        <div className="change-review-notice" role="status">
          <Lock size={16} strokeWidth={2} />
          <p>{SKIP_REASON_LABEL[change.reason]}</p>
        </div>
      )}
      {(error || readError) && (
        <p className="change-review-error" role="alert">
          {error ?? readError}
        </p>
      )}

      {!review && !settled ? (
        <p className="change-review-loading">
          <span className="workspace-spinner" aria-hidden="true" />
          {t("cells.panel.reading")}
        </p>
      ) : (
        <CellsReview
          key={change.id}
          changes={all}
          sheets={review?.sheets}
          source={{ kind: "folder", root: change.root, path: change.copiedTo ?? change.path }}
          label={change.path}
          onError={setReadError}
        />
      )}

      <ChangeReviewFooter
        change={change}
        isBusy={isBusy}
        isReadyToApply={isReadyToApply}
        onAction={onAction}
        appliedNote={
          change.copiedTo ? t("cells.panel.savedIn", { path: change.copiedTo }) : t("cells.panel.appliedBackup")
        }
        pendingNote={t("cells.panel.backupNote")}
        applyLabel={change.status === "undone" ? t("changes.action.reapply") : t("changes.action.apply")}
        retryLabel={t("changes.action.askNyraRedo")}
        copyNote={t("cells.panel.copyNote")}
      />
    </aside>
  );
}
