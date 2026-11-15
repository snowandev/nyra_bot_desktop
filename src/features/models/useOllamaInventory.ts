import { useEffect, useState } from "react";
import { errorMessage } from "@/shared/lib/errors";
import {
  type InstalledModel,
  type LoadedModel,
  listInstalledModels,
  listLoadedModels,
  ollamaVersion,
} from "@/providers/ollamaModels";
import type { ProviderConfig } from "@/shared/types";
import { useStableCallback } from "@/shared/hooks/useStableCallback";

type Inventory = {
  status: "loading" | "loaded" | "error";
  installed: InstalledModel[];
  loaded: LoadedModel[];
  version: string | null;
  error: string | null;
};

// What is installed in Ollama and what is in memory. Read when the panel opens, after every change made here,
// and whenever refreshKey changes (a download that finished in the background)
export function useOllamaInventory(
  config: ProviderConfig,
  onInstalled: (installed: InstalledModel[]) => void,
  refreshKey: number,
) {
  const [inventory, setInventory] = useState<Inventory>({
    status: "loading",
    installed: [],
    loaded: [],
    version: null,
    error: null,
  });
  const fetchInventory = useStableCallback(async () => {
    try {
      // Which models are in memory is a detail; a failure there shouldn't hide the list
      const [installed, loaded, version] = await Promise.all([
        listInstalledModels(config),
        listLoadedModels(config).catch(() => []),
        ollamaVersion(config),
      ]);
      onInstalled(installed);
      return { status: "loaded" as const, installed, loaded, version, error: null };
    } catch (e) {
      return { status: "error" as const, installed: [], loaded: [], version: null, error: errorMessage(e) };
    }
  });

  useEffect(() => {
    let cancelled = false;
    fetchInventory().then((next) => {
      if (!cancelled) setInventory(next);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchInventory, refreshKey]);

  async function reload() {
    setInventory((current) => ({ ...current, status: current.status === "error" ? "loading" : current.status }));
    setInventory(await fetchInventory());
  }

  // Only the memory column: cheaper than reading every model again
  async function reloadLoaded() {
    const loaded = await listLoadedModels(config).catch(() => inventory.loaded);
    setInventory((current) => ({ ...current, loaded }));
  }

  return { ...inventory, reload, reloadLoaded };
}
