import { CircleAlert, RotateCw } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { OLLAMA_DOWNLOAD_URL } from "./ollamaCatalog";
import { ExternalLink } from "@/shared/ui/ExternalLink";

type Props = {
  baseUrl: string;
  error: string | null;
  onRetry: () => void;
};

// Without a connection there's nothing to list, download or delete: what to check instead
export function OllamaUnavailable({ baseUrl, error, onRetry }: Props) {
  const { t } = useTranslation();
  const code = { code: <code /> };
  return (
    <div className="ollama-unavailable" role="alert">
      <div className="ollama-unavailable-title">
        <CircleAlert size={18} strokeWidth={2} />
        <div>
          <strong>{t("models.unavailable.title")}</strong>
          <p>
            <Trans
              i18nKey="models.unavailable.body"
              values={{ address: baseUrl }}
              components={{ address: <span className="mono" /> }}
            />
          </p>
          {error && <p className="ollama-unavailable-detail">{error}</p>}
        </div>
      </div>
      <ol>
        <li>
          <Trans i18nKey="models.unavailable.openApp" components={code} />
        </li>
        <li>
          <Trans i18nKey="models.unavailable.checkUrl" components={code} />
        </li>
        <li>
          <Trans i18nKey="models.unavailable.network" components={code} />
        </li>
      </ol>
      <div className="ollama-unavailable-actions">
        <button type="button" className="primary-button padded" onClick={onRetry}>
          <RotateCw size={15} strokeWidth={2.1} />
          {t("common.retry")}
        </button>
        <ExternalLink href={OLLAMA_DOWNLOAD_URL}>{t("models.unavailable.download")}</ExternalLink>
      </div>
    </div>
  );
}
