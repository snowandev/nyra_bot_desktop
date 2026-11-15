import React from "react";
import ReactDOM from "react-dom/client";
// First, so every text of the first paint is already in the user's language
import "@/shared/i18n/i18n";
import "./fonts";
import App from "./App";
import { blockStrayFileDrops } from "@/features/attachments/useFileDrop";
import { applyFontScale } from "@/shared/lib/fontScale";
import { applyAccent, applyTheme } from "@/shared/lib/theme";
import { loadPreferences } from "@/shared/storage/settings";
import "@/shared/styles/index.css";

blockStrayFileDrops();
// Before the first render, so the app doesn't open with a flash of the default theme, accent and text size
const preferences = loadPreferences();
applyTheme(preferences.theme);
applyAccent(preferences.accentColor);
applyFontScale(preferences.fontScale);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
