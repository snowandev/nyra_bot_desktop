import { Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useProviderSettingsContext } from "./providerSettingsContext";

type Props = {
  modelId: string;
  name: string;
};

// Next to the star of the main model: this one is the model for demanding tasks («Automático» switches to it)
export function DemandingModelButton({ modelId, name }: Props) {
  const { t } = useTranslation();
  const { demandingModelId, changeDemandingModel } = useProviderSettingsContext();
  const isDemanding = modelId === demandingModelId;
  return (
    <button
      type="button"
      className="icon-button small demanding-toggle"
      aria-pressed={isDemanding}
      aria-label={t(isDemanding ? "models.isDemandingLabel" : "models.useAsDemandingLabel", { name })}
      title={isDemanding ? t("models.demandingTitle") : t("models.useAsDemanding")}
      onClick={() => changeDemandingModel(isDemanding ? null : modelId)}
    >
      <Zap size={17} strokeWidth={2} fill={isDemanding ? "currentColor" : "none"} />
    </button>
  );
}
