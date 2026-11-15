import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...args: unknown[]) => fetchMock(...args) }));

const { loadedContextWindow } = await import("./ollamaModels");

const config = { baseUrl: "http://localhost:11434", apiKey: "" };

// An Ollama that never answers: the request only ends when it is aborted, at once if it already was, like fetch
function hangs(_url: string, init: RequestInit) {
  return new Promise((_, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    if (init.signal?.aborted) abort();
    init.signal?.addEventListener("abort", abort);
  });
}

describe("loadedContextWindow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("reads the context Ollama loaded for the model", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: "qwen3:8b", context_length: 32768 }] }), { status: 200 }),
    );
    expect(await loadedContextWindow(config, "qwen3:8b")).toBe(32768);
  });

  it("gives up after a few seconds instead of holding the reply back", async () => {
    fetchMock.mockImplementation(hangs);
    const loaded = loadedContextWindow(config, "qwen3:8b");
    await vi.advanceTimersByTimeAsync(3000);
    expect(await loaded).toBeUndefined();
  });

  it("stops at once when the reply is stopped", async () => {
    fetchMock.mockImplementation(hangs);
    const reply = new AbortController();
    const loaded = loadedContextWindow(config, "qwen3:8b", reply.signal);
    reply.abort();
    expect(await loaded).toBeUndefined();
  });
});
