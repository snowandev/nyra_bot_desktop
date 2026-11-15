import { i18n } from "@/shared/i18n/i18n";
import type { Model, ProviderConfig } from "@/shared/types";
import {
  compatibleProvider,
  isChatModelId,
  listCompatibleModels,
  newestFirst,
  send,
  type Service,
  toModel,
} from "./openaiCompatible";

type NativeModel = {
  thinking?: unknown;
  name?: unknown;
  displayName?: unknown;
  inputTokenLimit?: unknown;
  supportedGenerationMethods?: unknown;
};

const COMPATIBLE_PATH = "/openai";

// Chat goes through the OpenAI-compatible address Google offers for Gemini: chat, streaming and images work as
// everywhere
const service: Service = {
  id: "gemini",
  name: "Google Gemini",
  get description() {
    return i18n.t("providers.gemini.description");
  },
  defaultBaseUrl: `https://generativelanguage.googleapis.com/v1beta${COMPATIBLE_PATH}`,
  requiresApiKey: true,
  // Image generation (Nano Banana), robotics, computer use and the custom tools variant don't chat
  isChatModel: (id) => /^(gemini|gemma)/.test(id) && !/banana|robotics|computer-use|customtools/.test(id),
  // Gemini first and the open Gemma models after it, each newest first
  order: (a, b) => Number(a.id.startsWith("gemma")) - Number(b.id.startsWith("gemma")) || newestFirst(a, b),
  // "low" is the least every thinking Gemini takes: some can't stop thinking, and refuse "none"
  lessReasoning: { reasoning_effort: "low" },
  // Google's own list says each model's context and name, and the compatible one doesn't
  listModels: async (config) => (await nativeModels(config).catch(() => null)) ?? listCompatibleModels(config, service),
};

async function nativeModels(config: ProviderConfig): Promise<Model[] | null> {
  const address = config.baseUrl.trim().replace(/\/+$/, "");
  if (!address.endsWith(COMPATIBLE_PATH)) return null;
  const root = {
    ...config,
    baseUrl: address.slice(0, -COMPATIBLE_PATH.length),
  };
  // Google's own API takes the key in its header, not as a bearer token
  const res = await send(root, service, "/models?pageSize=1000", {
    headers: { "x-goog-api-key": config.apiKey.trim() },
  });
  const body: unknown = await res.json();
  if (typeof body !== "object" || !body || !("models" in body) || !Array.isArray(body.models)) return null;
  return body.models
    .flatMap((item: NativeModel) => {
      if (typeof item.name !== "string") return [];
      const id = item.name.replace(/^models\//, "");
      const methods = Array.isArray(item.supportedGenerationMethods) ? item.supportedGenerationMethods : [];
      if (!methods.includes("generateContent") || !isChatModelId(service, id)) return [];
      return [
        toModel(service, id, {
          ...(typeof item.displayName === "string" && {
            name: item.displayName,
          }),
          contextWindow: typeof item.inputTokenLimit === "number" ? item.inputTokenLimit : undefined,
          thinks: item.thinking === true,
        }),
      ];
    })
    .sort(service.order);
}

export const gemini = compatibleProvider(service);
