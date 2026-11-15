import { type RefObject, useEffect, useSyncExternalStore } from "react";

// Which command cards are on screen, so the composer can say when the one waiting has scrolled out of view

const hidden = new Set<string>();
const listeners = new Set<() => void>();

function setVisible(id: string, visible: boolean) {
  if (visible === !hidden.has(id)) return;
  if (visible) hidden.delete(id);
  else hidden.add(id);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The card tells whether enough of it is on screen
export function useTrackVisibility(ref: RefObject<HTMLElement | null>, id: string) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(id, entry.isIntersecting), { threshold: 0.15 });
    observer.observe(element);
    return () => {
      observer.disconnect();
      setVisible(id, true);
    };
  }, [ref, id]);
}

export function useIsOutOfView(id: string | undefined) {
  return useSyncExternalStore(subscribe, () => !!id && hidden.has(id));
}

// Brings the card into view and puts the focus where the user acts next
export function goToCommand(id: string) {
  const card = document.getElementById(id);
  if (!card) return;
  card.scrollIntoView({ block: "center", behavior: "smooth" });
  card.querySelector<HTMLElement>("[data-command-focus]")?.focus({ preventScroll: true });
}
