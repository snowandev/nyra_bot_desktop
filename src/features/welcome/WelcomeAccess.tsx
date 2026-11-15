import { Bell, CircleCheck, Info, Mic, MonitorUp, MousePointer2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "@/shared/lib/errors";
import type { AccessKind, AccessState } from "./useSystemAccess";
import { openAccessSettings } from "./welcomeStorage";

type Props = {
  state: AccessState;
  error: unknown;
  onRequest: (kind: AccessKind) => Promise<void>;
};

const ICONS: Record<AccessKind, LucideIcon> = {
  microphone: Mic,
  screen: MonitorUp,
  accessibility: MousePointer2,
  notifications: Bell,
};

// The system's permissions, asked for in one place so dictation, seeing the screen, using the mouse and keyboard and
// notifications work from the start. Optional: whatever is left, Nyra asks for the first time it is needed.
export function WelcomeAccess({ state, error, onRequest }: Props) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState<AccessKind | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const kinds = (Object.keys(ICONS) as AccessKind[]).filter((kind) => state[kind] !== null);

  async function ask(kind: AccessKind) {
    setAsking(kind);
    await onRequest(kind);
    setAsking(null);
  }

  function openSettings(kind: Exclude<AccessKind, "notifications">) {
    setSettingsError(null);
    openAccessSettings(kind).catch((e) => setSettingsError(errorMessage(e)));
  }

  const action = (kind: AccessKind) => {
    const access = state[kind];
    if (access === "granted") {
      return (
        <span className="welcome-summary-state ok">
          <CircleCheck size={14} strokeWidth={2.2} aria-hidden="true" />
          {t("welcome.access.granted")}
        </span>
      );
    }
    if (access === "denied") {
      return kind === "notifications" ? (
        <span className="welcome-summary-state">{t("welcome.access.notificationsDenied")}</span>
      ) : (
        <button type="button" className="outline-button small" onClick={() => openSettings(kind)}>
          {t("welcome.access.openSettings")}
        </button>
      );
    }
    return (
      <button type="button" className="outline-button small" disabled={asking !== null} onClick={() => void ask(kind)}>
        {asking === kind ? t("welcome.access.asking") : t("welcome.access.allow")}
      </button>
    );
  };

  const shownError = settingsError ?? (error ? errorMessage(error) : null);
  return (
    <>
      <h1 className="welcome-title" tabIndex={-1}>
        {t("welcome.access.title")}
      </h1>
      <p className="welcome-lead">{t("welcome.access.lead")}</p>
      <ul className="welcome-summary">
        {kinds.map((kind) => {
          const Icon = ICONS[kind];
          return (
            <li key={kind}>
              <span className="welcome-summary-icon" aria-hidden="true">
                <Icon size={16} strokeWidth={1.9} />
              </span>
              <span className="welcome-summary-text">
                <b>{t(`welcome.access.${kind}.title`)}</b>
                <small>{t(`welcome.access.${kind}.why`)}</small>
              </span>
              {action(kind)}
            </li>
          );
        })}
      </ul>
      {shownError && (
        <span className="welcome-status error" role="alert">
          {shownError}
        </span>
      )}
      {[state.screen, state.accessibility].some((a) => a !== null && a !== "granted") && (
        <p className="welcome-note">
          <Info size={14} strokeWidth={2} aria-hidden="true" />
          {t("welcome.access.screenReopen")}
        </p>
      )}
      <p className="welcome-note">
        <Info size={14} strokeWidth={2} aria-hidden="true" />
        {t("welcome.access.later")}
      </p>
    </>
  );
}
