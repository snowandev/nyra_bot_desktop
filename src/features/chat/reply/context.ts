import type { Message, Model, ProviderConfig } from "@/shared/types";
import { formatShare } from "@/shared/lib/format";
import { configForModel } from "./modelRequest";

type ContextLevel = "normal" | "high" | "critical";

// Where the context a model works with comes from: the size set in Settings (Ollama loads exactly that), the one Ollama
// loaded the model with when the size is left automatic (it picks it from the memory free at that moment, tested with
// 0.40.4: 262,144 for a model loaded alone, 32,768 for another loaded beside it), or a cloud model's maximum
type ContextSource = "configured" | "loaded" | "maximum";

export type ContextLimit = {
  limit: number;
  source: ContextSource;
};

export type ContextState = ContextLimit & {
  used: number;
  fraction: number;
  percentLabel: string;
  level: ContextLevel;
};

// The context the model really works with. null for a model left automatic that Ollama hasn't loaded yet: its
// context isn't known until then.
export function contextLimitOf(
  model: Model,
  config: ProviderConfig,
  { loadsContext, loaded }: { loadsContext: boolean; loaded?: number },
): ContextLimit | null {
  const max = model.contextWindow;
  const configured = configForModel(config, model).contextLength;
  if (configured) return { limit: configured, source: "configured" };
  if (loadsContext) {
    if (!loaded) return null;
    return { limit: max ? Math.min(loaded, max) : loaded, source: "loaded" };
  }
  return max ? { limit: max, source: "maximum" } : null;
}

// How full the conversation is, from what the latest reply used
export function contextStateOf(messages: Message[], limit: ContextLimit | null): ContextState | null {
  const last = [...messages].reverse().find((m) => m.role === "assistant" && m.usage);
  if (!last?.usage || !limit) return null;
  const fraction = Math.min(1, last.usage.used / limit.limit);
  const level = fraction >= 0.9 ? "critical" : fraction >= 0.75 ? "high" : "normal";
  return { ...limit, used: last.usage.used, fraction, percentLabel: formatShare(fraction), level };
}
