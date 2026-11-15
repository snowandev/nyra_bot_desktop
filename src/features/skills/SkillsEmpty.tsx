import { Import, Plus, Sparkles } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

type Props = {
  onNew: () => void;
  onImport: () => void;
};

export function SkillsEmpty({ onNew, onImport }: Props) {
  const { t } = useTranslation();
  return (
    <section className="skills-empty" aria-label={t("skills.empty.label")}>
      <div className="skills-empty-mark" aria-hidden="true">
        <Sparkles size={30} strokeWidth={1.6} />
      </div>
      <h3>{t("skills.empty.title")}</h3>
      <p>{t("skills.empty.text")}</p>
      <div className="skill-actions">
        <button type="button" className="primary-button padded" onClick={onNew}>
          <Plus size={15} strokeWidth={2.2} />
          {t("skills.new")}
        </button>
        <button type="button" className="outline-button" onClick={onImport}>
          <Import size={15} strokeWidth={2} />
          {t("skills.import")}
        </button>
      </div>
      <small>
        <Trans i18nKey="skills.empty.hint" components={{ code: <span className="mono" /> }} />
      </small>
    </section>
  );
}
