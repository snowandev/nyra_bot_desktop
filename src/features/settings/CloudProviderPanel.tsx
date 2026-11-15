import { useTranslation } from "react-i18next";
import { useProviderSettingsContext } from "@/features/models/providerSettingsContext";
import { CloudModelList } from "@/features/models/CloudModelList";
import type { Provider } from "@/providers/types";
import type { Model } from "@/shared/types";
import type { ConnectionStatus } from "@/shared/ui/StatusIndicator";
import { ProviderSettings } from "./ProviderSettings";

type Props = {
  provider: Provider;
  state: { status: ConnectionStatus; error: string | null };
  models: Model[];
  onLoadModels: () => void;
};

// A provider whose models load on request: its connection, and the models it listed last time
export function CloudProviderPanel({ provider, state, models, onLoadModels }: Props) {
  const settings = useProviderSettingsContext();
  const { t } = useTranslation();
  const options = settings.optionsFor(provider.id);
  const hasKey = !!options.apiKey.trim() || settings.savedApiKeys.includes(provider.id);
  const missingKey = provider.requiresApiKey && !hasKey ? t("settings.providers.pasteKeyAndLoad") : null;

  return (
    <ProviderSettings
      provider={provider}
      options={options}
      onChange={(changes) => settings.changeOptions(provider.id, changes)}
      status={state.status}
      connectionDetail={t("settings.providers.connectedTo", { name: provider.name })}
      errorDetail={state.error ?? missingKey}
      onLoadModels={onLoadModels}
    >
      <CloudModelList
        models={models}
        defaultModelId={settings.defaultModelId}
        onDefaultModelChange={settings.changeDefaultModel}
      />
    </ProviderSettings>
  );
}
