import { Star, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useProviderSettingsContext } from "@/features/models/providerSettingsContext";
import { Switch } from "@/shared/ui/Switch";

// Under the providers: what the star and the bolt of each model mean, and whether a move to a cloud waits for the user
export function ModelRolesSettings() {
  const { t } = useTranslation();
  const settings = useProviderSettingsContext();
  return (
    <div className="model-roles">
      <div className="section-label">{t("settings.models.title")}</div>
      <p>
        <Star size={12} strokeWidth={2.2} className="accent" aria-hidden="true" /> {t("settings.models.mainHint")}
      </p>
      <p>
        <Zap size={12} strokeWidth={2.2} className="highlight" aria-hidden="true" /> {t("settings.models.demandingHint")}
      </p>
      {settings.demandingModelId && (
        <div className="model-roles-switch">
          <span>
            {t("settings.models.askBeforeCloud")}
            <small>{t("settings.models.askBeforeCloudHint")}</small>
          </span>
          <Switch
            checked={settings.askBeforeCloud}
            onChange={settings.changeAskBeforeCloud}
            label={t("settings.models.askBeforeCloud")}
          />
        </div>
      )}
    </div>
  );
}
