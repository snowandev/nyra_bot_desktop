import { WifiOff } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

type Props = {
  // Only the latest reply can be asked again
  onRetry?: () => void;
};

// Information, not an error: the reply still comes, from what the model knows
export function SearchFailedNotice({ onRetry }: Props) {
  const { t } = useTranslation();
  return (
    <div className="search-failed" role="note">
      <WifiOff size={15} strokeWidth={2} />
      <span>
        <Trans i18nKey="web.failed" components={{ b: <b /> }} />
      </span>
      {onRetry && (
        <button type="button" className="search-failed-retry" onClick={onRetry}>
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}
