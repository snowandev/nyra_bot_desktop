import { CircleCheck, CircleX, Download, ExternalLink, Package, RotateCw, X } from "lucide-react";
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { BrandIcon } from "@/shared/ui/BrandIcon";
import { Dialog } from "@/shared/ui/Dialog";
import { openInBrowser } from "@/shared/lib/links";
import { releasePage } from "./updateStorage";
import { UpdateNotes, versionDate } from "./UpdateNotes";
import { UpdateProgress } from "./UpdateProgress";
import { canInstallOnQuit } from "./useUpdates";
import { useUpdatesContext } from "./updatesContext";

// What a new version brings, and the same actions as the notice; its footer changes with the update's step
export function UpdateDialog() {
  const updates = useUpdatesContext();
  const { t } = useTranslation();
  const titleId = useId();
  const { step, latest, current, notes } = updates;
  if (!updates.isNotesOpen || !latest || !current) return null;

  const isUpdated = step.kind === "updated" || step.kind === "none";
  const shown = isUpdated ? notes.slice(0, 1) : notes;
  // "Más tarde" in the window also hides the notice until Nyra opens again
  const later = () => {
    updates.hide();
    updates.closeNotes();
  };
  const laterButton = (
    <button type="button" className="outline-button" onClick={later}>
      {t("updates.notice.later")}
    </button>
  );

  let message: ReactNode = null;
  let actions: ReactNode;
  switch (step.kind) {
    case "downloading":
      message = (
        <div className="update-dialog-message">
          <strong>{t("updates.notes.downloading", { version: latest })}</strong>
          <UpdateProgress step={step} version={latest} />
          <small>{t("updates.notes.keepsGoing")}</small>
        </div>
      );
      actions = (
        <button type="button" className="outline-button" onClick={updates.cancelDownload} data-autofocus>
          {t("updates.notice.cancel")}
        </button>
      );
      break;
    case "ready":
      message = (
        <div className="update-dialog-message ok">
          <strong>
            <CircleCheck size={15} strokeWidth={2.2} aria-hidden="true" />
            {t("updates.notice.ready")}
          </strong>
          <span>{t("updates.notes.readyText")}</span>
        </div>
      );
      actions = (
        <>
          {canInstallOnQuit && (
            <button type="button" className="outline-button" onClick={() => void updates.installOnQuit()}>
              {t("updates.notice.onQuit")}
            </button>
          )}
          <button type="button" className="primary-button" onClick={() => void updates.restart()} data-autofocus>
            <RotateCw size={15} strokeWidth={2.2} aria-hidden="true" />
            {t("updates.notice.restart")}
          </button>
        </>
      );
      break;
    case "onQuit":
      message = (
        <div className="update-dialog-message ok">
          <strong>
            <CircleCheck size={15} strokeWidth={2.2} aria-hidden="true" />
            {t("updates.notice.onQuitDone")}
          </strong>
        </div>
      );
      actions = (
        <>
          <button type="button" className="outline-button" onClick={updates.closeNotes}>
            {t("updates.notice.close")}
          </button>
          <button type="button" className="primary-button" onClick={() => void updates.restart()} data-autofocus>
            {t("updates.notice.restart")}
          </button>
        </>
      );
      break;
    case "failed":
      message = (
        <div className="update-dialog-message error">
          <strong>
            <CircleX size={15} strokeWidth={2.2} aria-hidden="true" />
            {t("updates.notice.failed")}
          </strong>
          <span>
            {step.percent !== null && `${t("updates.notice.failedAt", { percent: step.percent })} `}
            <button type="button" className="link-button" onClick={() => void openInBrowser(releasePage(latest))}>
              <ExternalLink size={12} strokeWidth={2.2} aria-hidden="true" />
              {t("updates.notice.byHand")}
            </button>
          </span>
        </div>
      );
      actions = (
        <>
          {laterButton}
          <button type="button" className="primary-button" onClick={() => void updates.startDownload()} data-autofocus>
            <RotateCw size={15} strokeWidth={2.2} aria-hidden="true" />
            {t("updates.notice.retry")}
          </button>
        </>
      );
      break;
    default:
      if (isUpdated) {
        message = (
          <div className="update-dialog-message ok">
            <strong>
              <CircleCheck size={15} strokeWidth={2.2} aria-hidden="true" />
              {t("updates.notes.upToDate", { version: current })}
            </strong>
          </div>
        );
        actions = (
          <button type="button" className="primary-button" onClick={updates.closeNotes} data-autofocus>
            {t("updates.notice.close")}
          </button>
        );
      } else if (updates.kind === "package") {
        message = (
          <div className="update-dialog-message">
            <span className="update-dialog-inline">
              <Package size={15} strokeWidth={2} aria-hidden="true" />
              {t("updates.notes.package")}
            </span>
          </div>
        );
        actions = (
          <>
            {laterButton}
            <button
              type="button"
              className="primary-button"
              onClick={() => void openInBrowser(releasePage(latest))}
              data-autofocus
            >
              <ExternalLink size={15} strokeWidth={2.2} aria-hidden="true" />
              {t("updates.notice.download")}
            </button>
          </>
        );
      } else {
        actions = (
          <>
            {laterButton}
            <button type="button" className="primary-button" onClick={() => void updates.startDownload()} data-autofocus>
              <Download size={15} strokeWidth={2.2} aria-hidden="true" />
              {t("updates.notes.updateNow")}
            </button>
          </>
        );
      }
  }

  const version = isUpdated ? current : latest;
  const date = shown[0] ? versionDate(shown[0].date) : null;
  return (
    <Dialog onClose={updates.closeNotes} labelledBy={titleId} className="update-dialog">
      <header className="update-dialog-header">
        <span className="update-dialog-logo brand-plate">
          <BrandIcon size={36} gradient />
        </span>
        <div className="update-dialog-title">
          <h2 id={titleId}>
            {isUpdated ? t("updates.notes.titleUpdated", { version }) : t("updates.notes.title", { version })}
          </h2>
          <div className="update-dialog-meta">
            {date && <span>{date}</span>}
            {!isUpdated && <span className="pill">{t("updates.notice.youHave", { version: current })}</span>}
            {!isUpdated && notes.length > 1 && (
              <span className="pill accent">{t("updates.notes.newVersions", { count: notes.length })}</span>
            )}
          </div>
        </div>
        <button type="button" className="icon-button" aria-label={t("updates.notes.close")} onClick={updates.closeNotes}>
          <X size={16} strokeWidth={2} />
        </button>
      </header>
      <div className="update-dialog-body" tabIndex={0} aria-label={t("updates.notes.label")}>
        {shown.length > 0 ? (
          <UpdateNotes versions={shown} showHeadings={shown.length > 1} />
        ) : (
          <p className="update-dialog-empty">{t("updates.notes.empty")}</p>
        )}
      </div>
      <footer className="update-dialog-footer">
        {message}
        <div className="update-dialog-actions">{actions}</div>
      </footer>
    </Dialog>
  );
}
