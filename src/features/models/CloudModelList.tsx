import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Model } from "@/shared/types";
import { ModelCapabilityIcons } from "./ModelCapabilityIcons";
import { ModelVisibilityButton } from "./ModelVisibilityButton";
import { DemandingModelButton } from "./DemandingModelButton";
import { DemandingModelPill } from "./DemandingModelPill";

type Props = {
  models: Model[];
  defaultModelId: string | null;
  onDefaultModelChange: (id: string | null) => void;
};

export function CloudModelList({ models, defaultModelId, onDefaultModelChange }: Props) {
  const { t } = useTranslation();
  if (models.length === 0) return null;

  return (
    <section className="model-section" aria-labelledby="cloud-models-title">
      <div className="model-section-header">
        <h4 id="cloud-models-title">{t("models.available")}</h4>
        <span className="model-section-total">{t("common.models", { count: models.length })}</span>
      </div>
      <ul className="installed-models">
        {models.map((model) => {
          const isDefault = model.id === defaultModelId;
          return (
            <li key={model.id} className="installed-model">
              <div className="installed-model-text">
                <div className="installed-model-line">
                  <span className="installed-model-name">{model.name}</span>
                  {isDefault && (
                    <span className="model-pill default">
                      <Star size={11} strokeWidth={2.2} fill="currentColor" />
                      {t("models.default")}
                    </span>
                  )}
                  <DemandingModelPill modelId={model.id} />
                </div>
                <div className="installed-model-meta">
                  <span className="mono">{model.id}</span>
                  {model.contextWindow && (
                    <span>
                      <i aria-hidden="true" />
                      {t("models.contextTokens", { tokens: model.contextWindow })}
                    </span>
                  )}
                  <ModelCapabilityIcons
                    readsImages={model.supportsImages}
                    readsFiles={model.readsFiles}
                    thinks={model.thinks}
                  />
                </div>
              </div>
              <div className="installed-model-actions">
                <ModelVisibilityButton modelId={model.id} modelName={model.name} />
                <button
                  type="button"
                  className="icon-button small default-star"
                  aria-pressed={isDefault}
                  aria-label={t(isDefault ? "models.isDefaultLabel" : "models.useAsDefaultLabel", { name: model.name })}
                  title={isDefault ? t("models.defaultTitle") : t("models.useAsDefault")}
                  onClick={() => onDefaultModelChange(isDefault ? null : model.id)}
                >
                  <Star size={17} strokeWidth={2} fill={isDefault ? "currentColor" : "none"} />
                </button>
                <DemandingModelButton modelId={model.id} name={model.name} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
