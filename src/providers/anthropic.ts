import type Anthropic from "@anthropic-ai/sdk";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { contentWithTextFiles, imageInputsOf } from "@/features/attachments/attachments";
import { i18n } from "@/shared/i18n/i18n";
import { contextSize } from "@/shared/lib/format";
import type { Message, Model, ProviderConfig } from "@/shared/types";
import type { Provider } from "./types";
import { loadOnce } from "@/shared/lib/loadOnDemand";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
// Enough for long answers; streaming keeps a large value from hitting request timeouts
const MAX_REPLY_TOKENS = 64_000;
// When the model list didn't say, a value every Claude model accepts
const FALLBACK_REPLY_TOKENS = 8_192;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

// Models whose safety classifiers can decline a message; "default" lets Anthropic retry it on the model it
// recommends for that kind of refusal, instead of the reply just stopping
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

const NAME = "Anthropic";

export const missingKey = () => i18n.t("providers.missingKey", { name: NAME });

type Sdk = typeof Anthropic;

// Loaded the first time Claude is used, so starting Nyra doesn't wait for it
const loadSdk = loadOnce<Sdk>(() => import("@anthropic-ai/sdk").then((module) => module.default));

async function clientFor(config: ProviderConfig) {
  const apiKey = config.apiKey.trim();
  if (!apiKey) throw new Error(missingKey());
  const Anthropic = await loadSdk();
  return new Anthropic({
    apiKey,
    baseURL: config.baseUrl.trim().replace(/\/+$/, "") || DEFAULT_BASE_URL,
    // Through Tauri's HTTP plugin, like Ollama: the request leaves from Rust, so the WebView's CSP stays closed
    fetch: tauriFetch,
    // The key is the user's own and only goes to Anthropic; the SDK's warning is about shipping a server key to a page
    dangerouslyAllowBrowser: true,
  });
}

export function toModel(info: Anthropic.ModelInfo): Model {
  // Only what the list says, and a proxy may leave some out: unknown leaves images allowed but unmarked
  const capabilities = info.capabilities ?? undefined;
  const supportsImages = capabilities?.image_input?.supported;
  const context = info.max_input_tokens ?? undefined;
  return {
    id: info.id,
    name: info.display_name,
    description: ["Claude", context && i18n.t("providers.contextOf", { size: contextSize(context) })]
      .filter(Boolean)
      .join(" · "),
    providerId: "anthropic",
    supportsImages,
    readsFiles: capabilities?.pdf_input?.supported,
    thinks: capabilities?.thinking?.supported,
    contextWindow: context,
    maxOutputTokens: info.max_tokens ?? undefined,
  };
}

const isImageType = (mimeType: string): mimeType is ImageType => (IMAGE_TYPES as readonly string[]).includes(mimeType);

// Images first and then the text, as Claude reads them best. Empty messages are left out: the API rejects them.
export function toClaudeMessages(messages: Message[]): Anthropic.Beta.BetaMessageParam[] {
  return messages.flatMap((m): Anthropic.Beta.BetaMessageParam[] => {
    const text = contentWithTextFiles(m);
    if (m.role === "assistant") return text.trim() ? [{ role: "assistant", content: text }] : [];
    const images = imageInputsOf(m).flatMap(({ data, mimeType }): Anthropic.Beta.BetaImageBlockParam[] =>
      isImageType(mimeType) ? [{ type: "image", source: { type: "base64", media_type: mimeType, data } }] : [],
    );
    const content = [...images, ...(text.trim() ? [{ type: "text" as const, text }] : [])];
    return content.length > 0 ? [{ role: "user", content }] : [];
  });
}

// The SDK's typed errors, most specific first, turned into something the user can act on
export function claudeErrorMessage(error: unknown, Anthropic: Sdk): string {
  const name = NAME;
  if (error instanceof Anthropic.AuthenticationError) return i18n.t("providers.invalidKey", { name });
  if (error instanceof Anthropic.PermissionDeniedError) return i18n.t("providers.forbidden", { name });
  if (error instanceof Anthropic.NotFoundError) return i18n.t("providers.anthropic.notFound");
  if (error instanceof Anthropic.RateLimitError) return i18n.t("providers.rateLimit", { name });
  if (error instanceof Anthropic.BadRequestError) {
    return i18n.t("providers.rejectedDetail", { name, detail: error.message });
  }
  if (error instanceof Anthropic.InternalServerError) return i18n.t("providers.anthropic.overloaded");
  // Before APIError: in this SDK a connection error is a kind of APIError
  if (error instanceof Anthropic.APIConnectionError) return i18n.t("providers.connectionCloud", { name });
  if (error instanceof Anthropic.APIError) return i18n.t("providers.replyError", { name, detail: error.message });
  return error instanceof Error ? error.message : String(error);
}

function refusalMessage(category: string | null | undefined) {
  return category
    ? i18n.t("providers.anthropic.refusalReason", { reason: category })
    : i18n.t("providers.anthropic.refusal");
}

export const anthropic: Provider = {
  id: "anthropic",
  name: NAME,
  get description() {
    return i18n.t("providers.anthropic.description");
  },
  defaultBaseUrl: DEFAULT_BASE_URL,
  // Never sent to Anthropic: a working limit so long conversations get summarized before they grow costly
  supportsContextLength: true,
  loadsContextLength: false,
  requiresApiKey: true,

  async listModels(config) {
    try {
      const models: Model[] = [];
      for await (const info of (await clientFor(config)).models.list()) models.push(toModel(info));
      return models;
    } catch (e) {
      throw new Error(claudeErrorMessage(e, await loadSdk()), { cause: e });
    }
  },

  async chat(config, model, { messages, system, onToken, signal }) {
    const withFallback = FALLBACK_MODELS.has(model.id);
    try {
      const stream = (await clientFor(config)).beta.messages.stream(
        {
          model: model.id,
          max_tokens: Math.min(MAX_REPLY_TOKENS, model.maxOutputTokens ?? FALLBACK_REPLY_TOKENS),
          messages: toClaudeMessages(messages),
          ...(system && { system }),
          // The whole history is sent with every message; caching it makes each new turn much cheaper
          cache_control: { type: "ephemeral" },
          ...(withFallback && { betas: [FALLBACK_BETA], fallbacks: "default" as const }),
        },
        { signal },
      );
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") onToken(event.delta.text);
      }
      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") throw new Error(refusalMessage(message.stop_details?.category));

      const { usage } = message;
      return {
        // Cached input still takes up context
        inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
        outputTokens: usage.output_tokens,
        contextWindow: model.contextWindow,
      };
    } catch (e) {
      if (signal.aborted) throw e;
      throw new Error(claudeErrorMessage(e, await loadSdk()), { cause: e });
    }
  },
};
