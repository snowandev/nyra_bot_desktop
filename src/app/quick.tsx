import React from "react";
import ReactDOM from "react-dom/client";
// First, so every text of the first paint is already in the user's language
import "@/shared/i18n/i18n";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import QuickApp from "./QuickApp";
import { blockStrayFileDrops } from "@/features/attachments/useFileDrop";
import { applyAccent, applyTheme } from "@/shared/lib/theme";
import { loadPreferences } from "@/shared/storage/settings";
import "@/shared/styles/theme.css";
import "@/shared/styles/accents.css";
// The app's buttons, which the strips and cards in the bar use
import "@/shared/styles/controls.css";
// The chat's own pieces (Markdown, code, reasoning) look the same as in the main window
import "@/features/chat/chat.css";
import "@/features/markdown/syntax.css";
import "katex/dist/katex.min.css";
import "@/features/markdown/math.css";
import "@/shared/styles/feedback.css";
import "@/features/attachments/attachments.css";
import "@/features/attachments/files-panel.css";
import "@/features/skills/skill-command.css";
import "@/features/quick-bar/quick.css";
import "@/features/dictation/dictation.css";
import "@/shared/styles/strip.css";
import "@/features/screen-look/screen.css";
import "@/features/mcp/mcp.css";

// The same theme as the main window, read from the same preferences
const preferences = loadPreferences();
applyTheme(preferences.theme);
applyAccent(preferences.accentColor);
// A file dropped off the bar would load in its window in place of the bar
blockStrayFileDrops();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QuickApp />
  </React.StrictMode>,
);
