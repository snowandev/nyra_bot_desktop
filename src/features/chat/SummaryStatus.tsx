import { LoaderCircle, RotateCw, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  error: string | null;
  onRetry: () => void;
  onCancel: () => void;
};

export function SummaryStatus({ error, onRetry, onCancel }: Props) {
  const { t } = useTranslation();
  if (!error) {
    return (
      <div role="status" className="summary-status">
        <LoaderCircle size={18} strokeWidth={2.2} className="summary-status-icon spin" />
        <div className="summary-status-text">
          <span className="summary-status-title">{t("chat.summary.running")}</span>
          <span className="summary-status-detail">{t("chat.summary.runningDetail")}</span>
        </div>
        <button type="button" className="ghost-button summary-status-action" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    );
  }

  return (
    <div role="alert" className="summary-status error">
      <TriangleAlert size={18} strokeWidth={2} className="summary-status-icon" />
      <div className="summary-status-text">
        <span className="summary-status-title">{t("chat.summary.failed")}</span>
        <span className="summary-status-detail">{error}</span>
      </div>
      <button type="button" className="primary-button summary-status-action" onClick={onRetry}>
        <RotateCw size={15} strokeWidth={2.2} />
        {t("common.retry")}
      </button>
    </div>
  );
}
