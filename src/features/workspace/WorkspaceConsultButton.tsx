import {
  ChevronDown,
  Eye,
  FileSearch,
  FileText,
  FolderOpen,
  FolderSearch,
  ListTree,
  Lock,
  ScrollText,
  Search,
  TextSelect,
  X,
} from "lucide-react";
import { type ReactNode, useId, useLayoutEffect, useRef } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useDialogPopover } from "@/shared/hooks/useDialogPopover";
import { formatBytes, formatNumber } from "@/shared/lib/format";
import { revealLabel } from "@/shared/lib/platform";
import { SKIP_REASON_LABEL } from "./workspace";
import type { WorkspaceConsult } from "@/shared/types";
import { PathLabel } from "./PathLabel";

type Props = {
  consult: WorkspaceConsult;
  // Undefined in the shared image, where nothing can be opened
  onOpenFile?: (path: string) => void;
  onReveal?: (path: string) => void;
};

// "Consultó la carpeta · 3 archivos · 1 búsqueda": what the reply looked at in the folder; the list on click
export function WorkspaceConsultButton({ consult, onOpenFile, onReveal }: Props) {
  const { isOpen, rootRef, toggle, triggerRef, closeRef, closeAndReturn, onDialogKeyDown } = useDialogPopover();
  const { t } = useTranslation();
  const popoverRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const whole = consult.read.filter((r) => !r.lines);
  const partial = consult.read.filter((r) => r.lines);
  const files = consult.read.length;
  const summary = [
    files > 0 && t("workspace.files", { count: files }),
    consult.searches.length > 0 && t("workspace.consult.searches", { count: consult.searches.length }),
    files === 0 &&
      consult.searches.length === 0 &&
      consult.listed.length > 0 &&
      t("workspace.consult.folders", { count: consult.listed.length }),
  ].filter(Boolean);
  const labelDetails = [
    ...summary,
    consult.skipped.length > 0 && t("workspace.consult.notRead", { count: consult.skipped.length }),
    consult.maxed && t("workspace.consult.usedAllSteps"),
    consult.stuck && t("workspace.consult.stoppedStuck"),
  ].filter(Boolean);

  // Aligned with the button's left edge; to its right edge if it would leave the window
  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!isOpen || !popover) return;
    popover.dataset.align = "start";
    if (popover.getBoundingClientRect().right > window.innerWidth - 12) popover.dataset.align = "end";
  }, [isOpen]);

  const fileRow = (key: string, icon: ReactNode, path: string, detail: ReactNode) => (
    <li key={key} className="workspace-file">
      {icon}
      <span className="workspace-file-text">
        <span className="workspace-file-path" title={path}>
          <PathLabel path={path} dirClassName="workspace-file-dir" />
        </span>
        <span className="workspace-file-detail">{detail}</span>
      </span>
      {(onOpenFile || onReveal) && (
        <span className="workspace-file-actions">
          {onOpenFile && (
            <button
              type="button"
              className="icon-button small"
              aria-label={t("workspace.consult.openInViewer", { path })}
              title={t("workspace.consult.openInViewerShort")}
              onClick={() => onOpenFile(path)}
            >
              <Eye size={15} strokeWidth={1.8} />
            </button>
          )}
          {onReveal && (
            <button
              type="button"
              className="icon-button small"
              aria-label={`${revealLabel()}: ${path}`}
              title={revealLabel()}
              onClick={() => onReveal(path)}
            >
              <FolderSearch size={15} strokeWidth={1.8} />
            </button>
          )}
        </span>
      )}
    </li>
  );

  return (
    <span className="workspace-consult" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="reply-summary"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={t("workspace.consult.label", { details: labelDetails.join(", ") })}
        onClick={toggle}
      >
        <FolderSearch size={15} strokeWidth={2} className="reply-summary-icon workspace" />
        <span>{t("workspace.consult.consulted")}</span>
        {summary.length > 0 && <span className="reply-summary-detail">· {summary.join(" · ")}</span>}
        {consult.maxed && <span className="workspace-maxed-tag">· {t("workspace.consult.noMoreSteps")}</span>}
        {consult.stuck && <span className="workspace-maxed-tag">· {t("workspace.consult.stopped")}</span>}
        <ChevronDown size={14} strokeWidth={2} className="reply-summary-chevron" />
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-labelledby={titleId}
          className="workspace-consult-popover"
          onKeyDown={onDialogKeyDown}
        >
          <div className="skills-used-header">
            <span>
              <strong id={titleId}>{t("workspace.consult.title")}</strong>
              <small>
                <Trans
                  i18nKey="workspace.consult.inFolder"
                  values={{ folder: consult.folder }}
                  components={{ path: <span className="mono" /> }}
                />
              </small>
            </span>
            <button
              ref={closeRef}
              type="button"
              className="icon-button small"
              aria-label={t("workspace.close")}
              onClick={closeAndReturn}
            >
              <X size={15} strokeWidth={2} />
            </button>
          </div>

          <div className="workspace-consult-body">
            {whole.length > 0 && (
              <section>
                <h4>
                  <FileText size={12} strokeWidth={2} aria-hidden="true" />
                  {t("workspace.consult.readWhole")}
                </h4>
                <ul>
                  {whole.map((r) =>
                    fileRow(r.path, <FileText size={15} strokeWidth={1.8} aria-hidden="true" />, r.path, formatBytes(r.size)),
                  )}
                </ul>
              </section>
            )}
            {partial.length > 0 && (
              <section>
                <h4>
                  <TextSelect size={12} strokeWidth={2} aria-hidden="true" />
                  {t("workspace.consult.someLines")}
                </h4>
                <ul>
                  {partial.map((r) =>
                    fileRow(
                      r.path,
                      <TextSelect size={15} strokeWidth={1.8} aria-hidden="true" />,
                      r.path,
                      r.lines &&
                        t("workspace.consult.linesOf", {
                          from: formatNumber(r.lines.from),
                          to: formatNumber(r.lines.to),
                          total: formatNumber(r.lines.total),
                          size: formatBytes(r.size),
                        }),
                    ),
                  )}
                </ul>
              </section>
            )}
            {consult.searches.map((search, i) => (
              <section key={`search-${i}`}>
                <h4>
                  <Search size={12} strokeWidth={2} aria-hidden="true" />
                  {search.byMeaning ? t("workspace.consult.foundByMeaning") : t("workspace.consult.foundBySearch")}{" "}
                  <span className="mono">"{search.query}"</span>
                </h4>
                {search.files.length === 0 ? (
                  <p className="workspace-consult-empty">
                    {search.byMeaning ? t("workspace.consult.nothingSimilar") : t("workspace.consult.noMatches")}
                  </p>
                ) : (
                  <ul>
                    {search.files.map((f) =>
                      fileRow(
                        `${i}-${f.path}`,
                        <FileSearch size={15} strokeWidth={1.8} aria-hidden="true" />,
                        f.path,
                        search.byMeaning
                          ? t("workspace.fragments", { count: f.count })
                          : t("workspace.matches", { count: f.count }),
                      ),
                    )}
                  </ul>
                )}
              </section>
            ))}
            {consult.listed.length > 0 && (
              <section>
                <h4>
                  <FolderOpen size={12} strokeWidth={2} aria-hidden="true" />
                  {t("workspace.consult.openFolders")}
                </h4>
                <p className="workspace-consult-folders">
                  {consult.listed.map((folder) => (
                    <span key={folder} className="mono">
                      {folder}/
                    </span>
                  ))}
                </p>
              </section>
            )}
            {!!consult.guides?.length && (
              <section>
                <h4>
                  <ScrollText size={12} strokeWidth={2} aria-hidden="true" />
                  {t("workspace.consult.guides")}
                </h4>
                <p className="workspace-consult-folders">
                  {consult.guides.map((path) => (
                    <span key={path} className="mono">
                      {path}
                    </span>
                  ))}
                </p>
              </section>
            )}
            {!!consult.outlined?.length && (
              <section>
                <h4>
                  <ListTree size={12} strokeWidth={2} aria-hidden="true" />
                  {t("workspace.consult.outlines")}
                </h4>
                <p className="workspace-consult-folders">
                  {consult.outlined.map((folder) => (
                    <span key={folder} className="mono">
                      {folder || t("workspace.consult.wholeFolder")}
                    </span>
                  ))}
                </p>
              </section>
            )}
            {consult.skipped.length > 0 && (
              <section>
                <h4>
                  <Lock size={12} strokeWidth={2} aria-hidden="true" />
                  {t("workspace.consult.notReadTitle")}
                </h4>
                <ul>
                  {consult.skipped.map((s) => (
                    <li key={s.path} className="workspace-file skipped">
                      <Lock size={15} strokeWidth={1.8} aria-hidden="true" />
                      <span className="workspace-file-text">
                        <span className="workspace-file-path mono">{s.path}</span>
                        <span className="workspace-file-detail">{SKIP_REASON_LABEL[s.reason]}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <p className="skills-used-footer">
            {t("workspace.consult.footer", {
              tokens: formatNumber(consult.tokens),
              compacted: consult.compactions ? t("workspace.consult.compacted", { count: consult.compactions }) : "",
            })}
          </p>
        </div>
      )}
    </span>
  );
}
