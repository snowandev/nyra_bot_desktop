import React from "react";
import ReactDOM from "react-dom/client";
// First, so the notes' labels are already in the user's language
import "@/shared/i18n/i18n";
import "@fontsource/nunito/700.css";
import { MarksOverlay } from "@/features/screen-look/MarksOverlay";
import { applyAccent } from "@/shared/lib/theme";
import { loadPreferences } from "@/shared/storage/settings";
import "@/shared/styles/theme.css";
import "@/shared/styles/accents.css";
import "@/features/screen-look/marks.css";

// The user's accent, and again whenever Settings changes it in another window
applyAccent(loadPreferences().accentColor);
window.addEventListener("storage", () => applyAccent(loadPreferences().accentColor));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MarksOverlay />
  </React.StrictMode>,
);
