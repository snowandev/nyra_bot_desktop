import { useState } from "react";
import type { Skill } from "@/features/skills/skills";
import { useInvokedSkill } from "@/features/skills/useInvokedSkill";
import type { Conversation } from "@/shared/types";

type Options = {
  skills: Skill[];
  defaultSkillNames: string[];
  // The bar's open conversation, or null before its first message
  active: Conversation | null;
  setConversationSkills: (names: string[]) => void;
};

// The skills of the bar's conversation, as in the main window: an open one keeps its own, a new one starts with the
// defaults from Settings. "/" chooses one for the next message.
export function useQuickSkills({ skills, defaultSkillNames, active, setConversationSkills }: Options) {
  // Chosen before the first message; they become the new conversation's skills
  const [chosen, setChosen] = useState<string[] | null>(null);
  const installed = (names: string[]) => names.filter((name) => skills.some((s) => s.name === name));
  const skillNames = active ? (active.skills ?? []) : installed(chosen ?? defaultSkillNames);
  const change = (names: string[]) => (active ? setConversationSkills(names) : setChosen(names));
  const invokedSkill = useInvokedSkill(skillNames, change);

  // A new conversation goes back to the defaults
  function reset() {
    setChosen(null);
    invokedSkill.clear();
  }

  return { skillNames, invokedSkill, reset };
}
