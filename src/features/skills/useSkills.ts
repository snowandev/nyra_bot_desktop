import { useCallback, useEffect, useMemo, useState } from "react";
import { errorMessage } from "@/shared/lib/errors";
import { type Skill } from "./skills";
import { listSkills } from "./skillStorage";
import {
  loadDefaultCodeSkills,
  loadDefaultSkills,
  saveDefaultCodeSkills,
  saveDefaultSkills,
} from "@/shared/storage/settings";

// The installed skills, shared by Settings (to manage them) and the chat (to activate them)
export function useSkills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Marked in every new conversation; a name whose skill was deleted is simply never found
  const chat = useDefaultSkillList(loadDefaultSkills, saveDefaultSkills);
  // Marked instead in every new conversation of a code project
  const code = useDefaultSkillList(loadDefaultCodeSkills, saveDefaultCodeSkills);

  const reload = useCallback(async () => {
    try {
      const list = await listSkills();
      setSkills(list.skills);
      setError(list.installError);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    listSkills()
      .then((list) => {
        if (cancelled) return;
        setSkills(list.skills);
        setError(list.installError);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { rename: renameChatDefault } = chat;
  const { rename: renameCodeDefault } = code;
  // A renamed skill keeps being a default under its new name
  const renameDefaultSkill = useCallback(
    (from: string, to: string) => {
      renameChatDefault(from, to);
      renameCodeDefault(from, to);
    },
    [renameChatDefault, renameCodeDefault],
  );

  // Shared through a context and read inside the memoized chat messages: a new object only when something changed
  return useMemo(
    () => ({
      skills,
      error,
      reload,
      defaultSkillNames: chat.names,
      setDefaultSkill: chat.set,
      defaultCodeSkillNames: code.names,
      setDefaultCodeSkill: code.set,
      renameDefaultSkill,
    }),
    [skills, error, reload, chat.names, chat.set, code.names, code.set, renameDefaultSkill],
  );
}

function useDefaultSkillList(load: () => string[], save: (names: string[]) => void) {
  const [names, setNames] = useState(load);

  const set = useCallback(
    (name: string, isDefault: boolean) => {
      const next = isDefault ? [...names.filter((n) => n !== name), name] : names.filter((n) => n !== name);
      setNames(next);
      save(next);
    },
    [names, save],
  );

  const rename = useCallback(
    (from: string, to: string) => {
      if (!names.includes(from)) return;
      const next = names.map((n) => (n === from ? to : n));
      setNames(next);
      save(next);
    },
    [names, save],
  );

  return { names, set, rename };
}
