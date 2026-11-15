import { type KeyboardEvent, useEffect, useRef } from "react";
import { usePopover } from "./usePopover";

// A popover that works like a small dialog (the sensitive data notice, the skills of a reply): opening it moves the
// focus to its close button, and closing it with that button or Escape brings the focus back to the button that
// opened it. Without preventScroll, focusing could scroll the areas around it to show it.
export function useDialogPopover() {
  const popover = usePopover();
  const { isOpen, close } = popover;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) closeRef.current?.focus({ preventScroll: true });
  }, [isOpen]);

  const returnFocus = () => triggerRef.current?.focus({ preventScroll: true });

  function closeAndReturn() {
    close();
    returnFocus();
  }

  // usePopover already closes on Escape; this brings the focus back
  function onDialogKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") returnFocus();
  }

  return { ...popover, triggerRef, closeRef, closeAndReturn, onDialogKeyDown };
}
