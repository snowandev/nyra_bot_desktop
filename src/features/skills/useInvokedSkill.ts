import { useState } from "react";

// The skill chosen by hand for the next message ("/" in the composer or a welcome card), shown as a pill. Choosing
// one that wasn't marked in the conversation marks it, and removing the pill before sending takes that back.
export function useInvokedSkill(skillNames: string[], onChangeSkills: (names: string[]) => void) {
  const [skill, setSkill] = useState<string | null>(null);
  // Marked only because it was chosen here, so it can be unmarked if the pill goes
  const [autoMarked, setAutoMarked] = useState<string | null>(null);

  function invoke(name: string) {
    // Another pill replaces this one; the earlier one's automatic mark goes with it
    const kept = autoMarked && autoMarked !== name ? skillNames.filter((n) => n !== autoMarked) : skillNames;
    const isMarked = kept.includes(name);
    const names = isMarked ? kept : [...kept, name];
    if (names !== skillNames) onChangeSkills(names);
    if (autoMarked !== name) setAutoMarked(isMarked ? null : name);
    setSkill(name);
  }

  function remove() {
    if (autoMarked) onChangeSkills(skillNames.filter((n) => n !== autoMarked));
    setAutoMarked(null);
    setSkill(null);
  }

  // Once sent, the skill stays marked in the conversation
  function clear() {
    setAutoMarked(null);
    setSkill(null);
  }

  return { skill, isAutoMarked: !!skill && autoMarked === skill, invoke, remove, clear };
}

export type InvokedSkill = ReturnType<typeof useInvokedSkill>;
