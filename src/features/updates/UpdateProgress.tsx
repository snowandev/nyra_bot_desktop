import { useTranslation } from "react-i18next";
import { formatStorage } from "@/shared/lib/format";
import { percentOf, type UpdateStep } from "./useUpdates";

type Props = {
  step: Extract<UpdateStep, { kind: "downloading" }>;
  version: string;
};

// The bar, the percent and the megabytes; without a known size, only what has arrived
export function UpdateProgress({ step, version }: Props) {
  const { t } = useTranslation();
  const percent = percentOf(step);
  const text =
    percent === null || !step.total
      ? formatStorage(step.done)
      : t("updates.notice.progress", { percent, done: formatStorage(step.done), total: formatStorage(step.total) });
  return (
    <>
      <div
        className="update-bar"
        role="progressbar"
        aria-label={t("updates.notice.downloading", { version })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={text}
      >
        <i style={{ width: `${percent ?? 0}%` }} />
      </div>
      <span className="update-progress-text" aria-hidden="true">
        {text}
      </span>
    </>
  );
}
