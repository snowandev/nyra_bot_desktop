import { useEffect, useState } from "react";
import { type ContextLimit, contextLimitOf } from "./context";
import { configForModel } from "./modelRequest";
import { getProvider } from "@/providers";
import { ollama } from "@/providers/ollama";
import { loadedContextWindow } from "@/providers/ollamaModels";
import { loadLoadedContexts, saveLoadedContext } from "@/shared/storage/settings";
import type { Model } from "@/shared/types";
import { useProviderSettingsContext } from "@/features/models/providerSettingsContext";

// The context the selected model really works with. With the size left automatic, Ollama is asked which context it
// loaded the model with when the model is chosen; after each reply the stream records it again.
export function useContextLimit(model: Model | undefined): ContextLimit | null {
  const { optionsFor } = useProviderSettingsContext();
  // Bumped when Ollama answers, so the stored value is read again
  const [, setChecked] = useState(0);
  const config = model ? optionsFor(model.providerId) : undefined;
  const loadsContext = !!model && !!getProvider(model.providerId)?.loadsContextLength;
  const asksOllama = !!model && !!config && model.providerId === ollama.id && !configForModel(config, model).contextLength;
  const baseUrl = config?.baseUrl;
  const apiKey = config?.apiKey;
  const modelId = model?.id;

  useEffect(() => {
    if (!asksOllama || !modelId || baseUrl === undefined) return;
    let cancelled = false;
    void loadedContextWindow({ baseUrl, apiKey: apiKey ?? "" }, modelId).then((tokens) => {
      if (cancelled || !tokens) return;
      saveLoadedContext(modelId, tokens);
      setChecked((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [asksOllama, modelId, baseUrl, apiKey]);

  if (!model || !config) return null;
  return contextLimitOf(model, config, { loadsContext, loaded: loadLoadedContexts()[model.id] });
}
