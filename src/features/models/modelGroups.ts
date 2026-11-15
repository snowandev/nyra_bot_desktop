import { PROVIDERS } from "@/providers";
import { i18n } from "@/shared/i18n/i18n";
import type { Model } from "@/shared/types";
import { foldForSearch } from "@/shared/lib/search";

// From this many models on, the menu gets a search field and a "Recientes" section; below it they'd be noise
export const LONG_MENU = 9;
const MAX_RECENT = 3;

type ModelGroup = { providerId: string; label: string; models: Model[] };

// The model in use stays even if hidden, so the menu always shows what is selected
export function menuModels(models: Model[], hiddenIds: string[], selectedId: string) {
  return models.filter((m) => m.id === selectedId || !hiddenIds.includes(m.id));
}

export function matchesQuery(model: Model, query: string) {
  const folded = foldForSearch(query.trim());
  return !folded || [model.name, model.id, model.description].some((text) => foldForSearch(text).includes(folded));
}

// In the order of PROVIDERS, so local models come before cloud ones
export function groupByProvider(models: Model[]): ModelGroup[] {
  return PROVIDERS.flatMap((provider) => {
    const own = models.filter((m) => m.providerId === provider.id);
    const label = i18n.t(provider.requiresApiKey ? "models.groups.cloud" : "models.groups.local", { name: provider.name });
    return own.length > 0 ? [{ providerId: provider.id, label, models: own }] : [];
  });
}

// The default model first, then the latest picks
export function recentModels(models: Model[], recentIds: string[], defaultId: string | null) {
  const ids = [...new Set([...(defaultId ? [defaultId] : []), ...recentIds])];
  return ids.flatMap((id) => models.find((m) => m.id === id) ?? []).slice(0, MAX_RECENT);
}
