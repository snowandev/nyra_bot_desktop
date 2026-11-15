import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react";

// Rendering hundreds of markdown messages at once freezes the window, so only the latest ones are drawn
const PAGE_SIZE = 30;
// Load the previous page a bit before the top is reached, so scrolling up doesn't stall
const LOAD_THRESHOLD = 600;

// Returns the index of the first message to render; earlier ones load as the user scrolls up
export function useMessageWindow(total: number, containerRef: RefObject<HTMLElement | null>) {
  const [start, setStart] = useState<number | null>(null);
  // Distance from the bottom before older messages are added, to keep the same message in view
  const anchor = useRef<number | null>(null);

  // Messages load after the chat opens, so the window is set once they arrive. Adjusting state while
  // rendering (instead of in an effect) is React's pattern for this and avoids an extra render.
  if (start === null && total > 0) setStart(Math.max(0, total - PAGE_SIZE));

  // New messages never move the window; an edit that shortens the history still leaves a full page
  const first = Math.min(start ?? Math.max(0, total - PAGE_SIZE), Math.max(0, total - PAGE_SIZE));

  const loadEarlier = useCallback(() => {
    const container = containerRef.current;
    if (!container || first === 0 || anchor.current !== null) return;
    anchor.current = container.scrollHeight - container.scrollTop;
    setStart(Math.max(0, first - PAGE_SIZE));
  }, [containerRef, first]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (anchor.current !== null) {
      container.scrollTop = container.scrollHeight - anchor.current;
      anchor.current = null;
    }
    // A page that doesn't fill the screen can't be scrolled, so the next one is loaded right away
    if (first > 0 && container.scrollHeight <= container.clientHeight) loadEarlier();
  }, [first, containerRef, loadEarlier]);

  // Called from the container's scroll handler; the scroll to the bottom on open doesn't come near the top
  const onScroll = useCallback(() => {
    const container = containerRef.current;
    if (container && container.scrollTop < LOAD_THRESHOLD) loadEarlier();
  }, [containerRef, loadEarlier]);

  // Lets search jump to an older message: everything from it to the end gets rendered
  const showFrom = useCallback((index: number) => setStart((current) => Math.min(current ?? index, index)), []);

  return { first, onScroll, showFrom };
}
