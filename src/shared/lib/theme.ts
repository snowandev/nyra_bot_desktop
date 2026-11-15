import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AccentColor, Theme, ThemePreference } from "@/shared/storage/settings";

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

function systemTheme(): Theme {
  return window.matchMedia(SYSTEM_DARK_QUERY).matches ? "dark" : "light";
}

function setDocumentTheme(preference: ThemePreference) {
  document.documentElement.dataset.theme = preference === "system" ? systemTheme() : preference;
}

let latestRequest = 0;

export async function applyTheme(preference: ThemePreference) {
  const request = ++latestRequest;
  setDocumentTheme(preference);
  // A forced window theme also changes what the WebView reports as the system theme, so null releases it first.
  // The title bar is cosmetic, so a failure is not worth reporting.
  await getCurrentWindow()
    .setTheme(preference === "system" ? null : preference)
    .catch(() => {});
  // A quicker later change must not be overwritten by this one finishing last
  if (request === latestRequest) setDocumentTheme(preference);
}

// The default violet is the theme's own accent, so it needs no attribute
export function applyAccent(accent: AccentColor) {
  if (accent === "violet") delete document.documentElement.dataset.accent;
  else document.documentElement.dataset.accent = accent;
}

// The accent as marks over other apps and pages draw it: its light-theme shade, made to read under white text and
// to stand out whatever is behind. Read from the stylesheet, so it is always the one Settings shows.
export function markAccent() {
  const probe = document.createElement("span");
  probe.dataset.theme = "light";
  probe.hidden = true;
  document.documentElement.appendChild(probe);
  const color = getComputedStyle(probe).getPropertyValue("--accent").trim();
  probe.remove();
  return color;
}

// Returns the function that stops following the system theme
export function followSystemTheme() {
  const query = window.matchMedia(SYSTEM_DARK_QUERY);
  const update = () => setDocumentTheme("system");
  query.addEventListener("change", update);
  return () => query.removeEventListener("change", update);
}
