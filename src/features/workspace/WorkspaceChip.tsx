import { Cloud, FolderOpen, FolderSearch, FolderX, Laptop, ScanSearch, X } from "lucide-react";
import { useId, useLayoutEffect, useRef } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useDialogPopover } from "@/shared/hooks/useDialogPopover";
import type { MeaningState, WorkspaceState } from "./useWorkspaces";
import { formatNumber } from "@/shared/lib/format";
import { revealLabel } from "@/shared/lib/platform";
import { privacyLine, type WorkspaceIndexText } from "./workspace";
import type { WorkspaceFolder } from "@/shared/types";

type Props = {
  folder: WorkspaceFolder;
  state: WorkspaceState | null;
  // The index as the selected model would get it; null when not even collapsed it fits
  index: WorkspaceIndexText | null | undefined;
  modelName?: string;
  // The cloud provider the selected model belongs to; undefined for a local model
  cloudProvider?: string;
  placement: "up" | "down";
  // Search by meaning; null when it is turned off
  meaning: MeaningState | null;
  // Missing for a project's folder, which can't be changed nor disconnected
  onChange?: () => void;
  onDisconnect?: () => void;
  onReveal: () => void;
};

const isProblem = (state: WorkspaceState | null) =>
  state?.kind === "missing" || state?.kind === "noAccess" || state?.kind === "error" || state?.kind === "empty";

// The connected folder next to the model: a setting of the conversation, like the model, and a privacy matter, so it
// stays visible while connected. Its details and actions open on click.
export function WorkspaceChip(props: Props) {
  const { folder, state, index, modelName, cloudProvider, placement, meaning, onChange, onDisconnect, onReveal } = props;
  const { isOpen, rootRef, close, toggle, triggerRef, closeRef, closeAndReturn, onDialogKeyDown } = useDialogPopover();
  const { t } = useTranslation();
  const popoverRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const ready = state?.kind === "ready" ? state : null;
  const doesNotFit = !!ready && index === null;
  const problem = isProblem(state) || doesNotFit;
  const note =
    state?.kind === "indexing"
      ? t("workspace.chip.reading")
      : doesNotFit
        ? t("workspace.chip.doesNotFit")
        : state?.kind === "empty"
          ? t("workspace.chip.nothingReadable")
          : problem
            ? t("workspace.chip.noAccess")
            : null;
  const named = { name: folder.name, note };
  const label = ready
    ? t(note ? "workspace.chip.labelReadyNote" : "workspace.chip.labelReady", {
        ...named,
        files: t("workspace.files", { count: ready.files.length }),
      })
    : t(note ? "workspace.chip.labelNote" : "workspace.chip.label", named);

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!isOpen || !popover) return;
    popover.dataset.align = "start";
    if (popover.getBoundingClientRect().right > window.innerWidth - 12) popover.dataset.align = "end";
  }, [isOpen]);

  function act(action: () => void) {
    close();
    action();
  }

  return (
    <span className={`workspace-chip-wrap ${problem ? "problem" : ""}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`workspace-chip ${onDisconnect ? "" : "alone"}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={label}
        title={folder.path}
        onClick={toggle}
      >
        {state?.kind === "indexing" ? (
          <span className="workspace-spinner" aria-hidden="true" />
        ) : problem ? (
          <FolderX size={15} strokeWidth={2} aria-hidden="true" />
        ) : (
          <FolderOpen size={15} strokeWidth={2} aria-hidden="true" />
        )}
        <span className="workspace-chip-name">{folder.name}</span>
        {note && <span className="workspace-chip-note">· {note}</span>}
      </button>
      {onDisconnect && (
        <button
          type="button"
          className="workspace-chip-remove"
          aria-label={t("workspace.chip.disconnectFolder", { name: folder.name })}
          title={t("workspace.disconnect")}
          onClick={onDisconnect}
        >
          <X size={13} strokeWidth={2.4} />
        </button>
      )}

      {isOpen && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-labelledby={titleId}
          className={`workspace-details ${placement}`}
          onKeyDown={onDialogKeyDown}
        >
          <div className="workspace-details-header">
            <FolderOpen size={18} strokeWidth={2} aria-hidden="true" />
            <span>
              <strong id={titleId}>{folder.name}</strong>
              <small>{t("workspace.chip.connectedReadOnly")}</small>
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
          <p className="workspace-details-path">{folder.path}</p>
          {ready && (
            <div className="workspace-details-stats">
              <span>
                <strong>{formatNumber(ready.files.length)}</strong>
                {t("workspace.chip.readableFiles")}
              </span>
              <span>
                <strong>{formatNumber(ready.skipped)}</strong>
                {t("workspace.chip.binariesAndSecrets")}
              </span>
              <span>
                <strong>{index ? `≈ ${formatNumber(index.tokens)}` : "—"}</strong>
                {index?.summarized ? t("workspace.chip.indexTokensSummarized") : t("workspace.chip.indexTokens")}
              </span>
            </div>
          )}
          {ready && meaning && (
            <p className="workspace-details-meaning">
              <ScanSearch size={14} strokeWidth={2} aria-hidden="true" />
              <span>
                {t("workspace.chip.meaning")}{" "}
                {meaning.kind === "ready"
                  ? t("workspace.chip.meaningReady", { model: meaning.model })
                  : meaning.kind === "preparing"
                    ? t("workspace.chip.meaningPreparing", {
                        done: formatNumber(meaning.done),
                        total: formatNumber(meaning.total),
                      })
                    : meaning.kind === "unavailable"
                      ? t("workspace.chip.meaningUnavailable")
                      : t("workspace.chip.meaningError", { message: meaning.message })}
              </span>
            </p>
          )}
          <p className={`workspace-details-privacy ${cloudProvider ? "" : "local"}`}>
            {cloudProvider ? <Cloud size={14} strokeWidth={2} /> : <Laptop size={14} strokeWidth={2} />}
            <span>{privacyLine(modelName, cloudProvider)}</span>
          </p>
          <details className="workspace-details-ignored">
            <summary>{t("workspace.chip.whatNot")}</summary>
            <ul>
              <li>
                <Trans i18nKey="workspace.chip.ignoredGit" components={{ mono: <span className="mono" /> }} />
              </li>
              <li>
                <Trans i18nKey="workspace.chip.ignoredHidden" components={{ mono: <span className="mono" /> }} />
              </li>
              <li>
                <Trans i18nKey="workspace.chip.ignoredSecrets" components={{ mono: <span className="mono" /> }} />
              </li>
            </ul>
            <p>{t("workspace.chip.rereads")}</p>
          </details>
          <div className="workspace-details-actions">
            <button type="button" className="ghost-button" onClick={() => act(onReveal)}>
              <FolderSearch size={15} strokeWidth={1.8} />
              {revealLabel()}
            </button>
            {onChange && (
              <button type="button" className="outline-button small" onClick={() => act(onChange)}>
                {t("workspace.chip.change")}
              </button>
            )}
            {onDisconnect && (
              <button type="button" className="outline-button small danger" onClick={() => act(onDisconnect)}>
                {t("workspace.disconnect")}
              </button>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
