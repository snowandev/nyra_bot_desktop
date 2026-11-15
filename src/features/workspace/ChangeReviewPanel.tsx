import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Columns2,
  FolderOpen,
  RefreshCw,
  Rows3,
  Table2,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import type { ChangeAction, TextReview } from "./useWorkspaceChanges";
import { blockRows, changeStats, createdRows, diffRows } from "./fileChanges";
import { isShortcut } from "@/shared/lib/platform";
import { SHORTCUTS, shortcutLabelOf } from "@/shared/lib/shortcuts";
import type { ProposedChange } from "@/shared/types";
import { ChangeReviewTabs } from "./ChangeReviewTabs";
import { csvDiffRows, isCsvPath, looksLikeHeader, separatorLabel, separatorOf } from "./csvDiff";
import { CsvDiffTable } from "./CsvDiffTable";
import { DiffTable } from "./DiffTable";
import { folderPrefix } from "@/shared/lib/paths";
import { PathLabel } from "./PathLabel";
import type { TextEncoding } from "./workspaceStorage";

type Props = {
  // Every change of the reply, as tabs; the one open is change
  changes: ProposedChange[];
  change: ProposedChange;
  // Undefined while the file is read
  review?: TextReview;
  onSelect: (id: string) => void;
  onAction: (action: ChangeAction) => void;
  onClose: () => void;
  isBusy: boolean;
  error?: string;
};

// Narrower than this, the two columns don't fit and the view is a single one
const SPLIT_MIN_WIDTH = 640;

const ENCODING_LABELS: Record<TextEncoding, string> = {
  utf8: "UTF-8",
  windows1252: "Windows-1252",
  utf16Le: "UTF-16 LE",
  utf16Be: "UTF-16 BE",
};


// Next to the chat, so Nyra's explanation stays in view: the original and the changes, file by file, to accept or not
export function ChangeReviewPanel({ changes, change, review, onSelect, onAction, onClose, isBusy, error }: Props) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const [preferSplit, setPreferSplit] = useState(true);
  // A CSV starts as a table; the line views are still there
  const [preferTable, setPreferTable] = useState(true);
  const [isNarrow, setIsNarrow] = useState(false);
  // For a CSV: whether its first row is the header (guessed until the user says), and the rows opened in its folds
  const [csvView, setCsvView] = useState({ id: change.id, header: null as boolean | null, expanded: new Set<number>() });
  const csvState = csvView.id === change.id ? csvView : { id: change.id, header: null, expanded: new Set<number>() };
  // Kept with the file it belongs to: another file starts from its first change, with its folds closed
  const [navigation, setNavigation] = useState({ id: change.id, block: 0, expanded: new Set<string>() });
  const { block: currentBlock, expanded } =
    navigation.id === change.id ? navigation : { block: 0, expanded: new Set<string>() };
  const isNew = change.kind === "create";
  const { added, removed, blocks } = changeStats(change);
  const lineView = !isNew && preferSplit && !isNarrow ? "split" : "unified";
  const canApply = change.status === "pending" || change.status === "undone";
  const fitsFile = change.status === "pending" || change.status === "undone";
  const idPrefix = `review-${change.id}`;

  useEscapeKey(onClose);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const observer = new ResizeObserver(([entry]) => setIsNarrow(entry.contentRect.width < SPLIT_MIN_WIDTH));
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  // A CSV change that fits its file, as a table; null for anything else, or a CSV a table can't show
  const csv = useMemo(() => {
    if (isNew || !review || !fitsFile || review.ranges.length === 0 || !isCsvPath(change.path)) return null;
    const separator = separatorOf(review.original);
    const csvRows = csvDiffRows(review.original, review.ranges, separator);
    return csvRows && { rows: csvRows, separator, guessedHeader: looksLikeHeader(csvRows) };
  }, [isNew, review, fitsFile, change.path]);
  const view = csv && preferTable ? "table" : lineView;
  const hasHeader = csvState.header ?? csv?.guessedHeader ?? false;
  const encodingLabel = ENCODING_LABELS[review?.encoding ?? "utf8"];

  const rows = useMemo(() => {
    if (isNew) return createdRows(change.content ?? "");
    if (!review) return [];
    // A change that still fits shows inside its file; otherwise only what it proposed
    if (fitsFile && review.ranges.length > 0) return diffRows(review.original, review.ranges, expanded);
    return blockRows(change.blocks);
  }, [isNew, change, review, fitsFile, expanded]);

  // The arrows bring the change's header into view, inside the diff only
  useEffect(() => {
    const zone = zoneRef.current;
    const header = document.getElementById(`${idPrefix}-block-${currentBlock}`);
    if (zone && header) zone.scrollTop = Math.max(0, header.offsetTop - 8);
  }, [currentBlock, idPrefix]);

  function move(step: 1 | -1) {
    const block = Math.min(Math.max(currentBlock + step, 0), blocks - 1);
    setNavigation({ id: change.id, block, expanded });
  }

  // The button and the shortcut alike: only once the user can see what changes
  const isReadyToApply = canApply && !isBusy && (!!review || isNew);

  function handleKey(e: KeyboardEvent) {
    if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      move(e.key === "ArrowDown" ? 1 : -1);
    } else if (isShortcut(e.nativeEvent, SHORTCUTS.applyChange.key) && isReadyToApply) {
      e.preventDefault();
      onAction("apply");
    }
  }

  const totalLines = review ? review.original.split("\n").length : undefined;

  return (
    <aside ref={panelRef} className="change-review" aria-label={t("changes.review.label")} onKeyDown={handleKey}>
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
            <span className={`change-tag ${isNew ? "new" : ""}`}>
              {isNew ? t("changes.tag.newFile") : t("changes.tag.edit")}
            </span>
            {isNew && (
              <span>
                {t("changes.review.willCreateIn")}{" "}
                <FolderOpen size={12} strokeWidth={2} className="change-review-folder" />{" "}
                <span className="mono">{folderPrefix(change.path) || t("changes.review.theFolder")}</span>
              </span>
            )}
            <span>
              <span className="diff-added-count">+{added}</span> <span className="diff-removed-count">−{removed}</span>
              {!isNew && ` · ${t("changes.blocks", { count: blocks })}`}
            </span>
            {!isNew && totalLines !== undefined && (
              <span>
                {t("changes.totalLines", { count: totalLines })} · {encodingLabel} · {review?.crlf ? "CRLF" : "LF"}
              </span>
            )}
          </span>
        </span>
        <button type="button" className="icon-button small" aria-label={t("changes.review.close")} onClick={onClose}>
          <X size={16} strokeWidth={2} />
        </button>
      </div>

      <ChangeReviewTabs changes={changes} openId={change.id} onSelect={onSelect} />

      <div className="change-review-tools">
        {isNew ? (
          <span className="change-review-legend">{t("changes.review.newFileLegend")}</span>
        ) : (
          <>
            <span className="segmented" role="group" aria-label={t("changes.review.view")}>
              {csv && (
                <button type="button" aria-pressed={view === "table"} onClick={() => setPreferTable(true)}>
                  <Table2 size={13} strokeWidth={2} />
                  {t("changes.review.table")}
                </button>
              )}
              <button
                type="button"
                aria-pressed={view === "split"}
                disabled={isNarrow}
                title={isNarrow ? t("changes.review.needsWider") : undefined}
                onClick={() => {
                  setPreferTable(false);
                  setPreferSplit(true);
                }}
              >
                <Columns2 size={13} strokeWidth={2} />
                {t("changes.review.sideBySide")}
              </button>
              <button
                type="button"
                aria-pressed={view === "unified"}
                onClick={() => {
                  setPreferTable(false);
                  setPreferSplit(false);
                }}
              >
                <Rows3 size={13} strokeWidth={2} />
                {t("changes.review.unified")}
              </button>
            </span>
            {view === "table" ? (
              <label className="change-review-check">
                <input
                  type="checkbox"
                  checked={hasHeader}
                  onChange={(e) => setCsvView({ ...csvState, header: e.target.checked })}
                />
                {t("changes.review.firstRowHeader")}
              </label>
            ) : (
              <span className="change-review-legend" aria-hidden="true">
                <span>
                  <span className="diff-removed-count">−</span> {t("changes.review.removed")}
                </span>
                <span>
                  <span className="diff-added-count">+</span> {t("changes.review.added")}
                </span>
              </span>
            )}
          </>
        )}
        {blocks > 1 && (
          <span className="change-review-nav">
            <button
              type="button"
              className="icon-button small"
              aria-label={t("changes.review.previous", { keys: "Alt+↑" })}
              disabled={currentBlock === 0}
              onClick={() => move(-1)}
            >
              <ChevronUp size={16} strokeWidth={2} />
            </button>
            <span aria-live="polite">
              {t("changes.review.position", { current: currentBlock + 1, total: blocks })}
            </span>
            <button
              type="button"
              className="icon-button small"
              aria-label={t("changes.review.next", { keys: "Alt+↓" })}
              disabled={currentBlock >= blocks - 1}
              onClick={() => move(1)}
            >
              <ChevronDown size={16} strokeWidth={2} />
            </button>
          </span>
        )}
      </div>

      {change.status === "conflict" && (
        <div className="change-review-notice" role="alert">
          <RefreshCw size={16} strokeWidth={2} />
          <p>
            <strong>
              {t(isNew ? "changes.review.conflictExists" : "changes.review.conflictChanged", { path: change.path })}
            </strong>{" "}
            {t("changes.review.conflictNote")}
          </p>
        </div>
      )}
      {change.status === "noMatch" && change.failedBlock !== undefined && (
        <div className="change-review-notice" role="alert">
          <TriangleAlert size={16} strokeWidth={2} />
          <div>
            <p>
              <strong>{t("changes.review.noMatchBlock", { block: change.failedBlock + 1 })}</strong>{" "}
              {t("changes.review.noMatchExplain")}
            </p>
            <small>{t("changes.review.expected")}</small>
            <pre>{change.blocks[change.failedBlock]?.search}</pre>
          </div>
        </div>
      )}
      {error && (
        <p className="change-review-error" role="alert">
          {error}
        </p>
      )}

      <div ref={zoneRef} className="change-review-diff" tabIndex={0} aria-label={t("changes.review.diffOf", { path: change.path })}>
        {!review && !isNew ? (
          <p className="change-review-loading">
            <span className="workspace-spinner" aria-hidden="true" />
            {t("changes.review.reading")}
          </p>
        ) : csv && view === "table" ? (
          <CsvDiffTable
            rows={csv.rows}
            hasHeader={hasHeader}
            currentBlock={currentBlock}
            expanded={csvState.expanded}
            onExpand={(from, to) => {
              const expanded = new Set(csvState.expanded);
              for (let i = from; i <= to; i++) expanded.add(i);
              setCsvView({ ...csvState, expanded });
            }}
            idPrefix={idPrefix}
            label={t("changes.review.tableOf", { path: change.path })}
          />
        ) : (
          <DiffTable
            rows={rows}
            view={lineView}
            currentBlock={currentBlock}
            onExpand={(key) => setNavigation({ id: change.id, block: currentBlock, expanded: new Set(expanded).add(key) })}
            idPrefix={idPrefix}
            isNewFile={isNew}
          />
        )}
      </div>

      <div className="change-review-footer">
        {change.status === "applied" && !change.applied ? (
          <span>
            <Check size={14} strokeWidth={2.6} className="change-review-ok" /> {t("changes.review.appliedByClaudeCode")}
          </span>
        ) : change.status === "applied" ? (
          <>
            <span>
              <Check size={14} strokeWidth={2.6} className="change-review-ok" /> {t("changes.review.appliedBackup")}
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
              {t("changes.action.askNyraFix")}
            </button>
          </>
        ) : change.status === "protected" || change.status === "discarded" ? (
          <span>{change.status === "protected" ? t("changes.review.noWrite") : t("changes.review.discarded")}</span>
        ) : (
          <>
            <span>
              {isNew ? `${t("changes.review.willCreate")} ` : `${t("changes.review.backupFirst")} `}
              {!isNew &&
                (csv
                  ? t("changes.review.keepsCsv", {
                      separator: separatorLabel(csv.separator),
                      encoding: encodingLabel,
                      eol: review?.crlf ? "CRLF" : "LF",
                    })
                  : t("changes.review.keepsText", { encoding: encodingLabel, eol: review?.crlf ? "CRLF" : "LF" }))}
            </span>
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
              {isNew
                ? t("changes.action.createFile")
                : change.status === "undone"
                  ? t("changes.action.reapply")
                  : t("changes.action.apply")}
              <kbd>{shortcutLabelOf(SHORTCUTS.applyChange)}</kbd>
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
