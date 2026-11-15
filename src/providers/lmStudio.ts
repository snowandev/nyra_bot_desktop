import { i18n } from "@/shared/i18n/i18n";
import type { Model, ProviderConfig } from "@/shared/types";
import { compatibleProvider, listCompatibleModels, send, type Service, toModel } from "./openaiCompatible";

type NativeModel = { id?: unknown; type?: unknown; max_context_length?: unknown };

const service: Service = {
  id: "lmstudio",
  name: "LM Studio",
  get description() {
    return i18n.t("providers.lmstudio.description");
  },
  defaultBaseUrl: "http://localhost:1234/v1",
  requiresApiKey: false,
  // LM Studio's own list says what each model is, and the compatible one doesn't
  listModels: async (config) => (await nativeModels(config).catch(() => null)) ?? listCompatibleModels(config, service),
};

// LM Studio's own API, next to the compatible one: whether a model reads images, and its context
async function nativeModels(config: ProviderConfig): Promise<Model[] | null> {
  const root = config.baseUrl.trim().replace(/\/+$/, "");
  if (!root.endsWith("/v1")) return null;
  const res = await send({ ...config, baseUrl: root.slice(0, -3) }, service, "/api/v0/models");
  const body: unknown = await res.json();
  if (typeof body !== "object" || !body || !("data" in body) || !Array.isArray(body.data)) return null;
  return body.data.flatMap((item: NativeModel) => {
    if (typeof item.id !== "string" || item.type === "embeddings") return [];
    const context = typeof item.max_context_length === "number" ? item.max_context_length : undefined;
    return [toModel(service, item.id, { contextWindow: context, supportsImages: item.type === "vlm" })];
  });
}

export const lmStudio = compatibleProvider(service);
