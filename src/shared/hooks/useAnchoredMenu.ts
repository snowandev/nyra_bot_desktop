import { type CSSProperties, useEffect, useRef, useState } from "react";
import { usePopover } from "./usePopover";

const MENU_GAP = 4;
const MIN_SPACE_BELOW = 120;

// The conversation list scrolls and would clip an absolute menu, so it is placed relative to the viewport
function menuPositionFor(trigger: HTMLElement): CSSProperties {
  const rect = trigger.getBoundingClientRect();
  const right = window.innerWidth - rect.right;
  return window.innerHeight - rect.bottom < MIN_SPACE_BELOW
    ? { right, bottom: window.innerHeight - rect.top + MENU_GAP }
    : { right, top: rect.bottom + MENU_GAP };
}

// A menu of the sidebar's "⋯" buttons: fixed next to its trigger, closed when the list scrolls or the window resizes
export function useAnchoredMenu() {
  const popover = usePopover();
  const { isOpen, open, close } = popover;
  const [position, setPosition] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);

  // A fixed menu would drift away from its row when the list scrolls or the window resizes
  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [isOpen, close]);

  function toggle() {
    if (isOpen || !triggerRef.current) return close();
    setPosition(menuPositionFor(triggerRef.current));
    open();
  }

  return { ...popover, triggerRef, position, toggle };
}
