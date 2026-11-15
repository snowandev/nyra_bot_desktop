import type { TFunction } from "i18next";
import { CircleAlert, Download, Pencil, RotateCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type ModelDownload, percentOf } from "./useModelDownloads";
import { formatRemaining, formatSpeed, formatStorage } from "@/shared/lib/format";
import type { PullPhase } from "@/providers/ollamaModels";
import { DownloadSteps } from "./DownloadSteps";

type Props = {
  download: ModelDownload;
  // "este equipo" or "el equipo 192.168.1.20"
  place: string;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
  onEditName: () => void;
};

// Ollama's phases, as a person would say them (models.downloadCard.phases); the diamonds mark the step
const STEPS: Record<PullPhase, number> = { preparing: 0, downloading: 1, verifying: 2, writing: 3 };

function errorText(download: ModelDownload, place: string, t: TFunction): [string, string] {
  switch (download.errorKind) {
    case "not-found":
      return [t("models.downloadCard.notFound", { name: download.name }), t("models.downloadCard.notFoundHelp")];
    case "disk":
      return [t("models.downloadCard.disk", { place }), t("models.downloadCard.diskHelp")];
    case "connection":
      return [
        t("models.downloadCard.connection"),
        download.completed > 0
          ? t("models.downloadCard.connectionResume", { size: formatStorage(download.completed) })
          : t("models.downloadCard.connectionHelp"),
      ];
    default:
      return [t("models.downloadCard.failed"), download.error ?? ""];
  }
}

export function ModelDownloadCard({ download, place, onCancel, onRetry, onDismiss, onEditName }: Props) {
  const { name, status, phase, completed, total, speed } = download;
  const { t } = useTranslation();

  if (status === "error") {
    const [title, help] = errorText(download, place, t);
    return (
      <li className="download-card error">
        <div className="download-card-line">
          <span className="mono download-card-name" title={name}>
            {name}
          </span>
          <button
            type="button"
            className="icon-button small"
            aria-label={t("models.downloadCard.dismissLabel", { name })}
            onClick={onDismiss}
          >
            <X size={15} strokeWidth={2} />
          </button>
        </div>
        <div className="download-card-error" role="alert">
          <CircleAlert size={16} strokeWidth={2} />
          <span>
            <strong>{title}</strong> {help}
          </span>
        </div>
        <div className="download-card-actions">
          {download.errorKind === "not-found" ? (
            <button type="button" className="outline-button small" onClick={onEditName}>
              <Pencil size={13} strokeWidth={2} />
              {t("models.downloadCard.editName")}
            </button>
          ) : (
            <button type="button" className="outline-button small" onClick={onRetry}>
              <RotateCw size={13} strokeWidth={2} />
              {t("common.retry")}
            </button>
          )}
        </div>
      </li>
    );
  }

  if (status === "cancelled") {
    return (
      <li className="download-card cancelled">
        <div className="download-card-line">
          <span className="mono download-card-name" title={name}>
            {name}
          </span>
          <span className="download-card-phase muted-phase">{t("models.downloadCard.cancelled")}</span>
          <button
            type="button"
            className="icon-button small"
            aria-label={t("models.downloadCard.removeLabel", { name })}
            onClick={onDismiss}
          >
            <X size={15} strokeWidth={2} />
          </button>
        </div>
        {completed > 0 && (
          <div className="download-card-stats">
            {total > 0
              ? t("models.downloadCard.resumeFromOf", { size: formatStorage(completed), total: formatStorage(total) })
              : t("models.downloadCard.resumeFrom", { size: formatStorage(completed) })}
          </div>
        )}
        <div className="download-card-actions">
          <button type="button" className="outline-button small" onClick={onRetry}>
            <Download size={13} strokeWidth={2} />
            {t("models.downloadCard.downloadAgain")}
          </button>
        </div>
      </li>
    );
  }

  const step = STEPS[phase];
  const percent = phase === "preparing" ? null : percentOf(download);
  const valueText =
    percent === null
      ? t("models.downloadCard.preparingValue")
      : t("models.downloadCard.progressValue", {
          percent,
          completed: formatStorage(completed),
          total: formatStorage(total),
        });

  return (
    <li className="download-card">
      <div className="download-card-line">
        <span className="mono download-card-name" title={name}>
          {name}
        </span>
        <span className="download-card-phase">
          <DownloadSteps current={step} />
          {t(`models.downloadCard.phases.${phase}`)}
        </span>
        <button
          type="button"
          className="icon-button small"
          aria-label={t("models.downloadCard.cancelLabel", { name })}
          onClick={onCancel}
        >
          <X size={15} strokeWidth={2} />
        </button>
      </div>
      <div
        className={`download-bar ${percent === null ? "indeterminate" : ""} ${step >= 2 ? "verifying" : ""}`}
        role="progressbar"
        aria-label={t("models.downloadCard.barLabel", { name })}
        aria-valuemin={percent === null ? undefined : 0}
        aria-valuemax={percent === null ? undefined : 100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={valueText}
      >
        <span style={percent === null ? undefined : { width: `${percent}%` }} />
      </div>
      <div className="download-card-stats">
        {phase === "preparing" && <span>{t("models.downloadCard.checkingLibrary")}</span>}
        {phase === "downloading" && (
          <>
            <span>
              <strong>{formatStorage(completed)}</strong>
              {total > 0 && ` ${t("models.downloadCard.ofTotal", { total: formatStorage(total) })}`}
            </span>
            {speed !== null && speed > 0 && (
              <>
                <span>·</span>
                <span>{formatSpeed(speed)}</span>
                <span>·</span>
                <span>{formatRemaining((total - completed) / speed)}</span>
              </>
            )}
          </>
        )}
        {step >= 2 && (
          <span>
            {t("models.downloadCard.downloadedTotal", { total: formatStorage(total) })} ·{" "}
            {phase === "verifying" ? t("models.downloadCard.verifying") : t("models.downloadCard.saving")}
          </span>
        )}
        {percent !== null && <span className="download-card-percent">{t("models.percent", { percent })}</span>}
      </div>
    </li>
  );
}
