import { createParser } from "eventsource-parser";
import { readLines } from "./readLines";
import { fetch } from "@tauri-apps/plugin-http";
import { contentWithTextFiles, imageInputsOf } from "@/features/attachments/attachments";
import { i18n } from "@/shared/i18n/i18n";
import { contextSize } from "@/shared/lib/format";
import type { ChatUsage, Message, Model, ProviderConfig } from "@/shared/types";
import { endpoint, headers, withoutOrigin } from "./http";
import type { Provider } from "./types";

// The chat API that many services speak alike (OpenAI's Chat Completions): one implementation, and each service only
// says where it lives and what sets it apart

export type Service = {
  id: string;
  name: string;
  description: string;
  defaultBaseUrl: string;
  // Cloud services need one; a local server works without
  requiresApiKey: boolean;
  // Which of the listed models chat; the generic filter already drops embeddings, voice and images
  isChatModel?: (id: string) => boolean;
  // What is known of a model besides its id, when the list doesn't say
  describe?: (id: string) => Partial<Model>;
  // A service with a richer list of its own reads that one instead
  listModels?: (config: ProviderConfig) => Promise<Model[]>;
  // How the list is ordered; newest first by default
  order?: (a: Model, b: Model) => number;
  // What asks a model that thinks to think little, when the request asks for no reasoning; without it, nothing is sent
  lessReasoning?: Record<string, unknown>;
};

type ChatPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatPart[];
};

type Chunk = {
  choices?: {
    // DeepSeek-style servers send the reasoning as reasoning_content, others as reasoning
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
    };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: unknown;
};

// Models that don't chat, by the names services give them: embeddings, voice, transcription, images, video, moderation
const NOT_CHAT =
  /embed|tts|whisper|transcribe|audio|realtime|dall-e|gpt-image|-image\b|imagen|veo|moderation|aqa|live/i;

const missingKey = (service: Service) => i18n.t("providers.missingKey", { name: service.name });

const connectionError = (service: Service) =>
  i18n.t(service.requiresApiKey ? "providers.connectionCloud" : "providers.connectionLocal", { name: service.name });

// Services explain errors as { error: { message } }, { error: "…" } or a list of those; plain text is kept as it is
function errorDetailOf(value: unknown): string | undefined {
  const item: unknown = Array.isArray(value) ? value[0] : value;
  if (typeof item !== "object" || !item) return undefined;
  if ("error" in item) {
    const { error } = item;
    if (typeof error === "string") return error;
    if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
      return error.message;
    }
  }
  return "message" in item && typeof item.message === "string" ? item.message : undefined;
}

function errorDetail(body: string) {
  try {
    return errorDetailOf(JSON.parse(body)) ?? body.trim().slice(0, 300);
  } catch {
    return body.trim().slice(0, 300);
  }
}

export function statusMessage(service: Service, status: number, body: string) {
  const { name } = service;
  const detail = errorDetail(body);
  if (status === 401) return i18n.t("providers.invalidKey", { name });
  if (status === 403) return i18n.t(detail ? "providers.forbiddenDetail" : "providers.forbidden", { name, detail });
  if (status === 404) return i18n.t(detail ? "providers.notFoundDetail" : "providers.notFound", { name, detail });
  if (status === 429) return i18n.t("providers.rateLimit", { name });
  if (status >= 500) return i18n.t("providers.serverError", { name });
  return detail ? i18n.t("providers.rejectedDetail", { name, detail }) : i18n.t("providers.rejected", { name, status });
}

export async function send(config: ProviderConfig, service: Service, path: string, init: RequestInit = {}) {
  if (service.requiresApiKey && !config.apiKey.trim()) throw new Error(missingKey(service));
  let res: Response;
  try {
    // A service's own API may authenticate another way: its headers then replace the bearer key
    res = await fetch(endpoint(config, path), withoutOrigin({ ...init, headers: init.headers ?? headers(config) }));
  } catch (e) {
    if (init.signal?.aborted) throw e;
    throw new Error(connectionError(service), { cause: e });
  }
  if (!res.ok) throw new Error(statusMessage(service, res.status, await res.text().catch(() => "")));
  return res;
}

export function toModel(service: Service, id: string, details: Partial<Model> = {}): Model {
  const context = details.contextWindow;
  return {
    id,
    name: id,
    providerId: service.id,
    description: [service.name, context && i18n.t("providers.contextOf", { size: contextSize(context) })]
      .filter(Boolean)
      .join(" · "),
    ...details,
  };
}

// The ids in { data: [{ id }] }; some services name them "models/…"
export function modelIdsOf(body: unknown): string[] {
  if (typeof body !== "object" || !body || !("data" in body) || !Array.isArray(body.data)) return [];
  return body.data.flatMap((item: unknown) =>
    typeof item === "object" && item && "id" in item && typeof item.id === "string"
      ? [item.id.replace(/^models\//, "")]
      : [],
  );
}

export const isChatModelId = (service: Service, id: string) =>
  !NOT_CHAT.test(id) && (service.isChatModel?.(id) ?? true);

// The first version number in an id: "gemini-3.8-flash" → [3, 8]; none for aliases like "gemini-pro-latest"
const versionOf = (id: string) =>
  id
    .match(/\d+(?:\.\d+)*/)?.[0]
    .split(".")
    .map(Number) ?? [];

// Newest version first, aliases without one last: lists keep retired models a new account can't use
export function newestFirst(a: Model, b: Model) {
  const [va, vb] = [versionOf(a.id), versionOf(b.id)];
  if (va.length === 0 || vb.length === 0) return vb.length - va.length || a.id.localeCompare(b.id);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const difference = (vb[i] ?? 0) - (va[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return a.id.localeCompare(b.id);
}

export async function listCompatibleModels(config: ProviderConfig, service: Service) {
  const res = await send(config, service, "/models");
  return modelIdsOf(await res.json())
    .filter((id) => isChatModelId(service, id))
    .map((id) => toModel(service, id, service.describe?.(id)))
    .sort(service.order ?? newestFirst);
}

// Text and images in one message; empty messages are left out, as some services reject them
export function toChatMessages(messages: Message[], system: string | undefined): ChatMessage[] {
  const history = messages.flatMap((m): ChatMessage[] => {
    const text = contentWithTextFiles(m);
    if (m.role === "assistant") return text.trim() ? [{ role: "assistant", content: text }] : [];
    const images = imageInputsOf(m).map(({ data, mimeType }): ChatPart => ({
      type: "image_url",
      image_url: { url: `data:${mimeType};base64,${data}` },
    }));
    if (images.length === 0) return text.trim() ? [{ role: "user", content: text }] : [];
    return [
      {
        role: "user",
        content: [...(text.trim() ? [{ type: "text" as const, text }] : []), ...images],
      },
    ];
  });
  return system ? [{ role: "system", content: system }, ...history] : history;
}

// Server-sent events, read as the spec says (an event's data over several "data:" lines, comments, any line ending);
// "data: [DONE]" at the end. An event the stream ends on without a blank line after it still counts.
async function readEvents(res: Response, onData: (data: string) => void) {
  if (!res.body) return;
  const parser = createParser({ onEvent: (event) => onData(event.data) });
  await readLines(res.body, (line) => parser.feed(`${line}\n`));
  // The spec drops an event with no blank line after it; some compatible servers end that way
  parser.feed("\n");
}

function parseChunk(service: Service, data: string): Chunk {
  try {
    return JSON.parse(data) as Chunk;
  } catch {
    throw new Error(i18n.t("providers.unreadable", { name: service.name }));
  }
}

export function compatibleProvider(service: Service): Provider {
  return {
    id: service.id,
    name: service.name,
    // Read when shown, so it follows the interface's language
    get description() {
      return service.description;
    },
    defaultBaseUrl: service.defaultBaseUrl,
    // Not sent: a working limit, so long conversations get summarized before they outgrow the model
    supportsContextLength: true,
    loadsContextLength: false,
    requiresApiKey: service.requiresApiKey,

    listModels: (config) => (service.listModels ?? ((c) => listCompatibleModels(c, service)))(config),

    async chat(config, model, { messages, system, onToken, signal, onThinking }) {
      const res = await send(config, service, "/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model: model.id,
          messages: toChatMessages(messages, system),
          stream: true,
          // Without it the token count never arrives while streaming
          stream_options: { include_usage: true },
          ...(config.reasoning === false && model.thinks && service.lessReasoning),
        }),
        signal,
      });

      let usage: ChatUsage | undefined;
      let filtered = false;
      await readEvents(res, (data) => {
        if (data === "[DONE]") return;
        const chunk = parseChunk(service, data);
        if (chunk.error) {
          const detail = errorDetailOf(chunk) ?? i18n.t("providers.noDetails");
          throw new Error(i18n.t("providers.replyError", { name: service.name, detail }));
        }
        for (const choice of chunk.choices ?? []) {
          const reasoning = choice.delta?.reasoning_content ?? choice.delta?.reasoning;
          if (reasoning) onThinking?.(reasoning);
          if (choice.delta?.content) onToken(choice.delta.content);
          if (choice.finish_reason === "content_filter") filtered = true;
        }
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
            contextWindow: model.contextWindow,
          };
        }
      });
      if (filtered) throw new Error(i18n.t("providers.filtered", { name: service.name }));
      return usage;
    },
  };
}
