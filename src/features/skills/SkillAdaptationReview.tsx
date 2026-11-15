import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { errorMessage } from "@/shared/lib/errors";
import { formatNumber } from "@/shared/lib/format";
import { joinedList } from "@/features/chat/listFormat";
import { type Adaptation, productMentions } from "./adaptation";
import { DESCRIPTION_MAX, type Skill } from "./skills";
import { saveAdaptedSkill } from "./skillStorage";
import { ErrorNotice } from "@/shared/ui/ErrorNotice";
import { LoadingButton } from "@/shared/ui/LoadingButton";
import { SkillInfoNotice } from "./SkillInfoNotice";

type Props = {
  skill: Skill;
  result: Adaptation;
  canSkip: boolean;
  onSaved: () => void;
  onDiscard: () => void;
  onRetry: () => void;
};

// The adapted text can be touched up before saving, e.g. to remove a product name the model left behind
export function SkillAdaptationReview({ skill, result, canSkip, onSaved, onDiscard, onRetry }: Props) {
  const { t } = useTranslation();
  const [description, setDescription] = useState(result.description);
  const [body, setBody] = useState(result.body);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mentions = productMentions({ description, body });
  const isValid = description.trim().length > 0 && description.length <= DESCRIPTION_MAX && body.trim().length > 0;

  async function save() {
    setIsSaving(true);
    setError(null);
    try {
      await saveAdaptedSkill(skill.name, description, body);
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
      setIsSaving(false);
    }
  }

  return (
    <>
      {mentions.length > 0 && (
        <SkillInfoNotice icon={<TriangleAlert size={16} strokeWidth={2} />}>
          <Trans
            i18nKey="skills.adapt.stillMentions"
            values={{ products: joinedList(mentions) }}
            components={{ strong: <strong /> }}
          />
        </SkillInfoNotice>
      )}

      <div className="adaptation-compare">
        <div className="adaptation-column">
          <h4>{t("skills.adapt.original")}</h4>
          <span className="adaptation-label">{t("skills.adapt.description")}</span>
          <p className="adaptation-box description readonly">{skill.description}</p>
          <span className="adaptation-label">{t("skills.adapt.instructions")}</span>
          <pre className="adaptation-box body readonly">{skill.body.trim()}</pre>
        </div>
        <div className="adaptation-column">
          <h4>{t("skills.adapt.adapted")}</h4>
          <label className="adaptation-label" htmlFor="adapted-description">
            {t("skills.adapt.description")}
            <span className="field-counter">
              {formatNumber(description.length)} / {formatNumber(DESCRIPTION_MAX)}
            </span>
          </label>
          <textarea
            id="adapted-description"
            className="text-input adaptation-box description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <label className="adaptation-label" htmlFor="adapted-body">
            {t("skills.adapt.instructions")}
          </label>
          <textarea
            id="adapted-body"
            className="text-input adaptation-box body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
      </div>

      {error && <ErrorNotice title={error} />}

      <div className="skill-form-footer">
        <button type="button" className="ghost-button" onClick={onDiscard}>
          {canSkip ? t("skills.adapt.discardAndContinue") : t("skills.adapt.discard")}
        </button>
        <button type="button" className="outline-button" disabled={isSaving} onClick={onRetry}>
          {t("skills.adapt.regenerate")}
        </button>
        {isSaving ? (
          <LoadingButton>{t("skills.adapt.saving")}</LoadingButton>
        ) : (
          <button type="button" className="primary-button padded" disabled={!isValid} onClick={save}>
            {t("skills.adapt.save")}
          </button>
        )}
      </div>
    </>
  );
}
