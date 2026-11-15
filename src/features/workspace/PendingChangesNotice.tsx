import { List, X } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

type Props = {
  count: number;
  onShow: () => void;
  onDismiss: () => void;
};

// Above the composer while proposals wait: they never expire nor apply themselves, and nothing is written yet
export function PendingChangesNotice({ count, onShow, onDismiss }: Props) {
  const { t } = useTranslation();
  return (
    <div className="pending-changes" role="status">
      <List size={15} strokeWidth={2} aria-hidden="true" />
      <span>
        <Trans i18nKey="changes.proposals.pendingNotice" count={count} components={{ strong: <strong /> }} />
      </span>
      <button type="button" className="ghost-button" onClick={onShow}>
        {t("changes.proposals.goTo", { count })}
      </button>
      <button
        type="button"
        className="icon-button small"
        aria-label={t("changes.proposals.hideUntilNext")}
        onClick={onDismiss}
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
