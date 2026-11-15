import { describe, expect, it, vi } from "vitest";
import type { Message, Model } from "@/shared/types";

// Stands in for a compatible server: the reply arrives in pieces cut anywhere, as over a real network
let pieces: string[] = [];
let status = 200;
let lastBody: Record<string, unknown> = {};

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
    lastBody = init?.body ? JSON.parse(String(init.body)) : {};
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        for (const piece of pieces) controller.enqueue(encoder.encode(piece));
        controller.close();
      },
    });
    return new Response(body, { status });
  },
}));

const { compatibleProvider, modelIdsOf, newestFirst, statusMessage, toChatMessages, toModel } =
  await import("./openaiCompatible");

const service = {
  id: "test",
  name: "Servicio",
  description: "",
  defaultBaseUrl: "https://api.example.test/v1",
  requiresApiKey: true,
};
const provider = compatibleProvider(service);
const config = { baseUrl: "https://api.example.test/v1", apiKey: "sk-test" };
const model: Model = {
  id: "modelo-1",
  name: "modelo-1",
  description: "",
  providerId: "test",
  contextWindow: 128_000,
};
const signal = () => new AbortController().signal;

function events(...chunks: object[]) {
  return [...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`), "data: [DONE]\n\n"].join("");
}

// Cut every few characters, so lines and even JSON split between pieces
const cut = (text: string, size = 7) =>
  Array.from({ length: Math.ceil(text.length / size) }, (_, i) => text.slice(i * size, (i + 1) * size));

describe("toChatMessages", () => {
  it("puts the system first, images as data URLs and leaves empty messages out", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: "¿Qué ves?",
        attachments: [
          {
            id: "a",
            kind: "image",
            name: "foto.png",
            mimeType: "image/png",
            data: "QUJD",
          },
        ],
      },
      { role: "assistant", content: "" },
      { role: "assistant", content: "Un gato." },
    ];
    expect(toChatMessages(messages, "Sé breve.")).toEqual([
      { role: "system", content: "Sé breve." },
      {
        role: "user",
        content: [
          { type: "text", text: "¿Qué ves?" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,QUJD" },
          },
        ],
      },
      { role: "assistant", content: "Un gato." },
    ]);
  });
});

it("reads model ids, without the models/ prefix some services add", () => {
  expect(
    modelIdsOf({
      data: [{ id: "models/gemini-x" }, { id: "gpt-x" }, { name: "sin id" }],
    }),
  ).toEqual(["gemini-x", "gpt-x"]);
  expect(modelIdsOf({ error: "nope" })).toEqual([]);
});

it("lists the newest versions first and aliases without one last", () => {
  const ids = ["gemini-pro-latest", "gemini-2.5-flash", "gemini-3.10-flash", "gemini-3.8-pro", "gemini-3.8-flash"];
  expect(
    ids
      .map((id) => toModel(service, id))
      .sort(newestFirst)
      .map((m) => m.id),
  ).toEqual(["gemini-3.10-flash", "gemini-3.8-flash", "gemini-3.8-pro", "gemini-2.5-flash", "gemini-pro-latest"]);
});

it("explains errors with the service's own message", () => {
  expect(statusMessage(service, 401, "")).toBe("La API Key de Servicio no es válida.");
  expect(statusMessage(service, 400, '[{"error":{"message":"API key not valid"}}]')).toBe(
    "Servicio rechazó la petición: API key not valid",
  );
  expect(statusMessage(service, 404, '{"error":"model not loaded"}')).toBe(
    "Servicio no encuentra ese modelo o esa dirección: model not loaded",
  );
});

describe("chat", () => {
  it("streams text and reasoning split across network pieces, and returns the usage", async () => {
    status = 200;
    pieces = cut(
      events(
        { choices: [{ delta: { reasoning_content: "Pienso" } }] },
        { choices: [{ delta: { content: "Hola" } }] },
        { choices: [{ delta: { content: ", Marta" }, finish_reason: "stop" }] },
        { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } },
      ),
    );
    let text = "";
    let thinking = "";
    const usage = await provider.chat(config, model, {
      messages: [{ role: "user", content: "Hola" }],
      onToken: (t) => (text += t),
      signal: signal(),
      onThinking: (t) => (thinking += t),
    });
    expect(text).toBe("Hola, Marta");
    expect(thinking).toBe("Pienso");
    expect(usage).toEqual({
      inputTokens: 12,
      outputTokens: 3,
      contextWindow: 128_000,
    });
    expect(lastBody).toMatchObject({
      model: "modelo-1",
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("asks a thinking model to think little only when the request asks for no reasoning", async () => {
    status = 200;
    pieces = [events({ choices: [{ delta: { content: "Ok" }, finish_reason: "stop" }] })];
    const thinking = compatibleProvider({ ...service, lessReasoning: { reasoning_effort: "low" } });
    const request = { messages: [{ role: "user" as const, content: "Hola" }], onToken: () => {}, signal: signal() };
    await thinking.chat({ ...config, reasoning: false }, { ...model, thinks: true }, request);
    expect(lastBody).toMatchObject({ reasoning_effort: "low" });
    await thinking.chat(config, { ...model, thinks: true }, { ...request, signal: signal() });
    expect(lastBody).not.toHaveProperty("reasoning_effort");
    await thinking.chat({ ...config, reasoning: false }, model, { ...request, signal: signal() });
    expect(lastBody).not.toHaveProperty("reasoning_effort");
  });

  it("reads events as the spec does: data over several lines, comments, Windows line endings, no blank line at the end", async () => {
    status = 200;
    pieces = cut(
      ': keep-alive\r\n\r\ndata: {"choices":\r\ndata: [{"delta":{"content":"Hola"}}]}\r\n\r\n' +
        'data: {"choices":[{"delta":{"content":" Marta"}}]}',
      5,
    );
    let text = "";
    await provider.chat(config, model, {
      messages: [{ role: "user", content: "Hola" }],
      onToken: (t) => (text += t),
      signal: signal(),
    });
    expect(text).toBe("Hola Marta");
  });

  it("turns an error sent inside the stream into a message", async () => {
    status = 200;
    pieces = [events({ error: { message: "quota exceeded" } })];
    await expect(
      provider.chat(config, model, {
        messages: [{ role: "user", content: "Hola" }],
        onToken: () => {},
        signal: signal(),
      }),
    ).rejects.toThrow("Servicio respondió con un error: quota exceeded");
  });

  it("asks for the key before sending anything", async () => {
    await expect(
      provider.chat({ ...config, apiKey: " " }, model, {
        messages: [{ role: "user", content: "Hola" }],
        onToken: () => {},
        signal: signal(),
      }),
    ).rejects.toThrow("Añade tu API Key de Servicio");
  });
});
