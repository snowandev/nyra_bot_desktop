import { type KeyboardEvent, type RefObject, useId, useMemo, useState } from "react";
import { optionId } from "@/features/skills/useSkillCommand";
import { matchFiles, mentionAt, withMention } from "./mentions";

type Options = {
  text: string;
  onTextChange: (text: string) => void;
  // The connected folder's files; null without a folder or while it is read, and then "@" is just text
  files: string[] | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

// The "@" list of the composer: the folder's files that fit what is typed after it, which one is active, the keys
// that move through it and the ARIA the textarea needs as a combobox. The cursor, not only the text, says whether an
// "@…" is being written, since it can be anywhere in the message.
export function useFileMention({ text, onTextChange, files, textareaRef }: Options) {
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  // Escape leaves that "@…" as plain text (an e-mail address, a handle) until another one is written
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const mention = files ? mentionAt(text, caret) : null;
  const isOpen = !!mention && mention.start !== dismissedAt;
  const query = mention?.query ?? "";
  const matches = useMemo(() => (isOpen && files ? matchFiles(files, query) : []), [isOpen, files, query]);
  const activeOption = Math.min(activeIndex, Math.max(matches.length - 1, 0));
  const pointsAtList = isOpen && matches.length > 0;

  // Called on every change of text or cursor
  function track(textarea: HTMLTextAreaElement) {
    setCaret(textarea.selectionStart);
    setActiveIndex(0);
  }

  function pick(path: string) {
    if (!mention) return;
    const next = withMention(text, mention.start, caret, path);
    onTextChange(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(next.caret, next.caret);
    });
  }

  // True when the key was for the list and shouldn't do anything else
  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!isOpen || !mention) return false;
    if (pointsAtList && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((activeOption + step + matches.length) % matches.length);
      return true;
    }
    if (pointsAtList && (e.key === "Enter" || e.key === "Tab")) {
      pick(matches[activeOption]);
      return true;
    }
    if (e.key === "Escape") {
      setDismissedAt(mention.start);
      return true;
    }
    return false;
  }

  return {
    listId,
    isOpen,
    query,
    matches,
    activeOption,
    setActiveIndex,
    track,
    pick,
    handleKey,
    comboboxProps: {
      role: "combobox",
      "aria-autocomplete": "list",
      "aria-expanded": isOpen,
      "aria-controls": pointsAtList ? listId : undefined,
      "aria-activedescendant": pointsAtList ? optionId(listId, activeOption) : undefined,
    } as const,
  };
}

export type FileMention = ReturnType<typeof useFileMention>;
