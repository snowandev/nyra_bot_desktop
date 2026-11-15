import { CircleCheck, Eye, EyeOff, KeyRound, LoaderCircle, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useProviderSettingsContext } from "@/features/models/providerSettingsContext";
import { getProvider } from "@/providers";
import { errorMessage } from "@/shared/lib/errors";
import type { WelcomeResult } from "./welcomeSteps";

type Props = {
  configured: WelcomeResult["cloud"];
  onConfigured: (cloud: WelcomeResult["cloud"]) => void;
};

// By the models people know them for, and the company that makes them
const PROVIDERS = [
  { id: "anthropic", models: "Claude", maker: "Anthropic" },
  { id: "openai", models: "GPT", maker: "OpenAI" },
  { id: "gemini", models: "Gemini", maker: "Google" },
] as const;

const modelsOf = (providerId: string) => PROVIDERS.find((p) => p.id === providerId)?.models ?? providerId;

type Check = { state: "idle" } | { state: "checking" } | { state: "error"; message: string };

// Models in the cloud: the key is checked by listing the provider's models, and kept only once it works
export function WelcomeCloud({ configured, onConfigured }: Props) {
  const { t } = useTranslation();
  const settings = useProviderSettingsContext();
  const firstFree = () => PROVIDERS.find((p) => !configured.some((c) => c.providerId === p.id))?.id ?? "anthropic";
  const [providerId, setProviderId] = useState<string>(firstFree);
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [adding, setAdding] = useState(configured.length === 0);
  const provider = getProvider(providerId);
  const remember = settings.optionsFor(providerId).rememberApiKey;

  async function verify() {
    if (!provider || !key.trim()) return;
    setCheck({ state: "checking" });
    try {
      const models = await provider.listModels({ ...settings.optionsFor(providerId), apiKey: key.trim() });
      settings.changeOptions(providerId, { apiKey: key.trim() });
      settings.replaceProviderModels(providerId, models);
      onConfigured([...configured.filter((c) => c.providerId !== providerId), { providerId, models: models.length }]);
      setKey("");
      setCheck({ state: "idle" });
      setAdding(false);
    } catch (e) {
      setCheck({ state: "error", message: errorMessage(e) });
    }
  }

  const done = configured.map((c) => (
    <span key={c.providerId} className="pill success">
      <CircleCheck size={12} strokeWidth={2.4} aria-hidden="true" />
      {t("welcome.cloud.works", { name: modelsOf(c.providerId), count: c.models })}
    </span>
  ));

  return (
    <>
      <h1 className="welcome-title" tabIndex={-1}>
        {t("welcome.cloud.title")}
      </h1>
      <p className="welcome-lead">{t("welcome.cloud.lead")}</p>
      {configured.length > 0 && <div className="welcome-pills">{done}</div>}
      {adding ? (
        <>
          <div className="welcome-providers" role="radiogroup" aria-label={t("welcome.cloud.provider")}>
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={providerId === p.id}
                className={`welcome-provider ${providerId === p.id ? "selected" : ""}`}
                onClick={() => {
                  setProviderId(p.id);
                  setCheck({ state: "idle" });
                }}
              >
                <b>{p.models}</b>
                <small>{p.maker}</small>
              </button>
            ))}
          </div>
          <form
            className="welcome-field"
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
          >
            <label htmlFor="welcome-api-key">{t("welcome.cloud.key", { name: modelsOf(providerId) })}</label>
            <div className={`welcome-input ${check.state === "error" ? "error" : ""}`}>
              <KeyRound size={15} strokeWidth={2} aria-hidden="true" />
              <input
                id="welcome-api-key"
                type={showKey ? "text" : "password"}
                value={key}
                placeholder={t("welcome.cloud.paste")}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={check.state === "error"}
                onChange={(e) => {
                  setKey(e.target.value);
                  setCheck({ state: "idle" });
                }}
              />
              <button
                type="button"
                className="icon-button small"
                aria-pressed={showKey}
                aria-label={showKey ? t("welcome.cloud.hideKey") : t("welcome.cloud.showKey")}
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? <EyeOff size={15} strokeWidth={2} /> : <Eye size={15} strokeWidth={2} />}
              </button>
              <button type="submit" className="outline-button small" disabled={!key.trim() || check.state === "checking"}>
                {t("welcome.cloud.check")}
              </button>
            </div>
            {check.state === "checking" && (
              <span className="welcome-status" role="status">
                <LoaderCircle size={15} strokeWidth={2} className="spin" aria-hidden="true" />
                {t("welcome.cloud.checking")}
              </span>
            )}
            {check.state === "error" && (
              <span className="welcome-status error" role="alert">
                {check.message}
              </span>
            )}
          </form>
          <label className="welcome-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => settings.changeOptions(providerId, { rememberApiKey: e.target.checked })}
            />
            <span>
              {t("welcome.cloud.remember")}
            </span>
          </label>
        </>
      ) : (
        configured.length < PROVIDERS.length && (
          <button
            type="button"
            className="welcome-link"
            onClick={() => {
              setProviderId(firstFree());
              setAdding(true);
            }}
          >
            <Plus size={14} strokeWidth={2} aria-hidden="true" />
            {t("welcome.cloud.another")}
          </button>
        )
      )}
    </>
  );
}
