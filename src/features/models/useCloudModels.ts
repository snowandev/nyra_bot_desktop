import { useRef, useState } from "react";
import { errorMessage } from "@/shared/lib/errors";
import type { Provider } from "@/providers/types";
import type { Model, ProviderConfig } from "@/shared/types";
import type { ConnectionStatus } from "@/shared/ui/StatusIndicator";
import { useStableCallback } from "@/shared/hooks/useStableCallback";

type LoadState = { status: ConnectionStatus; error: string | null };

const IDLE: LoadState = { status: "idle", error: null };

// Loads a provider's models on request, each provider on its own: there is nothing to watch, unlike Ollama
export function useCloudModels(onLoaded: (providerId: string, models: Model[]) => void) {
  const [states, setStates] = useState<Record<string, LoadState>>({});
  const handleLoaded = useStableCallback(onLoaded);
  // Only each provider's latest request may report back, so a slow earlier one can't overwrite it
  const latest = useRef(new Map<string, number>());

  const update = (providerId: string, state: LoadState) => setStates((all) => ({ ...all, [providerId]: state }));

  async function reload(provider: Provider, config: ProviderConfig) {
    const request = (latest.current.get(provider.id) ?? 0) + 1;
    latest.current.set(provider.id, request);
    update(provider.id, { status: "loading", error: null });
    try {
      const models = await provider.listModels(config);
      if (latest.current.get(provider.id) !== request) return;
      handleLoaded(provider.id, models);
      update(provider.id, { status: "loaded", error: null });
    } catch (e) {
      if (latest.current.get(provider.id) !== request) return;
      update(provider.id, { status: "error", error: errorMessage(e) });
    }
  }

  return { stateOf: (providerId: string) => states[providerId] ?? IDLE, reload };
}
