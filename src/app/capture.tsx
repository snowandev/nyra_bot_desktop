import React from "react";
import ReactDOM from "react-dom/client";
// First, so every text of the first paint is already in the user's language
import "@/shared/i18n/i18n";
import "@fontsource/nunito/700.css";
import { CaptureOverlay } from "@/features/screen-capture/CaptureOverlay";
import "@/shared/styles/theme.css";
import "@/features/screen-capture/capture.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <CaptureOverlay />
  </React.StrictMode>,
);
