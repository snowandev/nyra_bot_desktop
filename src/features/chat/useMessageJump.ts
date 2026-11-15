import { type RefObject, useCallback, useEffect, useRef } from "react";
import { scrollToMessage, whenMessageRendered } from "./messageScroll";

const ATTRIBUTE = "data-jump-target";
// Long enough to spot the message after the scroll, short enough not to linger
const HIGHLIGHT_MS = 2000;

// Takes the chat to one message and highlights it for a moment, e.g. the one a file was sent with
export function useMessageJump(
  containerRef: RefObject<HTMLElement | null>,
  // Renders older messages up to this index, since the chat only draws the latest ones
  showFrom: (index: number) => void,
) {
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return useCallback(
    (index: number) => {
      showFrom(index);
      whenMessageRendered(() => containerRef.current, index, (container, element) => {
        container.querySelector(`[${ATTRIBUTE}]`)?.removeAttribute(ATTRIBUTE);
        element.setAttribute(ATTRIBUTE, "");
        scrollToMessage(container, element);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => element.removeAttribute(ATTRIBUTE), HIGHLIGHT_MS);
      });
    },
    [containerRef, showFrom],
  );
}
