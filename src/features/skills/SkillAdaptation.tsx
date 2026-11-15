import { LoaderCircle, WandSparkles } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { useSkillAdaptation } from "./useSkillAdaptation";
import { formatNumber } from "@/shared/lib/format";
import type { Skill } from "./skills";
import { ErrorNotice } from "@/shared/ui/ErrorNotice";
import { SkillAdaptationReview } from "./SkillAdaptationReview";

type Props = {
  skill: Skill;
  // "2 of 3" when several imported skills are adapted one after another
  position?: string;
  onSaved: () => void;
  onSkip: () => void;
  onCancel: () => void;
};

export function SkillAdaptation({ skill, position, onSaved, onSkip, onCancel }: Props) {
  const { state, modelName, retry } = useSkillAdaptation(skill);
  const { t } = useTranslation();

  return (
    <section className="skill-pane adaptation" aria-label={t("skills.adapt.label")}>
      <div className="skill-pane-header">
        <div className="skill-pane-title">
          <WandSparkles size={18} strokeWidth={2} className="accent" />
          <h3>
            <Trans
              i18nKey="skills.adapt.title"
              values={{ name: skill.name }}
              components={{ name: <span className="mono" /> }}
            />
          </h3>
          {position && <span className="skill-pill">{position}</span>}
        </div>
        <p>
          {modelName ? (
            <Trans
              i18nKey="skills.adapt.introWithModel"
              values={{ model: modelName }}
              components={{ model: <strong /> }}
            />
          ) : (
            t("skills.adapt.intro")
          )}
        </p>
      </div>

      {state.status === "running" && (
        <>
          <div role="status" className="import-loading">
            <LoaderCircle size={17} strokeWidth={2.4} className="spin info" />
            {state.received === 0
              ? t("skills.adapt.waiting")
              : t("skills.adapt.writing", { chars: formatNumber(state.received) })}
          </div>
          <div className="skill-form-footer">
            <button type="button" className="ghost-button" onClick={onCancel}>
              {t("common.cancel")}
            </button>
          </div>
        </>
      )}

      {state.status === "error" && (
        <>
          <ErrorNotice title={state.message} />
          <div className="skill-form-footer">
            <button type="button" className="ghost-button" onClick={onCancel}>
              {t("skills.adapt.back")}
            </button>
            {position && (
              <button type="button" className="outline-button" onClick={onSkip}>
                {t("skills.adapt.skip")}
              </button>
            )}
            <button type="button" className="primary-button padded" onClick={retry}>
              {t("common.retry")}
            </button>
          </div>
        </>
      )}

      {state.status === "done" && (
        <SkillAdaptationReview
          key={state.result.body}
          skill={skill}
          result={state.result}
          canSkip={!!position}
          onSaved={onSaved}
          onDiscard={position ? onSkip : onCancel}
          onRetry={retry}
        />
      )}
    </section>
  );
}
