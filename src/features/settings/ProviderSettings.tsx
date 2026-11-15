import { Eye, EyeOff, RotateCw, TriangleAlert } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useProviderSettingsContext } from "@/features/models/providerSettingsContext";
import { isUnencryptedRemote } from "@/features/models/network";
import type { Provider } from "@/providers/types";
import type { ProviderOptions } from "@/shared/types";
import { LoadingButton } from "@/shared/ui/LoadingButton";
import { SettingsPanel } from "@/shared/ui/SettingsPanel";
import { type ConnectionStatus, StatusIndicator } from "@/shared/ui/StatusIndicator";
import { Switch } from "@/shared/ui/Switch";

type Props = {
  provider: Provider;
  options: ProviderOptions;
  onChange: (changes: Partial<ProviderOptions>) => void;
  status: ConnectionStatus;
  // Next to the reload button once connected, e.g. "Conectado a Ollama 0.12 en localhost"
  connectionDetail: string;
  // Why the last attempt failed, e.g. an invalid API key; without one, a plain "Sin conexión"
  errorDetail?: string | null;
  onLoadModels: () => void;
  // The provider's models: for Ollama, the model manager
  children: ReactNode;
};

// The connection is something you set once: a compact card, so the models get the room
export function ProviderSettings(props: Props) {
  const { provider, options, onChange, status, connectionDetail, errorDetail, onLoadModels, children } = props;
  const { t } = useTranslation();
  const [isKeyVisible, setIsKeyVisible] = useState(false);
  const { secretStore, savedApiKeys, apiKeyError, forgetApiKey } = useProviderSettingsContext();
  const isKeySaved = savedApiKeys.includes(provider.id);
  const ids = { url: useId(), key: useId(), context: useId(), hints: useId() };

  function changeContextLength(value: string) {
    const length = Number(value);
    onChange({ contextLength: Number.isInteger(length) && length > 0 ? length : undefined });
  }

  const named = { name: provider.name, url: provider.defaultBaseUrl };
  const hints = {
    url: t(provider.requiresApiKey ? "settings.providers.urlHintCloud" : "settings.providers.urlHintLocal", named),
    key: t(provider.requiresApiKey ? "settings.providers.keyHintRequired" : "settings.providers.keyHintOptional", named),
    context: t(
      provider.loadsContextLength
        ? "settings.providers.contextHintLoads"
        : provider.requiresApiKey
          ? "settings.providers.contextHintLimitPaid"
          : "settings.providers.contextHintLimit",
      named,
    ),
    summarize: t("settings.providers.summarizeHint"),
    remember: t(secretStore === "keychain" ? "settings.providers.rememberKeychain" : "settings.providers.rememberFile"),
  };

  const keyStatus = !options.rememberApiKey
    ? t("settings.providers.keyNotKept")
    : secretStore === "keychain"
      ? t("settings.providers.keyInKeychain")
      : t("settings.providers.keyInFile");

  return (
    <SettingsPanel
      title={provider.name}
      label={t("settings.providers.settingsOf", { name: provider.name })}
      description={provider.description}
      badge={<StatusIndicator status={status} className={`connection-pill ${status}`} />}
    >
      <section className="model-section" aria-labelledby={`${ids.url}-title`}>
        <h4 id={`${ids.url}-title`}>{t("settings.providers.connection")}</h4>
        <div className="connection-card">
          {/* Without the context field the URL takes the whole row, so the API key sits below it as in Ollama */}
          <div className={`connection-field ${provider.supportsContextLength ? "" : "wide"}`}>
            <label htmlFor={ids.url}>{t("settings.providers.baseUrl")}</label>
            <input
              id={ids.url}
              type="url"
              className="text-input mono"
              spellCheck={false}
              title={hints.url}
              aria-describedby={`${ids.hints}-url`}
              value={options.baseUrl}
              onChange={(e) => onChange({ baseUrl: e.target.value })}
            />
          </div>

          {provider.supportsContextLength && (
            <div className="connection-field">
              <label htmlFor={ids.context}>
                {t("settings.providers.contextSize")} <small>({t("common.optional")})</small>
              </label>
              <input
                id={ids.context}
                type="number"
                inputMode="numeric"
                min={1}
                step={1024}
                className="text-input mono"
                placeholder={
                  provider.loadsContextLength ? t("settings.providers.automatic") : t("settings.providers.modelMaximum")
                }
                title={hints.context}
                aria-describedby={`${ids.hints}-context`}
                value={options.contextLength ?? ""}
                onChange={(e) => changeContextLength(e.target.value)}
              />
            </div>
          )}

          <div className="connection-field">
            <label htmlFor={ids.key}>
              {t("settings.providers.apiKey")}{" "}
              <small>
                ({provider.requiresApiKey ? t("settings.providers.required") : t("common.optional")} ·{" "}
                {secretStore ? keyStatus : t("settings.providers.keyNotKept")})
              </small>
            </label>
            <div className="secret-input">
              <input
                id={ids.key}
                type={isKeyVisible ? "text" : "password"}
                className="mono"
                autoComplete="off"
                placeholder={provider.requiresApiKey ? t("settings.providers.pasteKey") : t("settings.providers.noKey")}
                title={hints.key}
                aria-describedby={`${ids.hints}-key`}
                value={options.apiKey}
                onChange={(e) => onChange({ apiKey: e.target.value })}
              />
              <button
                type="button"
                aria-label={isKeyVisible ? t("settings.providers.hideKey") : t("settings.providers.showKey")}
                aria-pressed={isKeyVisible}
                onClick={() => setIsKeyVisible((visible) => !visible)}
              >
                {isKeyVisible ? <EyeOff size={17} strokeWidth={1.8} /> : <Eye size={17} strokeWidth={1.8} />}
              </button>
            </div>
          </div>

          <div className="connection-field connection-switch" title={hints.summarize}>
            <Switch
              checked={options.autoSummarize}
              onChange={(enabled) => onChange({ autoSummarize: enabled })}
              label={t("settings.providers.summarize")}
            />
            <span aria-hidden="true">{t("settings.providers.summarize")}</span>
          </div>

          {secretStore && (
            <div className="connection-remember">
              <label title={hints.remember}>
                <input
                  type="checkbox"
                  checked={options.rememberApiKey}
                  aria-describedby={`${ids.hints}-remember`}
                  onChange={(e) => onChange({ rememberApiKey: e.target.checked })}
                />
                {t("settings.providers.rememberKey")}
              </label>
              {isKeySaved && (
                <button type="button" className="link-button" onClick={() => forgetApiKey(provider.id)}>
                  {t("settings.providers.forgetKey")}
                </button>
              )}
              {secretStore === "file" && <span className="connection-remember-note">{hints.remember}</span>}
            </div>
          )}

          <div className="connection-row">
            {status === "loading" ? (
              <LoadingButton>{t("common.connecting")}</LoadingButton>
            ) : (
              <button type="button" className="outline-button" onClick={onLoadModels}>
                <RotateCw size={14} strokeWidth={2.1} />
                {status === "error" ? t("common.retry") : t("settings.providers.loadModels")}
              </button>
            )}
            {status !== "loading" && (
              <span className={`connection-detail ${status}`}>
                <span className={`status-dot ${status}`} />
                {status === "loaded" ? connectionDetail : (errorDetail ?? t("common.notConnected"))}
              </span>
            )}
          </div>
        </div>

        {apiKeyError && (
          <p role="alert" className="field-warning">
            <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />
            <span>{apiKeyError}</span>
          </p>
        )}

        {/* Only with a key: it would travel readable, and anyone on the way could use it */}
        {isUnencryptedRemote(options.baseUrl) && options.apiKey.trim() && (
          <p role="status" className="field-warning">
            <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />
            <span>{t("settings.providers.insecureWithKey", { name: provider.name })}</span>
          </p>
        )}

        {/* The fields' explanations, for screen readers; sighted users get them as tooltips */}
        <span className="visually-hidden" id={`${ids.hints}-url`}>
          {hints.url}
        </span>
        <span className="visually-hidden" id={`${ids.hints}-context`}>
          {hints.context}
        </span>
        <span className="visually-hidden" id={`${ids.hints}-key`}>
          {hints.key}
        </span>
        <span className="visually-hidden" id={`${ids.hints}-remember`}>
          {hints.remember}
        </span>
      </section>

      {children}
    </SettingsPanel>
  );
}
