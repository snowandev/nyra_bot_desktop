import { Import, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Skill } from "./skills";
import { SkillCard } from "./SkillCard";

type Props = {
  skills: Skill[];
  selectedName: string | null;
  onSelect: (name: string) => void;
  onNew: () => void;
  onImport: () => void;
};

export function SkillList({ skills, selectedName, onSelect, onNew, onImport }: Props) {
  const { t } = useTranslation();
  return (
    <section className="skill-list" aria-label={t("skills.list.label")}>
      <div className="skill-list-header">
        <h3>
          {t("skills.list.title")} <span className="pill">{skills.length}</span>
        </h3>
        <div className="skill-list-actions">
          <button type="button" className="primary-button padded" onClick={onNew}>
            <Plus size={15} strokeWidth={2.2} />
            {t("skills.new")}
          </button>
          <button type="button" className="outline-button" onClick={onImport}>
            <Import size={15} strokeWidth={2} />
            {t("skills.import")}
          </button>
        </div>
      </div>
      <ul className="skill-cards">
        {skills.map((skill) => (
          <li key={skill.name}>
            <SkillCard skill={skill} isSelected={skill.name === selectedName} onSelect={() => onSelect(skill.name)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
