import { ChevronRight, CircleAlert, CircleCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useModelDownloadsContext } from "./modelDownloadsContext";
import { overallProgress } from "./useModelDownloads";
import { formatStorage } from "@/shared/lib/format";
import { ProgressRing } from "./ProgressRing";

type Props = {
  // Settings → Proveedores, where the downloads are managed
  onOpen: () => void;
};

// How long "… listo" stays after a download finishes
const DONE_MS = 5000;

// Downloads go on while Settings is closed; this keeps them in sight from the sidebar
export function DownloadsIndicator({ onOpen }: Props) {
  const { downloads, lastFinished } = useModelDownloadsContext();
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const progress = overallProgress(downloads);
  const failed = downloads.find((d) => d.status === "error");
  const justFinished = lastFinished && now - lastFinished.at < DONE_MS ? lastFinished : null;

  // Re-renders when the "listo" moment is over, so it goes away on its own
  useEffect(() => {
    if (!lastFinished) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, lastFinished.at + DONE_MS - Date.now()));
    return () => window.clearTimeout(timer);
  }, [lastFinished]);

  let card = null;
  if (progress.count > 0) {
    const single = progress.count === 1 ? downloads.find((d) => d.status === "active")?.name : null;
    const label = single
      ? t("models.indicator.downloadingOne", { name: single })
      : t("models.indicator.downloadingMany", { count: progress.count });
    const amount =
      progress.total > 0
        ? ` · ${t("models.indicator.amount", { completed: formatStorage(progress.completed), total: formatStorage(progress.total) })}`
        : "";
    card = (
      <button
        type="button"
        className="downloads-indicator"
        aria-label={t("models.indicator.label", { label, percent: progress.percent })}
        onClick={onOpen}
      >
        <ProgressRing percent={progress.percent} />
        <span className="downloads-indicator-text">
          <strong>{label}</strong>
          <small>
            {t("models.percent", { percent: progress.percent })}
            {amount}
          </small>
        </span>
        <ChevronRight size={15} strokeWidth={2} className="downloads-indicator-arrow" />
      </button>
    );
  } else if (failed) {
    card = (
      <button
        type="button"
        className="downloads-indicator failed"
        aria-label={t("models.indicator.failedLabel", { name: failed.name })}
        onClick={onOpen}
      >
        <CircleAlert size={22} strokeWidth={2} />
        <span className="downloads-indicator-text">
          <strong className="mono">{failed.name}</strong>
          <small>{t("models.indicator.failed")}</small>
        </span>
        <ChevronRight size={15} strokeWidth={2} className="downloads-indicator-arrow" />
      </button>
    );
  } else if (justFinished) {
    card = (
      <button
        type="button"
        className="downloads-indicator done"
        aria-label={t("models.indicator.doneLabel", { name: justFinished.name })}
        onClick={onOpen}
      >
        <CircleCheck size={22} strokeWidth={2} />
        <span className="downloads-indicator-text">
          <strong className="mono">{t("models.indicator.ready", { name: justFinished.name })}</strong>
          <small>{t("models.indicator.downloaded")}</small>
        </span>
      </button>
    );
  }

  return (
    <>
      {card}
      {/* Heard even with Settings closed, where the download's own note isn't */}
      <span className="visually-hidden" role="status">
        {justFinished ? t("models.indicator.doneAnnounce", { name: justFinished.name }) : ""}
        {failed ? t("models.indicator.failedAnnounce", { name: failed.name }) : ""}
      </span>
    </>
  );
}
