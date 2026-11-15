import {
  Check,
  CircleCheck,
  Copy,
  Eye,
  FilePen,
  FilePlus,
  FileSpreadsheet,
  FolderSearch,
  Layers,
  Lock,
  RefreshCw,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { ChangeAction } from "./useWorkspaceChanges";
import { sheetsSummary } from "./cellGrid";
import { changeStats } from "./fileChanges";
import { revealLabel } from "@/shared/lib/platform";
import { SKIP_REASON_LABEL } from "./workspace";
import type { ProposedChange } from "@/shared/types";
import { PathLabel } from "./PathLabel";

type Props = {
  change: ProposedChange;
  onAction: (action: ChangeAction) => void;
  isBusy: boolean;
  // Being redone by Nyra after it didn't fit the file
  isFixing: boolean;
  error?: string;
  // Open in the review panel right now
  isOpen: boolean;
};

function cellsReason(change: ProposedChange, t: TFunction) {
  switch (change.status) {
    case "applied":
      return change.copiedTo ? t("changes.reason.copied", { path: change.copiedTo }) : null;
    case "noMatch":
      return t("changes.reason.cellsNoMatch");
    case "conflict":
      return t("changes.reason.cellsConflict");
    case "protected":
      return change.reason ? SKIP_REASON_LABEL[change.reason] : null;
    default:
      return null;
  }
}

function reason(change: ProposedChange, t: TFunction) {
  if (change.kind === "cells" && change.status !== "undone") return cellsReason(change, t);
  switch (change.status) {
    case "undone":
      return t("changes.reason.undone");
    case "noMatch":
      return t("changes.reason.noMatch");
    case "conflict":
      return change.kind === "create" ? t("changes.reason.exists") : t("changes.reason.conflict");
    case "protected":
      return `${change.reason ? SKIP_REASON_LABEL[change.reason] : ""} ${t("changes.reason.protectedNote")}`;
    default:
      return null;
  }
}

// One file of a proposal. Dashed while nothing is written, like a draft; solid with a green check once applied.
export function ChangeCard({ change, onAction, isBusy, isFixing, error, isOpen }: Props) {
  const { t } = useTranslation();
  const { added, removed, blocks } = changeStats(change);
  const isNew = change.kind === "create";
  const isSheet = change.kind === "cells";
  const { status } = change;
  const reviewed = status === "pending" && change.reviewed;
  const tone =
    status === "applied"
      ? "applied"
      : status === "discarded"
        ? "discarded"
        : status === "noMatch" || status === "conflict"
          ? "problem"
          : status === "protected"
            ? "protected"
            : "";
  const Icon =
    status === "applied"
      ? CircleCheck
      : status === "protected"
        ? Lock
        : status === "noMatch" || status === "conflict"
          ? TriangleAlert
          : isSheet
            ? FileSpreadsheet
            : isNew
              ? FilePlus
              : FilePen;
  const lines = {
    added: t("changes.linesAdded", { count: added }),
    removed: t("changes.linesRemoved", { count: removed }),
  };
  const size = isSheet
    ? t("changes.sizeSheet", { sheets: sheetsSummary(change.cells ?? []).join(", ") })
    : t(isNew ? "changes.sizeNew" : "changes.sizeEdit", lines);
  const state = isFixing
    ? t("changes.state.fixing")
    : reviewed
      ? t("changes.state.reviewedNotApplied")
      : t(`changes.state.${status}`);
  const label = `${change.path}: ${size}, ${state}`;
  const protectedTag =
    change.reason === "sheetProtected"
      ? t("changes.tag.sheetProtected")
      : change.reason === "readOnly"
        ? t("changes.tag.readOnly")
        : t("changes.tag.protected");
  // While Nyra redoes it, why it didn't fit is no longer the news
  const explanation = isFixing ? null : reason(change, t);
  const button = (action: ChangeAction, text: string, icon: ReactNode, primary = false) => (
    <button
      type="button"
      className={primary ? "primary-button small" : "outline-button small"}
      disabled={isBusy}
      data-review-id={action === "review" ? change.id : undefined}
      onClick={() => onAction(action)}
    >
      {icon}
      {text}
    </button>
  );
  const iconButton = (action: ChangeAction, text: string, icon: ReactNode) => (
    <button
      type="button"
      className="icon-button small"
      aria-label={text}
      title={text}
      disabled={isBusy}
      data-review-id={action === "review" ? change.id : undefined}
      onClick={() => onAction(action)}
    >
      {icon}
    </button>
  );

  return (
    <li>
      <div className={`change-card ${tone} ${isSheet ? "sheet" : ""} ${isOpen ? "open" : ""}`} role="group" aria-label={label}>
        <span className="change-card-icon">
          {isBusy ? <span className="workspace-spinner" aria-hidden="true" /> : <Icon size={17} strokeWidth={2} aria-hidden="true" />}
        </span>
        <span className="change-card-text">
          <span className="change-card-path" title={change.path}>
            <PathLabel path={change.path} dirClassName="change-card-dir" />
          </span>
          <span className="change-card-meta">
            {isSheet ? (
              <>
                <span className="change-tag">{t("changes.tag.spreadsheet")}</span>
                <span className="change-card-sheets">{sheetsSummary(change.cells ?? []).join(", ")}</span>
              </>
            ) : (
              <>
                <span className={`change-tag ${isNew ? "new" : ""}`}>
                  {isNew ? t("changes.tag.newFile") : t("changes.tag.edit")}
                </span>
                <span>
                  <Trans
                    i18nKey="changes.lines"
                    values={{ added, removed }}
                    components={{
                      added: <span className="diff-added-count" />,
                      removed: <span className="diff-removed-count" />,
                    }}
                  />
                  {!isNew && ` · ${t("changes.blocks", { count: blocks })}`}
                </span>
              </>
            )}
            {status === "applied" && (
              <span className="change-tag ok">
                <Check size={11} strokeWidth={2.6} />
                {change.importedFrom ? t("changes.tag.byClaudeCode") : t("changes.tag.applied")}
              </span>
            )}
            {status === "discarded" && <span className="change-tag">{t("changes.tag.discarded")}</span>}
            {status === "undone" && (
              <span className="change-tag">
                <Undo2 size={11} strokeWidth={2.4} />
                {t("changes.tag.undone")}
              </span>
            )}
            {isFixing && (
              <span className="change-tag">
                <span className="workspace-spinner small" aria-hidden="true" />
                {t("changes.tag.fixing")}
              </span>
            )}
            {status === "pending" && change.corrected && <span className="change-tag">{t("changes.tag.corrected")}</span>}
            {status === "noMatch" && !isFixing && (
              <span className="change-tag warning">
                {!isSheet && change.failedBlock !== undefined
                  ? t("changes.tag.failedOf", { block: change.failedBlock + 1, total: blocks })
                  : t("changes.tag.noMatch")}
              </span>
            )}
            {status === "conflict" && !isFixing && (
              <span className="change-tag warning">
                {isNew ? t("changes.tag.exists") : t("changes.tag.changedOnDisk")}
              </span>
            )}
            {status === "protected" && (
              <span className="change-tag">
                <Lock size={10} strokeWidth={2.4} />
                {protectedTag}
              </span>
            )}
            {reviewed && (
              <span className="change-tag seen">
                <Eye size={11} strokeWidth={2.2} />
                {t("changes.tag.reviewed")}
              </span>
            )}
          </span>
        </span>
        <span className="change-card-actions">
          {status === "pending" && (
            <>
              {button("review", t("changes.action.review"), <Eye size={14} strokeWidth={2} />, !reviewed)}
              <span className="change-apply-wrap">
                <button
                  type="button"
                  className={reviewed ? "primary-button small" : "outline-button small"}
                  disabled={!reviewed || isBusy}
                  aria-label={t(reviewed ? "changes.action.applyPath" : "changes.action.applyPathUnreviewed", {
                    path: change.path,
                  })}
                  onClick={() => onAction("apply")}
                >
                  <Check size={14} strokeWidth={2.4} />
                  {isNew ? t("changes.action.create") : t("changes.action.apply")}
                </button>
                {!reviewed && (
                  <span className="change-apply-tip" aria-hidden="true">
                    {t("changes.action.reviewFirst")}
                  </span>
                )}
              </span>
              {iconButton("discard", t("changes.action.discardPath", { path: change.path }), <X size={15} strokeWidth={2} />)}
            </>
          )}
          {status === "applied" && (
            <>
              {change.applied && button("undo", t("changes.action.undo"), <Undo2 size={14} strokeWidth={2} />)}
              {iconButton("reveal", `${revealLabel()}: ${change.path}`, <FolderSearch size={15} strokeWidth={1.8} />)}
              {iconButton("review", t("changes.action.viewApplied"), <Eye size={15} strokeWidth={1.8} />)}
            </>
          )}
          {status === "discarded" && (
            <button type="button" className="ghost-button" onClick={() => onAction("restore")}>
              {t("changes.action.restore")}
            </button>
          )}
          {status === "undone" && (
            <>
              {button("review", t("changes.action.view"), <Eye size={14} strokeWidth={2} />)}
              {button("apply", t("changes.action.reapply"), <Check size={14} strokeWidth={2.4} />)}
            </>
          )}
          {(status === "noMatch" || status === "conflict") && (
            <>
              {button("review", t("changes.action.view"), <Eye size={14} strokeWidth={2} />)}
              {button(
                "retry",
                status === "conflict" || isSheet ? t("changes.action.askAgain") : t("changes.action.askFix"),
                <RefreshCw size={14} strokeWidth={2} />,
                true,
              )}
            </>
          )}
          {status === "protected" && (
            <>
              {isSheet && button("review", t("changes.action.view"), <Eye size={14} strokeWidth={2} />)}
              {isSheet && change.reason === "readOnly" &&
                button("convert", t("changes.action.convert"), <Layers size={14} strokeWidth={2} />, true)}
              {!isSheet && (
                <button type="button" className="ghost-button" onClick={() => onAction("copy")}>
                  <Copy size={14} strokeWidth={2} />
                  {t("changes.action.copyChange")}
                </button>
              )}
              {iconButton("discard", t("changes.action.discardPath", { path: change.path }), <X size={15} strokeWidth={2} />)}
            </>
          )}
        </span>
      </div>
      {(explanation || error) && (
        <p className={`change-card-reason ${error ? "error" : ""}`}>{error ?? explanation}</p>
      )}
    </li>
  );
}
