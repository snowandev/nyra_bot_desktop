import { X } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useSkillsContext } from "@/features/skills/skillsContext";
import { Dialog } from "@/shared/ui/Dialog";
import { Switch } from "@/shared/ui/Switch";
import { CODE_SKILLS } from "./codeSkills";
import type { Project } from "./projectStorage";

type Props = {
  project: Project;
  // Whether the project's folder is a Git repository, which "Commit y descripción de PR" needs
  hasGit: boolean;
  onChange: (disabled: string[]) => void;
  onClose: () => void;
};

// The Código skills turned on or off for one project. An off skill leaves the home's tasks and the skills its new
// conversations start with; the user's own skills are added as in the chat.
export function ProjectSkillsDialog({ project, hasGit, onChange, onClose }: Props) {
  const { skills } = useSkillsContext();
  const { t } = useTranslation();
  const titleId = useId();
  const installed = CODE_SKILLS.filter((s) => skills.some((skill) => skill.name === s.name));


  function toggle(name: string, on: boolean) {
    const others = project.disabledSkills.filter((n) => n !== name);
    onChange(on ? others : [...others, name]);
  }

  return (
    <Dialog onClose={onClose} labelledBy={titleId} className="project-skills">
      <div className="project-skills-head">
        <h2 id={titleId}>
          <span className="project-skills-diamond" aria-hidden="true">
            ✦
          </span>
          {t("projects.skillsDialog.title", { name: project.name })}
        </h2>
        <button type="button" className="icon-button small" aria-label={t("projects.skillsDialog.close")} onClick={onClose}>
          <X size={16} strokeWidth={2} />
        </button>
      </div>
      <p className="project-skills-intro">{t("projects.skillsDialog.intro")}</p>
      <ul className="project-skills-list">
        {installed.map((s) => {
          const on = !project.disabledSkills.includes(s.name);
          return (
            <li key={s.name}>
              <s.icon size={17} strokeWidth={1.8} aria-hidden="true" />
              <div className="project-skills-text">
                <span className="project-skills-name">
                  {s.title}
                  <span className="project-skills-tag">{t("projects.skillsDialog.included")}</span>
                </span>
                <span className="project-skills-description">
                  {s.description}
                  {s.needsGit && !hasGit && ` ${t("projects.skillsDialog.needsGit")}`}
                </span>
              </div>
              <Switch checked={on} onChange={(checked) => toggle(s.name, checked)} label={s.title} />
            </li>
          );
        })}
      </ul>
      <p className="project-skills-note">{t("projects.skillsDialog.note")}</p>
    </Dialog>
  );
}
