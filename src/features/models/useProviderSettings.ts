import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getProvider } from "@/providers";
import { ollama } from "@/providers/ollama";
import {
  isModelSettingsKey,
  loadAskBeforeCloud,
  loadAutoModel,
  loadDefaultModel,
  loadDemandingModel,
  loadHiddenModels,
  loadModels,
  loadProviderOptions,
  loadRecentModels,
  loadSelectedModel,
  saveAskBeforeCloud,
  saveAutoModel,
  saveDefaultModel,
  saveDemandingModel,
  saveHiddenModels,
  saveModels,
  saveProviderOptions,
  saveRecentModels,
  saveSelectedModel,
  type StoredProviderOptions,
} from "@/shared/storage/settings";
import type { Model, ProviderOptions } from "@/shared/types";
import { useApiKeys } from "./useApiKeys";
import { useStableCallback } from "@/shared/hooks/useStableCallback";

const MAX_RECENT = 5;

// The default may point to a model that was uninstalled since; then it is ignored
function installedDefault(models: Model[], defaultModelId: string | null) {
  return models.some((m) => m.id === defaultModelId) ? defaultModelId : null;
}

export function useProviderSettings() {
  const [models, setModels] = useState<Model[]>(loadModels);
  // Two providers may load at once: each builds on the list the other left, not on the one of its render
  const latestModels = useRef(models);
  const [defaultModelId, setDefaultModelId] = useState(loadDefaultModel);
  const [demandingModelId, setDemandingModelId] = useState(loadDemandingModel);
  const [isAuto, setIsAuto] = useState(loadAutoModel);
  const [askBeforeCloud, setAskBeforeCloud] = useState(loadAskBeforeCloud);
  // The app opens on a new conversation, so it starts with the default model too
  const [selectedModelId, setSelectedModelId] = useState(
    () => installedDefault(models, defaultModelId) ?? loadSelectedModel() ?? models[0]?.id ?? "",
  );
  // Kept out of the chat's model menu, still usable
  const [hiddenModelIds, setHiddenModelIds] = useState(loadHiddenModels);
  // Picked by the user in the menu, most recent first; automatic switches don't count
  const [recentModelIds, setRecentModelIds] = useState(loadRecentModels);
  const [storedOptions, setStoredOptions] = useState<Record<string, StoredProviderOptions>>(loadProviderOptions);
  const keys = useApiKeys();

  // Another window changed them (Settings or the model menu in the main window while the quick bar stays open, or
  // the other way round): this one follows. The model picked stays each window's own.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!isModelSettingsKey(event.key)) return;
      const stored = loadModels();
      latestModels.current = stored;
      setModels(stored);
      setDefaultModelId(loadDefaultModel());
      setDemandingModelId(loadDemandingModel());
      setIsAuto(loadAutoModel());
      setAskBeforeCloud(loadAskBeforeCloud());
      setHiddenModelIds(loadHiddenModels());
      setStoredOptions(loadProviderOptions());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const applySelection = useCallback((id: string) => {
    setSelectedModelId(id);
    saveSelectedModel(id);
  }, []);

  // A model chosen for the user (a project's own when it opens): the automatic choice and the recent list stay
  const showModel = applySelection;

  // A model picked by hand is the one used: the automatic choice between the two stops until it is picked again
  const selectModel = useCallback(
    (id: string) => {
      applySelection(id);
      setIsAuto(false);
      saveAutoModel(false);
      const next = [id, ...recentModelIds.filter((r) => r !== id)].slice(0, MAX_RECENT);
      setRecentModelIds(next);
      saveRecentModels(next);
    },
    [recentModelIds, applySelection],
  );

  const toggleModelHidden = useCallback(
    (id: string) => {
      const next = hiddenModelIds.includes(id) ? hiddenModelIds.filter((h) => h !== id) : [...hiddenModelIds, id];
      setHiddenModelIds(next);
      saveHiddenModels(next);
    },
    [hiddenModelIds],
  );

  const changeDefaultModel = useCallback((id: string | null) => {
    setDefaultModelId(id);
    saveDefaultModel(id);
  }, []);

  const changeDemandingModel = useCallback((id: string | null) => {
    setDemandingModelId(id);
    saveDemandingModel(id);
  }, []);

  const selectAuto = useCallback(() => {
    setIsAuto(true);
    saveAutoModel(true);
  }, []);

  const changeAskBeforeCloud = useCallback((ask: boolean) => {
    setAskBeforeCloud(ask);
    saveAskBeforeCloud(ask);
  }, []);

  // Automatic only with both models installed: the main one and one for demanding tasks
  const mainId = installedDefault(models, defaultModelId);
  const demandingId = installedDefault(models, demandingModelId);
  const autoOn = isAuto && !!mainId && !!demandingId && mainId !== demandingId;

  const selectDefaultModel = useCallback(() => {
    const id = installedDefault(models, defaultModelId);
    if (id) applySelection(id);
  }, [models, defaultModelId, applySelection]);

  const optionsFor = useCallback(
    (providerId: string): ProviderOptions => {
      const stored = storedOptions[providerId] ?? {};
      return {
        baseUrl: stored.baseUrl ?? getProvider(providerId)?.defaultBaseUrl ?? "",
        apiKey: keys.apiKeys[providerId] ?? "",
        contextLength: stored.contextLength,
        autoSummarize: stored.autoSummarize ?? true,
        // Remembered by default only where the keychain keeps it; a plain file is the user's call
        rememberApiKey: stored.rememberApiKey ?? keys.store === "keychain",
      };
    },
    [storedOptions, keys.apiKeys, keys.store],
  );

  const changeOptions = useCallback(
    (providerId: string, changes: Partial<ProviderOptions>) => {
      const { apiKey, ...persisted } = changes;
      if (apiKey !== undefined) keys.changeKey(providerId, apiKey, optionsFor(providerId).rememberApiKey);
      if (persisted.rememberApiKey !== undefined) keys.changeRemember(providerId, persisted.rememberApiKey);
      if (Object.keys(persisted).length === 0) return;

      const next = { ...storedOptions, [providerId]: { ...storedOptions[providerId], ...persisted } };
      setStoredOptions(next);
      saveProviderOptions(next);
    },
    [keys, optionsFor, storedOptions],
  );

  const replaceProviderModels = useCallback(
    (providerId: string, loaded: Model[]) => {
      const next = [...latestModels.current.filter((m) => m.providerId !== providerId), ...loaded];
      latestModels.current = next;
      setModels(next);
      saveModels(next);
      if (!next.some((m) => m.id === selectedModelId) && next[0]) applySelection(next[0].id);
    },
    [selectedModelId, applySelection],
  );

  // After the installed models changed outside the provider panel, e.g. a download finished in the background
  const refreshProviderModels = useCallback(
    async (providerId: string) => {
      const provider = getProvider(providerId);
      if (provider) replaceProviderModels(providerId, await provider.listModels(optionsFor(providerId)));
    },
    [replaceProviderModels, optionsFor],
  );

  // The saved list may predate details Nyra reads now, like whether a model thinks. If Ollama isn't running yet,
  // the saved list stays, as it would without this.
  const refreshOllama = useStableCallback(() => refreshProviderModels(ollama.id).catch(() => {}));
  useEffect(() => {
    refreshOllama();
  }, [refreshOllama]);

  // Only the keys of the providers in use: the chat's model, the default one (it adapts skills), the one for demanding
  // tasks and Ollama, which also makes the folders' vectors. Someone who only uses Ollama never has Claude's key read.
  const { loadSaved: requireApiKey } = keys;
  const defaultProviderId = models.find((m) => m.id === defaultModelId)?.providerId;
  const selectedProviderId = models.find((m) => m.id === selectedModelId)?.providerId;
  const demandingProviderId = models.find((m) => m.id === demandingModelId)?.providerId;
  useEffect(() => {
    for (const id of [ollama.id, defaultProviderId, selectedProviderId, demandingProviderId]) if (id) requireApiKey(id);
  }, [requireApiKey, defaultProviderId, selectedProviderId, demandingProviderId]);

  // Shared through a context and read inside the memoized chat messages: the same object until something in it
  // changes, or every message would re-render on each frame of a streaming reply
  return useMemo(
    () => ({
      models,
      selectedModelId,
      selectedModel: models.find((m) => m.id === selectedModelId),
      selectModel,
      showModel,
      hiddenModelIds,
      toggleModelHidden,
      recentModelIds,
      defaultModelId,
      changeDefaultModel,
      selectDefaultModel,
      demandingModelId: demandingId,
      changeDemandingModel,
      isAuto: autoOn,
      selectAuto,
      askBeforeCloud,
      changeAskBeforeCloud,
      optionsFor,
      changeOptions,
      secretStore: keys.store,
      savedApiKeys: keys.saved,
      apiKeyError: keys.error,
      forgetApiKey: keys.forget,
      requireApiKey,
      replaceProviderModels,
      refreshProviderModels,
    }),
    [
      models,
      selectedModelId,
      selectModel,
      showModel,
      hiddenModelIds,
      toggleModelHidden,
      recentModelIds,
      defaultModelId,
      changeDefaultModel,
      selectDefaultModel,
      demandingId,
      changeDemandingModel,
      autoOn,
      selectAuto,
      askBeforeCloud,
      changeAskBeforeCloud,
      optionsFor,
      changeOptions,
      keys,
      requireApiKey,
      replaceProviderModels,
      refreshProviderModels,
    ],
  );
}
