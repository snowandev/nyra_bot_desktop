import { Cloud, Server } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useModelDownloadsContext } from "@/features/models/modelDownloadsContext";
import { useProviderSettingsContext } from "@/features/models/providerSettingsContext";
import { useCloudModels } from "@/features/models/useCloudModels";
import { useOllamaInventory } from "@/features/models/useOllamaInventory";
import { remoteHostOf } from "@/features/models/network";
import { PROVIDERS } from "@/providers";
import { ollama } from "@/providers/ollama";
import { chatModelsOf } from "@/providers/ollamaModels";
import type { Provider } from "@/providers/types";
import { CloudProviderPanel } from "./CloudProviderPanel";
import { OllamaModelManager } from "@/features/models/OllamaModelManager";
import { ProviderSettings } from "./ProviderSettings";
import { ModelRolesSettings } from "./ModelRolesSettings";
import { SettingsOption } from "@/shared/ui/SettingsOption";
import type { ConnectionStatus } from "@/shared/ui/StatusIndicator";

export function ProvidersSettings() {
  const settings = useProviderSettingsContext();
  const downloads = useModelDownloadsContext();
  const { t } = useTranslation();
  const { optionsFor, defaultModelId, requireApiKey } = settings;
  const [selectedId, setSelectedId] = useState(PROVIDERS[0].id);
  // Its panel shows the key, so it is read when the panel opens, not before
  useEffect(() => requireApiKey(selectedId), [requireApiKey, selectedId]);
  const ollamaOptions = optionsFor(ollama.id);
  // Ollama's model manager also keeps the chat's model list up to date
  const inventory = useOllamaInventory(
    ollamaOptions,
    (installed) => settings.replaceProviderModels(ollama.id, chatModelsOf(installed)),
    downloads.lastFinished?.at ?? 0,
  );
  const cloud = useCloudModels(settings.replaceProviderModels);
  const remoteHost = remoteHostOf(ollamaOptions.baseUrl);
  const where = remoteHost ?? t("settings.providers.thisComputer");
  const ollamaStatusLabel =
    inventory.status === "loading"
      ? t("common.connecting")
      : inventory.status === "error"
        ? t("common.notConnected")
        : (remoteHost ?? t("settings.providers.local"));

  const modelsOf = (providerId: string) => settings.models.filter((m) => m.providerId === providerId);

  // Everything but Ollama loads its list on request; kept from the last time, so it shows before the key is read
  function cloudStatusOf(p: Provider): { status: ConnectionStatus; label: string } {
    const { status } = cloud.stateOf(p.id);
    const hasKey = !!optionsFor(p.id).apiKey.trim() || settings.savedApiKeys.includes(p.id);
    const label =
      status === "loading"
        ? t("common.connecting")
        : status === "error"
          ? t("common.notConnected")
          : status === "loaded"
            ? t("common.models", { count: modelsOf(p.id).length })
            : p.requiresApiKey && !hasKey
              ? t("settings.providers.missingKey")
              : t("settings.providers.notConnectedYet");
    return { status, label };
  }

  const statusOf = (p: Provider) =>
    p.id === ollama.id ? { status: inventory.status, label: ollamaStatusLabel } : cloudStatusOf(p);
  const provider = PROVIDERS.find((p) => p.id === selectedId) ?? PROVIDERS[0];

  return (
    <div className="settings-content">
      <section aria-label={t("settings.providers.list")} className="settings-list">
        <div className="section-label">{t("settings.providers.title")}</div>
        {PROVIDERS.map((p) => (
          <SettingsOption
            key={p.id}
            icon={p.requiresApiKey ? <Cloud size={18} strokeWidth={1.8} /> : <Server size={18} strokeWidth={1.8} />}
            name={p.name}
            status={
              <span className="settings-option-status">
                <span className={`status-dot ${statusOf(p).status}`} />
                {statusOf(p).label}
              </span>
            }
            selected={p.id === provider.id}
            onSelect={() => setSelectedId(p.id)}
          />
        ))}
        <ModelRolesSettings />
      </section>

      {provider.id !== ollama.id ? (
        <CloudProviderPanel
          key={provider.id}
          provider={provider}
          state={cloud.stateOf(provider.id)}
          models={modelsOf(provider.id)}
          onLoadModels={() => cloud.reload(provider, optionsFor(provider.id))}
        />
      ) : (
        <ProviderSettings
          key={ollama.id}
          provider={ollama}
          options={ollamaOptions}
          onChange={(changes) => settings.changeOptions(ollama.id, changes)}
          status={inventory.status}
          connectionDetail={t("settings.providers.connectedToAt", {
            name: inventory.version ? `${ollama.name} ${inventory.version}` : ollama.name,
            place: where,
          })}
          onLoadModels={inventory.reload}
        >
          <OllamaModelManager
            config={ollamaOptions}
            inventory={inventory}
            defaultModelId={defaultModelId}
            onDefaultModelChange={settings.changeDefaultModel}
          />
        </ProviderSettings>
      )}
    </div>
  );
}
