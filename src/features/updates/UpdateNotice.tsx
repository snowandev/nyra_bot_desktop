import { CircleArrowUp, CircleCheck, CircleX, Download, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { openInBrowser } from "@/shared/lib/links";
import { releasePage } from "./updateStorage";
import { UpdateProgress } from "./UpdateProgress";
import { canInstallOnQuit } from "./useUpdates";
import { useUpdatesContext } from "./updatesContext";

type Tone = "" | "ok" | "error";

// At the foot of the sidebar: the whole update happens here, without covering the chat or taking the focus
export function UpdateNotice() {
  const updates = useUpdatesContext();
  const { t } = useTranslation();
  const { step, latest, current, notes } = updates;
  if (!latest || !current || step.kind === "none" || (updates.isHidden && (step.kind === "available" || step.kind === "failed"))) return null;

  const notesLink = (
    <button type="button" className="link-button" onClick={updates.openNotes}>
      {t("updates.notice.seeNotes")}
    </button>
  );
  const later = (
    <button type="button" className="ghost-button small" onClick={updates.hide}>
      {t("updates.notice.later")}
    </button>
  );
  const card = (tone: Tone, icon: ReactNode, title: string, detail: ReactNode, body: ReactNode) => (
    <section className={`update-notice ${tone}`} role="status" aria-label={t("updates.notice.label")}>
      <div className="update-notice-head">
        <span className="update-notice-icon">{icon}</span>
        <span className="update-notice-text">
          <strong>{title}</strong>
          {detail}
        </span>
      </div>
      {body}
    </section>
  );

  switch (step.kind) {
    case "available": {
      const detail =
        notes.length > 1
          ? t("updates.notice.skipped", { version: current, count: notes.length })
          : t("updates.notice.youHave", { version: current });
      const action =
        updates.kind === "package" ? (
          <button type="button" className="primary-button small" onClick={() => void openInBrowser(releasePage(latest))}>
            <ExternalLink size={13} strokeWidth={2.2} aria-hidden="true" />
            {t("updates.notice.download")}
          </button>
        ) : (
          <button type="button" className="primary-button small" onClick={() => void updates.startDownload()}>
            {t("updates.notice.update")}
          </button>
        );
      return card(
        "",
        <CircleArrowUp size={14} strokeWidth={2.2} />,
        t("updates.notice.available", { version: latest }),
        <span>{detail}</span>,
        <>
          <div className="update-notice-actions">{notesLink}</div>
          <div className="update-notice-actions">
            {later}
            {action}
          </div>
        </>,
      );
    }
    case "downloading":
      return card(
        "",
        <Download size={14} strokeWidth={2.2} />,
        t("updates.notice.downloading", { version: latest }),
        null,
        <>
          <UpdateProgress step={step} version={latest} />
          <div className="update-notice-actions">
            {notesLink}
            <button type="button" className="ghost-button small" onClick={updates.cancelDownload}>
              {t("updates.notice.cancel")}
            </button>
          </div>
        </>,
      );
    case "ready":
      return card(
        "ok",
        <CircleCheck size={14} strokeWidth={2.2} />,
        t("updates.notice.ready"),
        <span>{t("updates.notice.readyText")}</span>,
        <div className="update-notice-actions">
          {canInstallOnQuit && (
            <button type="button" className="ghost-button small" onClick={() => void updates.installOnQuit()}>
              {t("updates.notice.onQuit")}
            </button>
          )}
          <button type="button" className="primary-button small" onClick={() => void updates.restart()}>
            {t("updates.notice.restart")}
          </button>
        </div>,
      );
    case "onQuit":
      return card(
        "ok",
        <CircleCheck size={14} strokeWidth={2.2} />,
        t("updates.notice.onQuitDone"),
        null,
        <div className="update-notice-actions">
          {notesLink}
          <button type="button" className="outline-button small" onClick={() => void updates.restart()}>
            {t("updates.notice.restart")}
          </button>
        </div>,
      );
    case "failed":
      return card(
        "error",
        <CircleX size={14} strokeWidth={2.2} />,
        t("updates.notice.failed"),
        step.percent !== null && <span>{t("updates.notice.failedAt", { percent: step.percent })}</span>,
        <>
          <div className="update-notice-actions">
            <button type="button" className="link-button" onClick={() => void openInBrowser(releasePage(latest))}>
              <ExternalLink size={12} strokeWidth={2.2} aria-hidden="true" />
              {t("updates.notice.byHand")}
            </button>
          </div>
          <div className="update-notice-actions">
            {later}
            <button type="button" className="primary-button small" onClick={() => void updates.startDownload()}>
              {t("updates.notice.retry")}
            </button>
          </div>
        </>,
      );
    case "updated":
      return card(
        "ok",
        <CircleCheck size={14} strokeWidth={2.2} />,
        t("updates.notice.updated", { version: current }),
        null,
        <div className="update-notice-actions">
          {notes.length > 0 && notesLink}
          <button type="button" className="ghost-button small" onClick={updates.dismissUpdated}>
            {t("updates.notice.close")}
          </button>
        </div>,
      );
  }
}
