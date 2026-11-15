import { useCallback, useRef, useState } from "react";
import { useClickOutside } from "./useClickOutside";
import { useEscapeKey } from "./useEscapeKey";

// Open/closed state for a menu or dropdown that closes with Escape or a click anywhere outside rootRef
export function usePopover<T extends HTMLElement = HTMLDivElement>() {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<T>(null);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((current) => !current), []);

  useEscapeKey(close, isOpen);
  useClickOutside(rootRef, close, isOpen);

  return { isOpen, rootRef, open, close, toggle };
}
