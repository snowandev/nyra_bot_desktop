import { Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useProviderSettingsContext } from "./providerSettingsContext";

type Props = {
  modelId: string;
};

// The label of the model for demanding tasks in the lists of models
export function DemandingModelPill({ modelId }: Props) {
  const { t } = useTranslation();
  if (modelId !== useProviderSettingsContext().demandingModelId) return null;
  return (
    <span className="model-pill demanding">
      <Zap size={11} strokeWidth={2.2} fill="currentColor" />
      {t("models.demanding")}
    </span>
  );
}
