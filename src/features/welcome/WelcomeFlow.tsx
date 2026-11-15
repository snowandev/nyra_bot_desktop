import { ArrowLeft, ArrowRight, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { usePreferencesContext } from "@/features/settings/preferencesContext";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { systemLanguage } from "@/shared/i18n/languages";
import { BrandIcon } from "@/shared/ui/BrandIcon";
import { WelcomeAccess } from "./WelcomeAccess";
import { WelcomeAppearance } from "./WelcomeAppearance";
import { WelcomeCloud } from "./WelcomeCloud";
import { WelcomeDone } from "./WelcomeDone";
import { WelcomeHello } from "./WelcomeHello";
import { WelcomeMcp } from "./WelcomeMcp";
import { WelcomeOllama } from "./WelcomeOllama";
import { WelcomeWhere } from "./WelcomeWhere";
import { asksSomething, useSystemAccess } from "./useSystemAccess";
import { systemMemory } from "./welcomeStorage";
import { EMPTY_RESULT, type ModelPlaces, stepsFor, type WelcomeResult, type WelcomeStep } from "./welcomeSteps";

type Props = {
  // Finished or skipped: it doesn't open by itself again
  onClose: () => void;
  // Ends the welcome and opens Settings → Nyra features
  onShowFeatures: () => void;
  // Settings open over the welcome, which is there again when they close
  onAddMcpServer: () => void;
};

// Keys that act on what has the focus; anywhere else, Enter goes on
const OWN_ENTER = new Set(["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT"]);

// The first time Nyra opens: language, look, where the models run and setting them up, MCP, the system's
// permissions, and what else it does.
// Nothing in it is required: whatever is skipped is in Settings.
export function WelcomeFlow({ onClose, onShowFeatures, onAddMcpServer }: Props) {
  const { t } = useTranslation();
  const { preferences, updatePreferences } = usePreferencesContext();
  const [step, setStep] = useState<WelcomeStep>("hello");
  const [places, setPlaces] = useState<ModelPlaces>({ local: true, cloud: false });
  const [result, setResult] = useState<WelcomeResult>(EMPTY_RESULT);
  const [memory, setMemory] = useState<number | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const access = useSystemAccess();
  // Decided once, as Nyra opens: granting the last one on its step mustn't take the step away
  const [asksAccess, setAsksAccess] = useState<boolean | null>(null);
  if (asksAccess === null && access.state) setAsksAccess(asksSomething(access.state));
  const steps = stepsFor(places, asksAccess ?? false);
  const at = steps.indexOf(step);

  useEffect(() => {
    systemMemory()
      .then(setMemory)
      .catch(() => setMemory(null));
  }, []);

  // Each step starts at its title, for the keyboard and for screen readers
  useEffect(() => {
    body.current?.querySelector<HTMLElement>(".welcome-title")?.focus();
  }, [step]);

  useEscapeKey(onClose);

  const next = () => setStep(steps[Math.min(at + 1, steps.length - 1)]);
  const back = () => setStep(steps[Math.max(at - 1, 0)]);
  const setLocal = useCallback((local: WelcomeResult["local"]) => setResult((r) => ({ ...r, local })), []);

  // What the main button does and says, so Enter's effect is always written on it
  const primary: { label: string; action: () => void } | null = (() => {
    switch (step) {
      case "hello":
        return null;
      case "where":
        return { label: places.local || places.cloud ? t("welcome.continue") : t("welcome.where.none"), action: next };
      case "ollama":
        return { label: result.local.state === "none" ? t("welcome.later") : t("welcome.continue"), action: next };
      case "cloud":
        return { label: result.cloud.length === 0 ? t("welcome.later") : t("welcome.continue"), action: next };
      case "mcp":
        return result.mcpImported > 0 ? { label: t("welcome.continue"), action: next } : null;
      case "done":
        return { label: t("welcome.done.chat"), action: onClose };
      default:
        return { label: t("welcome.continue"), action: next };
    }
  })();

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter" || OWN_ENTER.has((e.target as HTMLElement).tagName)) return;
    e.preventDefault();
    (primary?.action ?? next)();
  }

  let content;
  switch (step) {
    case "hello":
      content = (
        <WelcomeHello
          language={preferences.language}
          systemLanguage={systemLanguage(navigator.languages)}
          onLanguageChange={(language) => updatePreferences({ language })}
          onStart={next}
        />
      );
      break;
    case "appearance":
      content = (
        <WelcomeAppearance
          theme={preferences.theme}
          onThemeChange={(theme) => updatePreferences({ theme })}
          accent={preferences.accentColor}
          onAccentChange={(accentColor) => updatePreferences({ accentColor })}
        />
      );
      break;
    case "where":
      content = <WelcomeWhere places={places} onChange={setPlaces} />;
      break;
    case "ollama":
      content = <WelcomeOllama memory={memory} onResult={setLocal} />;
      break;
    case "cloud":
      content = <WelcomeCloud configured={result.cloud} onConfigured={(cloud) => setResult((r) => ({ ...r, cloud }))} />;
      break;
    case "mcp":
      content = (
        <WelcomeMcp
          imported={result.mcpImported}
          onImported={(mcpImported) => setResult((r) => ({ ...r, mcpImported }))}
          onAddServer={onAddMcpServer}
          onNotNow={next}
        />
      );
      break;
    case "access":
      content = access.state && <WelcomeAccess state={access.state} error={access.error} onRequest={access.request} />;
      break;
    case "done":
      content = <WelcomeDone places={places} result={result} onShowFeatures={onShowFeatures} />;
      break;
  }

  return (
    <div className="welcome-layer" role="dialog" aria-modal="true" aria-label={t("welcome.label")} onKeyDown={onKeyDown}>
      <header className="welcome-header">
        <span className="welcome-brand">
          <BrandIcon size={20} />
          Nyra
        </span>
        <div className="welcome-progress">
          {at > 0 && (
            <div
              className="welcome-progress-bar"
              role="progressbar"
              aria-label={t("welcome.progress")}
              aria-valuemin={1}
              aria-valuemax={steps.length}
              aria-valuenow={at + 1}
              aria-valuetext={t("welcome.stepOf", { step: at + 1, total: steps.length })}
            >
              {steps.map((s, i) => (
                <i key={s} className={i < at ? "past" : i === at ? "current" : ""} />
              ))}
            </div>
          )}
        </div>
        <span className="welcome-skip">
          <button type="button" className="ghost-button small" aria-keyshortcuts="Escape" onClick={onClose}>
            {t("welcome.skip")}
            <kbd>{t("welcome.escKey")}</kbd>
          </button>
        </span>
      </header>
      <div className={`welcome-body ${step === "hello" ? "centered" : ""}`} ref={body}>
        <div className="welcome-content">{content}</div>
      </div>
      {step !== "hello" && (
        <footer className="welcome-footer">
          <button type="button" className="ghost-button" onClick={back}>
            <ArrowLeft size={15} strokeWidth={2} aria-hidden="true" />
            {t("welcome.back")}
          </button>
          {primary && (
            <button type="button" className="primary-button" onClick={primary.action}>
              {step === "done" && <MessageSquare size={15} strokeWidth={2} aria-hidden="true" />}
              {primary.label}
              {step !== "done" && <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />}
            </button>
          )}
        </footer>
      )}
      <span className="visually-hidden" role="status">
        {at > 0 ? t("welcome.stepOf", { step: at + 1, total: steps.length }) : ""}
      </span>
    </div>
  );
}
