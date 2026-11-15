import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scrollToMessage, whenMessageRendered } from "./messageScroll";
import { clearSearchHighlights, highlightMatches, messagesMatching } from "@/shared/lib/search";
import type { Message } from "@/shared/types";
import { SHORTCUTS } from "@/shared/lib/shortcuts";
import { useShortcut } from "@/shared/hooks/useShortcut";

const CURRENT_ATTRIBUTE = "data-search-current";
// Marking walks every text on screen: while a reply streams or the user types, at most this often
const HIGHLIGHT_EVERY_MS = 150;
// Finds text across the whole conversation and walks through the messages that contain it, newest first
export function useChatSearch(
  messages: Message[],
  containerRef: RefObject<HTMLElement | null>,
  // Renders older messages up to this index, since the chat only draws the latest ones
  showFrom: (index: number) => void,
  // The shortcut is ignored while another screen covers the chat
  shortcutEnabled: boolean,
) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Position in the list of matches; null means "the target, or else the newest one"
  const [position, setPosition] = useState<number | null>(null);
  // Message to start at, chosen by a search across all conversations
  const [target, setTarget] = useState<number | null>(null);

  const matches = useMemo(() => (isOpen ? messagesMatching(messages, query) : []), [isOpen, messages, query]);
  const targetPosition = target === null ? -1 : matches.indexOf(target);
  const index =
    matches.length === 0
      ? null
      : position !== null
        ? Math.min(position, matches.length - 1)
        : targetPosition !== -1
          ? targetPosition
          : matches.length - 1;
  // The target can match only in a file attached to it, or with its words apart; it is still where to go
  const isAtTarget = position === null && target !== null && targetPosition === -1;
  const currentMessage = isAtTarget ? target : index === null ? null : matches[index];

  const open = useCallback(() => setIsOpen(true), []);

  const openAt = useCallback((text: string, messageIndex: number) => {
    setIsOpen(true);
    setQuery(text);
    setPosition(null);
    setTarget(messageIndex);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setPosition(null);
    setTarget(null);
    clearSearchHighlights();
    containerRef.current?.querySelector(`[${CURRENT_ATTRIBUTE}]`)?.removeAttribute(CURRENT_ATTRIBUTE);
  }, [containerRef]);

  function changeQuery(text: string) {
    setQuery(text);
    setPosition(null);
    setTarget(null);
  }

  function move(step: 1 | -1) {
    if (index === null) return;
    setPosition((index + step + matches.length) % matches.length);
  }

  useShortcut(SHORTCUTS.searchConversation, open, { enabled: shortcutEnabled });

  useEffect(() => {
    if (currentMessage === null) return;
    showFrom(currentMessage);
    // The message may only be drawn in the next frames, and the auto-scroll runs first
    return whenMessageRendered(
      () => containerRef.current,
      currentMessage,
      (container, element) => {
        container.querySelector(`[${CURRENT_ATTRIBUTE}]`)?.removeAttribute(CURRENT_ATTRIBUTE);
        element.setAttribute(CURRENT_ATTRIBUTE, "");
        scrollToMessage(container, element);
      },
    );
  }, [currentMessage, showFrom, containerRef]);

  // After renders while open, streaming text and newly loaded messages need marking too: once per pause, with the
  // query and the screen as they are by then
  const latest = useRef({ isOpen, query });
  const highlightTimer = useRef(0);
  useEffect(() => {
    latest.current = { isOpen, query };
    if (!isOpen || highlightTimer.current) return;
    highlightTimer.current = window.setTimeout(() => {
      highlightTimer.current = 0;
      if (latest.current.isOpen) highlightMatches(containerRef.current, latest.current.query);
    }, HIGHLIGHT_EVERY_MS);
  });
  useEffect(() => () => window.clearTimeout(highlightTimer.current), []);

  return {
    isOpen,
    query,
    changeQuery,
    open,
    openAt,
    close,
    older: () => move(-1),
    newer: () => move(1),
    matchCount: matches.length,
    currentNumber: index === null ? 0 : index + 1,
  };
}
