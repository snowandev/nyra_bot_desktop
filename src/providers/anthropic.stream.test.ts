import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Model } from "@/shared/types";

// Stands in for the Messages API: the provider's requests go through Tauri's fetch, replaced here by one that
// records the request and answers with server-sent events or a JSON error, as the real API does
type Reply = { status: number; body: string; contentType: string };
let reply: Reply;
let lastRequest: { url: string; headers: Headers; body: Record<string, unknown> };

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const text = await request.text();
    lastRequest = { url: request.url, headers: request.headers, body: text ? JSON.parse(text) : {} };
    return new Response(reply.body, { status: reply.status, headers: { "content-type": reply.contentType } });
  },
}));

const { anthropic, missingKey } = await import("./anthropic");

const model: Model = {
  id: "claude-opus-5-5",
  name: "Claude Opus 5.5",
  description: "",
  providerId: "anthropic",
  contextWindow: 1_000_000,
  maxOutputTokens: 128_000,
};
const config = { baseUrl: "https://api.anthropic.test", apiKey: "sk-ant-test" };
const signal = () => new AbortController().signal;

function stream(stopReason: string, extra: object = {}): Reply {
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: null,
        usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hola" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: ", Julián" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stopReason, ...extra }, usage: { output_tokens: 5 } },
    { type: "message_stop" },
  ];
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return { status: 200, body, contentType: "text/event-stream" };
}

const jsonReply = (status: number, value: object): Reply => ({
  status,
  body: JSON.stringify(value),
  contentType: "application/json",
});

beforeEach(() => {
  reply = stream("end_turn");
});

describe("anthropic.chat", () => {
  it("streams the text and reports the tokens, cached input included", async () => {
    const tokens: string[] = [];
    const usage = await anthropic.chat(config, model, {
      messages: [{ role: "user", content: "Hola" }],
      system: "Breve",
      onToken: (t) => tokens.push(t),
      signal: signal(),
    });
    expect(tokens).toEqual(["Hola", ", Julián"]);
    expect(usage).toEqual({ inputTokens: 100, outputTokens: 5, contextWindow: 1_000_000 });
  });

  it("sends the key, the system prompt, caching and the default fallback", async () => {
    await anthropic.chat(config, model, {
      messages: [{ role: "user", content: "Hola" }],
      system: "Reglas",
      onToken: () => {},
      signal: signal(),
    });
    expect(lastRequest.url).toContain("https://api.anthropic.test/v1/messages");
    expect(lastRequest.headers.get("x-api-key")).toBe("sk-ant-test");
    expect(lastRequest.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(lastRequest.body).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 64_000,
      system: "Reglas",
      stream: true,
      cache_control: { type: "ephemeral" },
      fallbacks: "default",
    });
  });

  it("doesn't ask for a fallback on models that don't take one", async () => {
    const haiku = { ...model, id: "claude-haiku-4-5", maxOutputTokens: 64_000 };
    await anthropic.chat(config, haiku, {
      messages: [{ role: "user", content: "Hola" }],
      onToken: () => {},
      signal: signal(),
    });
    expect(lastRequest.body.fallbacks).toBeUndefined();
    expect(lastRequest.body.system).toBeUndefined();
    expect(lastRequest.headers.get("anthropic-beta")).toBeNull();
  });

  it("turns a refusal into a clear error", async () => {
    reply = stream("refusal", { stop_details: { type: "refusal", category: "cyber" } });
    const chat = anthropic.chat(config, model, {
      messages: [{ role: "user", content: "…" }],
      onToken: () => {},
      signal: signal(),
    });
    await expect(chat).rejects.toThrow("no ha querido responder");
  });

  it("explains an invalid key in Spanish", async () => {
    reply = jsonReply(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
    const chat = anthropic.chat(config, model, {
      messages: [{ role: "user", content: "Hola" }],
      onToken: () => {},
      signal: signal(),
    });
    await expect(chat).rejects.toThrow("La API Key de Anthropic no es válida.");
  });

  it("asks for the key before sending anything", async () => {
    const chat = anthropic.chat({ ...config, apiKey: " " }, model, {
      messages: [],
      onToken: () => {},
      signal: signal(),
    });
    await expect(chat).rejects.toThrow(missingKey());
  });
});

describe("anthropic.listModels", () => {
  it("lists the account's models, each read by toModel", async () => {
    reply = jsonReply(200, {
      data: [
        {
          type: "model",
          id: "claude-opus-5-5",
          display_name: "Claude Opus 5.5",
          created_at: "2026-01-01T00:00:00Z",
          max_input_tokens: 1_000_000,
          max_tokens: 128_000,
          capabilities: { image_input: { supported: true } },
        },
      ],
      has_more: false,
      first_id: "claude-opus-5-5",
      last_id: "claude-opus-5-5",
    });
    const models = await anthropic.listModels(config);
    expect(lastRequest.url).toContain("https://api.anthropic.test/v1/models");
    expect(lastRequest.headers.get("x-api-key")).toBe("sk-ant-test");
    expect(models.map((m) => m.id)).toEqual(["claude-opus-5-5"]);
  });
});
