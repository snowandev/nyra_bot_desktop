import { useMemo } from "react";
import type { useProviderSettings } from "./useProviderSettings";

type ProviderSettings = ReturnType<typeof useProviderSettings>;

// «Automático»: the main model (the default) and the one for demanding tasks, or null while a model is picked by hand
export function useModelRouting(settings: ProviderSettings) {
  const mainModel = settings.models.find((m) => m.id === settings.defaultModelId);
  const demandingModel = settings.models.find((m) => m.id === settings.demandingModelId);
  const routing = useMemo(
    () =>
      settings.isAuto && mainModel && demandingModel
        ? { main: mainModel, demanding: demandingModel, askBeforeCloud: settings.askBeforeCloud }
        : null,
    [settings.isAuto, mainModel, demandingModel, settings.askBeforeCloud],
  );
  return { routing, mainModel, demandingModel };
}
