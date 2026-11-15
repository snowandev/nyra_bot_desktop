import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useProviderSettingsContext } from "./providerSettingsContext";

type Props = {
  modelId: string;
  modelName: string;
};

// Hiding only tidies the chat's model menu; the model keeps working everywhere else
export function ModelVisibilityButton({ modelId, modelName }: Props) {
  const { hiddenModelIds, toggleModelHidden } = useProviderSettingsContext();
  const isHidden = hiddenModelIds.includes(modelId);
  const { t } = useTranslation();

  return (
    <button
      type="button"
      className="icon-button small model-visibility"
      aria-pressed={isHidden}
      aria-label={t(isHidden ? "models.visibility.showLabel" : "models.visibility.hideLabel", { name: modelName })}
      title={isHidden ? t("models.visibility.hiddenTitle") : t("models.visibility.hideTitle")}
      onClick={() => toggleModelHidden(modelId)}
    >
      {isHidden ? <EyeOff size={17} strokeWidth={2} /> : <Eye size={17} strokeWidth={2} />}
    </button>
  );
}
