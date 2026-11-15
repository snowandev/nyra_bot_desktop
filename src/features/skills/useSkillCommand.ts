import { type KeyboardEvent, useId, useState } from "react";
import { type ComposerCommand, matchCommands, modelQueryOf, takesArgument } from "@/features/chat/reply/commands";
import { matchesQuery } from "@/features/models/modelGroups";
import type { Model } from "@/shared/types";
import { matchSkills, type Skill } from "./skills";
import type { InvokedSkill } from "./useInvokedSkill";

// The id of an option of the list, which the textarea points at as its active descendant
export const optionId = (listId: string, index: number) => `${listId}-${index}`;

export type SlashOption =
  | { kind: "command"; command: ComposerCommand }
  | { kind: "skill"; skill: Skill }
  | { kind: "model"; model: Model };

type Options = {
  text: string;
  onTextChange: (text: string) => void;
  skills: Skill[];
  // Only where a command makes sense: none on the welcome screen
  commands: ComposerCommand[];
  invokedSkill: InvokedSkill;
  // What /model offers: the selector's models, without the hidden ones
  models: Model[];
  onSelectModel: (id: string) => void;
};

// The "/" list of the composer: the app's commands and the skills that match what was typed, or the models after
// /model; which one is active, the keys that move through it, and the ARIA a combobox needs on the textarea
export function useSkillCommand({ text, onTextChange, skills, commands, invokedSkill, models, onSelectModel }: Options) {
  const listId = useId();
  // Escape leaves "/…" as plain text (a path like /etc/hosts) until the text no longer starts with "/"
  const [isDismissed, setIsDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  // "/model …" keeps the list open past the space, now with the models
  const modelQuery = modelQueryOf(text);
  const isPickingModel = modelQuery !== null;
  // Only a "/" at the very start, before any space, opens the list; one in the middle of a sentence is text
  const query = !isPickingModel && text.startsWith("/") && !/\s/.test(text) ? text.slice(1) : null;
  const isOpen = (query !== null || isPickingModel) && !isDismissed;
  const matches: SlashOption[] = !isOpen
    ? []
    : isPickingModel
      ? models.filter((model) => matchesQuery(model, modelQuery)).map((model) => ({ kind: "model" as const, model }))
      : [
          ...matchCommands(commands, query ?? "").map((command) => ({ kind: "command" as const, command })),
          ...matchSkills(skills, query ?? "").map((skill) => ({ kind: "skill" as const, skill })),
        ];
  const activeOption = Math.min(activeIndex, Math.max(matches.length - 1, 0));
  const pointsAtList = isOpen && matches.length > 0;

  function changeText(next: string) {
    onTextChange(next);
    setActiveIndex(0);
    if (!next.startsWith("/")) setIsDismissed(false);
  }

  function pick(option: SlashOption) {
    if (option.kind === "model") {
      changeText("");
      onSelectModel(option.model.id);
      return;
    }
    if (option.kind === "command") {
      if (option.command.unavailable) return;
      if (takesArgument(option.command.name)) {
        changeText(`/${option.command.name} `);
        return;
      }
      changeText("");
      option.command.run?.();
      return;
    }
    changeText(text.replace(/^\/\S*\s?/, ""));
    invokedSkill.invoke(option.skill.name);
  }

  // Keys for the list and the pill; true when the key was handled and shouldn't do anything else
  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (pointsAtList) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((activeOption + step + matches.length) % matches.length);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        pick(matches[activeOption]);
        return true;
      }
    }
    // "/model" with nothing that matches: Enter must not send it as a message
    if (isOpen && isPickingModel && e.key === "Enter") return true;
    if (isOpen && e.key === "Escape") {
      setIsDismissed(true);
      return true;
    }
    const atStart = e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0;
    if (e.key === "Backspace" && invokedSkill.skill && atStart && text === "") {
      invokedSkill.remove();
      return true;
    }
    return false;
  }

  return {
    listId,
    isOpen,
    isPickingModel: isOpen && isPickingModel,
    query: modelQuery ?? query ?? "",
    matches,
    activeOption,
    setActiveIndex,
    changeText,
    pick,
    handleKey,
    // The focus stays in the textarea while the user moves through the list, as in a combobox
    comboboxProps: {
      role: "combobox",
      "aria-autocomplete": "list",
      "aria-expanded": isOpen,
      "aria-controls": pointsAtList ? listId : undefined,
      "aria-activedescendant": pointsAtList ? optionId(listId, activeOption) : undefined,
    } as const,
  };
}
