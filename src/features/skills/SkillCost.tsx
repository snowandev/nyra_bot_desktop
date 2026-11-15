import { Trans, useTranslation } from "react-i18next";
import { useProviderSettingsContext } from "@/features/models/providerSettingsContext";
import { useContextLimit } from "@/features/chat/reply/useContextLimit";
import { formatNumber, formatShare } from "@/shared/lib/format";
import { HEAVY_SKILLS_SHARE } from "./skills";
import { SkillTokens } from "./SkillTokens";

type Props = {
  tokens: number;
};

// Compared with a model, because 3,000 tokens weigh very differently in 8,192 than in 128,000: the default one,
// which new conversations start with, or else the one selected in the chat
export function SkillCost({ tokens }: Props) {
  const { models, defaultModelId, selectedModel } = useProviderSettingsContext();
  const { t } = useTranslation();
  const model = models.find((m) => m.id === defaultModelId) ?? selectedModel;
  const limit = useContextLimit(model)?.limit ?? model?.contextWindow;
  const share = limit ? tokens / limit : null;
  const percent = share === null ? "" : formatShare(share);

  return (
    <div className="skill-section">
      <h4>{t("skills.cost.title")}</h4>
      <div className="skill-cost">
        <div className="skill-cost-line">
          <SkillTokens tokens={tokens} />
          {model && limit && (
            <span className="skill-cost-share">
              <Trans
                i18nKey="skills.cost.share"
                values={{ percent, model: model.name, limit: formatNumber(limit) }}
                components={{ model: <span className="mono" /> }}
              />
              {model.id === defaultModelId && t("skills.cost.yourDefault")}
            </span>
          )}
        </div>
        {share !== null && (
          <div className="skill-meter" role="img" aria-label={t("skills.cost.meter", { percent })}>
            <span
              className={share >= HEAVY_SKILLS_SHARE ? "heavy" : undefined}
              style={{ width: `${Math.min(100, Math.max(2, share * 100))}%` }}
            />
          </div>
        )}
        <span className="field-hint">
          {t("skills.cost.hint")}
        </span>
      </div>
    </div>
  );
}
