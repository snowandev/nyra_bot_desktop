import { Cloud } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getProvider } from "@/providers";
import type { Model } from "@/shared/types";

type Props = {
  target: Model;
  current: Model;
  accept: () => void;
  decline: () => void;
};

// «Automático» would take the conversation to a cloud: asked on a line above the bar, where the main window has a
// dialog that wouldn't fit. Nothing goes there until the user says so.
export function QuickModelOffer({ target, current, accept, decline }: Props) {
  const { t } = useTranslation();
  const provider = getProvider(target.providerId)?.name ?? target.providerId;
  return (
    <div className="status-strip quick-offer asking" role="group" aria-label={t("models.offer.title", { model: target.name })}>
      <Cloud size={16} strokeWidth={2} aria-hidden="true" />
      <span className="quick-offer-text" role="status">
        <b>{t("models.offer.title", { model: target.name })}</b>
        <span>{t("models.offer.body", { model: target.name, provider })}</span>
      </span>
      <span className="status-strip-actions">
        <button type="button" className="outline-button small" onClick={decline}>
          {t("models.offer.decline", { model: current.name })}
        </button>
        <button type="button" className="primary-button small" onClick={accept}>
          {t("models.offer.accept", { model: target.name })}
        </button>
      </span>
    </div>
  );
}
