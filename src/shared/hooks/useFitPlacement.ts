import { type RefObject, useLayoutEffect } from "react";

const GAP = 10;
const MARGIN = 12;

// The nearest ancestor that clips or scrolls its content; a menu poking out of it makes it scrollable
function clippingBounds(element: HTMLElement) {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (getComputedStyle(parent).overflowY !== "visible") return parent.getBoundingClientRect();
  }
  return { top: 0, bottom: window.innerHeight };
}

// Opens a menu on the preferred side if it fits, otherwise on the side with more room, and never taller than that
// room. A menu that sticks out of a scrollable area makes it grow, and WebKit keeps the scroll after it closes,
// leaving the screen shifted with no way back. The side goes in data-placement and the room in --fit-height, so the
// menu's CSS uses them without React re-rendering. The menu's parent is its anchor: the wrapper around its button.
export function useFitPlacement(menuRef: RefObject<HTMLElement | null>, isOpen: boolean, preferred: "up" | "down") {
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const anchor = menu?.parentElement;
    if (!isOpen || !menu || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const bounds = clippingBounds(anchor);
    const room = {
      up: rect.top - Math.max(bounds.top, 0) - GAP - MARGIN,
      down: Math.min(bounds.bottom, window.innerHeight) - rect.bottom - GAP - MARGIN,
    };
    const other = preferred === "up" ? "down" : "up";
    const side = menu.scrollHeight <= room[preferred] || room[preferred] >= room[other] ? preferred : other;
    menu.dataset.placement = side;
    menu.style.setProperty("--fit-height", `${Math.max(room[side], 120)}px`);
  }, [menuRef, isOpen, preferred]);
}
