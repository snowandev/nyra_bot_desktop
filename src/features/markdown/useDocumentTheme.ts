import { useSyncExternalStore } from "react";
import type { Theme } from "@/shared/storage/settings";

// The theme on screen, as shared/lib/theme.ts sets it on <html> (already resolved when following the system)
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

const currentTheme = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

export const useDocumentTheme = () => useSyncExternalStore(subscribe, currentTheme);
