import { Check, ChevronLeft, Layers, Lock, RefreshCw, TriangleAlert, Undo2, X } from "lucide-react";
import { type KeyboardEvent, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { isShortcut } from "@/shared/lib/platform";
import { SHORTCUTS, shortcutLabelOf } from "@/shared/lib/shortcuts";
import type { ProposedChange } from "@/shared/types";
import { cellChanges, fileExtension, orderedBySheet } from "./cellGrid";
import { CellsReview } from "./CellsReview";
import { ChangeReviewTabs } from "./ChangeReviewTabs";
import type { ChangeAction, SheetReview } from "./useWorkspaceChanges";
import { cellKey } from "./workspaceChanges";
import { SKIP_REASON_LABEL } from "./workspace";
import { fileName } from "@/shared/lib/paths";
import { PathLabel } from "./PathLabel";

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
      <div className="change-review-header">
        <button type="button" className="ghost-button change-review-back" onClick={onClose}>
          <ChevronLeft size={15} strokeWidth={2} />
          {t("changes.review.back")}
        </button>
        <span className="change-review-title">
          <span className="change-review-path" title={`${change.root}/${change.path}`}>
            <PathLabel path={change.path} dirClassName="change-card-dir" />
          </span>
          <span className="change-review-meta">
            <span className="change-tag">{t("cells.panel.tag", { extension: fileExtension(change.path) })}</span>
            <span>
              {t("cells.panel.cellsInSheets", {
                cells: t("cells.count", { count: all.length }),
                sheets: t("cells.sheetCount", { count: sheetCount }),
              })}
            </span>
          </span>
        </span>
        <button type="button" className="icon-button small" aria-label={t("changes.review.close")} onClick={onClose}>
          <X size={16} strokeWidth={2} />
        </button>
      </div>

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

      <div className="change-review-footer">
        {change.status === "applied" ? (
          <>
            <span>
              <Check size={14} strokeWidth={2.6} className="change-review-ok" />{" "}
              {change.copiedTo
                ? t("cells.panel.savedIn", { path: change.copiedTo })
                : t("cells.panel.appliedBackup")}
            </span>
            <button type="button" className="outline-button small" disabled={isBusy} onClick={() => onAction("undo")}>
              <Undo2 size={14} strokeWidth={2} />
              {t("changes.action.undo")}
            </button>
          </>
        ) : change.status === "noMatch" || change.status === "conflict" ? (
          <>
            <span>{t("changes.review.cantApply")}</span>
            <button type="button" className="ghost-button" onClick={() => onAction("discard")}>
              {t("changes.action.discard")}
            </button>
            <button type="button" className="primary-button small" onClick={() => onAction("retry")}>
              <RefreshCw size={14} strokeWidth={2} />
              {t("changes.action.askNyraRedo")}
            </button>
          </>
        ) : change.status === "protected" && change.reason === "readOnly" ? (
          <>
            <span>{t("cells.panel.copyNote")}</span>
            <button type="button" className="ghost-button" onClick={() => onAction("discard")}>
              {t("changes.action.discard")}
            </button>
            <button type="button" className="primary-button small" disabled={isBusy} onClick={() => onAction("convert")}>
              <Layers size={14} strokeWidth={2} />
              {t("changes.action.convert")}
            </button>
          </>
        ) : change.status === "protected" || change.status === "discarded" ? (
          <span>{change.status === "protected" ? t("changes.review.noWrite") : t("changes.review.discarded")}</span>
        ) : (
          <>
            <span>{t("cells.panel.backupNote")}</span>
            <button type="button" className="ghost-button" onClick={() => onAction("discard")}>
              {t("changes.action.discard")}
            </button>
            <button
              type="button"
              className="primary-button small"
              disabled={!isReadyToApply}
              onClick={() => onAction("apply")}
            >
              <Check size={14} strokeWidth={2.4} />
              {change.status === "undone" ? t("changes.action.reapply") : t("changes.action.apply")}
              <kbd>{shortcutLabelOf(SHORTCUTS.applyChange)}</kbd>
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
