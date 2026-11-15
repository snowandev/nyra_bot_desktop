import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

// A tree is one stop for Tab: only one row can be reached with it (the last one focused, the current one or the
// first) and the arrows move between the rest. The rows' menu buttons are left out too: Shift+F10 opens them.
export function useRovingTree(ref: RefObject<HTMLElement | null>, rows: string) {
  const last = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    function remember(e: FocusEvent) {
      const row = (e.target as HTMLElement).closest<HTMLElement>(rows);
      if (!row || !root?.contains(row)) return;
      last.current = row;
      root.querySelectorAll<HTMLElement>(rows).forEach((el) => (el.tabIndex = el === row ? 0 : -1));
    }
    root.addEventListener("focusin", remember);
    return () => root.removeEventListener("focusin", remember);
  }, [ref, rows]);

  // After every render, since rows come and go as folders open and the search filters
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const all = Array.from(root.querySelectorAll<HTMLElement>(rows));
    const stop = all.find((el) => el === last.current) ?? all.find((el) => el.getAttribute("aria-current")) ?? all[0];
    // Only what changed is written: this runs after every render, also while a reply is being written
    for (const el of all) {
      const wanted = el === stop ? 0 : -1;
      if (el.tabIndex !== wanted) el.tabIndex = wanted;
    }
    for (const el of root.querySelectorAll<HTMLElement>(".conversation-menu-trigger")) {
      if (el.tabIndex !== -1) el.tabIndex = -1;
    }
  });
}

// ↑ ↓ Home and End through a tree's rows, the same in every tree; true when the key was one of them
export function moveTreeFocus(key: string, rows: HTMLElement[], index: number) {
  const next =
    key === "ArrowDown"
      ? rows[index + 1]
      : key === "ArrowUp"
        ? rows[index - 1]
        : key === "Home"
          ? rows[0]
          : key === "End"
            ? rows.at(-1)
            : null;
  if (next === null) return false;
  next?.focus();
  return true;
}
