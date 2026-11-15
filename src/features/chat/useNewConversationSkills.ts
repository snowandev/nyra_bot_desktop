import { useState } from "react";
import { useSkillsContext } from "@/features/skills/skillsContext";
import { useInvokedSkill } from "@/features/skills/useInvokedSkill";

// The skills of a conversation that doesn't exist yet: chosen before the first message, they become its skills.
// Until the user changes them, the defaults from Settings, so changing a default while the screen is open shows at once.
// defaults replaces Settings' (a project's home starts with the project's skills).
export function useNewConversationSkills(defaults?: string[]) {
  const { skills, defaultSkillNames } = useSkillsContext();
  const [chosenSkills, setChosenSkills] = useState<string[] | null>(null);
  const skillNames =
    chosenSkills ?? (defaults ?? defaultSkillNames).filter((name) => skills.some((s) => s.name === name));
  const [isSkillPickerOpen, setIsSkillPickerOpen] = useState(false);
  const invokedSkill = useInvokedSkill(skillNames, setChosenSkills);
  return { skills, skillNames, setChosenSkills, isSkillPickerOpen, setIsSkillPickerOpen, invokedSkill };
}
