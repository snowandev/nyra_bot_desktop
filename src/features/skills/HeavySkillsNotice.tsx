import { TriangleAlert } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { formatNumber, formatShare } from "@/shared/lib/format";

type Props = {
  tokens: number;
  contextLimit: number;
  modelName: string;
  onShowSkills: () => void;
};

export function HeavySkillsNotice({ tokens, contextLimit, modelName, onShowSkills }: Props) {
  const { t } = useTranslation();
  const percent = formatShare(tokens / contextLimit);
  return (
    <div role="status" className="heavy-skills-notice">
      <TriangleAlert size={16} strokeWidth={2} />
      <div>
        <strong>
          <Trans
            i18nKey="skills.heavy.title"
            values={{ tokens: formatNumber(tokens), percent, model: modelName }}
            components={{ model: <span className="mono" /> }}
          />
        </strong>{" "}
        {t("skills.heavy.body")}
        <div className="notice-actions">
          <button type="button" className="link-button" onClick={onShowSkills}>
            {t("skills.heavy.show")}
          </button>
        </div>
      </div>
    </div>
  );
}
