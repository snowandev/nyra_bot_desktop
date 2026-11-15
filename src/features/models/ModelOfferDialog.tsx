import { Cloud } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { getProvider } from "@/providers";
import type { Model } from "@/shared/types";
import { Dialog } from "@/shared/ui/Dialog";

type Props = {
  target: Model;
  current: Model;
  accept: () => void;
  decline: () => void;
};

// «Automático» would take the conversation to a cloud: nothing goes there until the user says so. Closing it keeps the
// main model, so the message is still answered.
export function ModelOfferDialog({ target, current, accept, decline }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const provider = getProvider(target.providerId)?.name ?? target.providerId;
  return (
    <Dialog onClose={decline} labelledBy={titleId} className="model-offer">
      <div className="model-offer-head">
        <Cloud size={18} strokeWidth={2} className="accent" aria-hidden="true" />
        <b id={titleId}>{t("models.offer.title", { model: target.name })}</b>
      </div>
      <p>{t("models.offer.body", { model: target.name, provider })}</p>
      <p className="model-offer-hint">{t("models.offer.hint")}</p>
      <div className="model-offer-actions">
        <button type="button" className="primary-button small" data-autofocus onClick={accept}>
          {t("models.offer.accept", { model: target.name })}
        </button>
        <button type="button" className="outline-button small" onClick={decline}>
          {t("models.offer.decline", { model: current.name })}
        </button>
      </div>
    </Dialog>
  );
}
