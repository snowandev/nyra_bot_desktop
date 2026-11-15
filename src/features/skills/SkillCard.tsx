import { CodeXml, Sparkles, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSkillsContext } from "./skillsContext";
import { type Skill, skillTokens } from "./skills";
import { SkillSourcePill } from "./SkillSourcePill";
import { SkillTokens } from "./SkillTokens";

type Props = {
  skill: Skill;
  isSelected: boolean;
  onSelect: () => void;
};

export function SkillCard({ skill, isSelected, onSelect }: Props) {
  const { defaultSkillNames, defaultCodeSkillNames } = useSkillsContext();
  const { t } = useTranslation();
  return (
    <button type="button" className="skill-card" aria-current={isSelected} onClick={onSelect}>
      <span className="skill-card-icon">
        <Sparkles size={17} strokeWidth={2} />
      </span>
      <span className="skill-card-text">
        <span className="mono skill-card-name">{skill.name}</span>
        <span className="skill-card-description">{skill.description}</span>
        <span className="skill-card-meta">
          <SkillSourcePill source={skill.source} />
          {defaultSkillNames.includes(skill.name) && (
            <span className="skill-pill accent" title={t("skills.card.defaultTitle")}>
              <Star size={11} strokeWidth={2.2} fill="currentColor" />
              {t("skills.card.default")}
            </span>
          )}
          {defaultCodeSkillNames.includes(skill.name) && (
            <span className="skill-pill accent" title={t("skills.card.codeTitle")}>
              <CodeXml size={11} strokeWidth={2.2} />
              {t("skills.card.code")}
            </span>
          )}
          <SkillTokens tokens={skillTokens(skill)} />
        </span>
      </span>
    </button>
  );
}
