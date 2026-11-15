import { useSyncExternalStore } from "react";

// How the Código space shares the window: below 960 px only the chat fits beside the folded sidebar; below 1600 a
// review needs the sidebar folded and the panel closed; from 1600 the panel stays open next to a review
type WindowWidth = "narrow" | "medium" | "wide" | "extraWide";

const QUERIES: [WindowWidth, string][] = [
  ["narrow", "(max-width: 959px)"],
  ["medium", "(max-width: 1279px)"],
  ["wide", "(max-width: 1599px)"],
];

function subscribe(onChange: () => void) {
  const queries = QUERIES.map(([, query]) => window.matchMedia(query));
  queries.forEach((q) => q.addEventListener("change", onChange));
  return () => queries.forEach((q) => q.removeEventListener("change", onChange));
}

const current = (): WindowWidth => QUERIES.find(([, query]) => window.matchMedia(query).matches)?.[0] ?? "extraWide";

export function useWindowWidth() {
  return useSyncExternalStore(subscribe, current);
}
