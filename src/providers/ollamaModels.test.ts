import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OllamaConnectionError } from "./ollamaApi";

const fetchMock = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...args: unknown[]) => fetchMock(...args) }));

const {
  chatModelsOf,
  chooseEmbeddingModel,
  embeddingQuery,
  isValidModelName,
  loadedContextWindow,
  phaseOf,
  pullErrorKind,
} = await import("./ollamaModels");

describe("chooseEmbeddingModel", () => {
  const installed = ["nomic-embed-text", "qwen3-embedding:0.6b", "bge-m3"];

  it("uses the one the user chose while it is installed", () => {
    expect(chooseEmbeddingModel(installed, "bge-m3")).toBe("bge-m3");
  });

  it("otherwise prefers qwen3-embedding, then any other, then none", () => {
    expect(chooseEmbeddingModel(installed, null)).toBe("qwen3-embedding:0.6b");
    expect(chooseEmbeddingModel(installed, "borrado")).toBe("qwen3-embedding:0.6b");
    expect(chooseEmbeddingModel(["bge-m3"], null)).toBe("bge-m3");
    expect(chooseEmbeddingModel([], "bge-m3")).toBeNull();
  });
});

describe("embeddingQuery", () => {
  it("puts the task before the question for Qwen3-Embedding only", () => {
    expect(embeddingQuery("qwen3-embedding:0.6b", "¿dónde se guardan las claves?")).toBe(
      "Instruct: Retrieve the code that answers the question\nQuery: ¿dónde se guardan las claves?",
    );
    expect(embeddingQuery("nomic-embed-text", "¿dónde?")).toBe("¿dónde?");
  });
});

describe("isValidModelName", () => {
  it("accepts names, tags, namespaces and registries", () => {
    for (const name of ["qwen3:8b", "llama3.2", "nomic-embed-text", "hf.co/bartowski/Llama-3.2-3B:Q4_K_M"]) {
      expect(isValidModelName(name)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    for (const name of ["", " qwen3", "qwen3 8b", "qwen3:8b:x", ":8b", "../x"]) {
      expect(isValidModelName(name)).toBe(false);
    }
  });
});

describe("pullErrorKind", () => {
  it("explains what went wrong from Ollama's message", () => {
    expect(pullErrorKind(new Error("pull model manifest: file does not exist"))).toBe("not-found");
    expect(pullErrorKind(new Error("write /models/blobs/x: no space left on device"))).toBe("disk");
    expect(pullErrorKind(new OllamaConnectionError())).toBe("connection");
    expect(pullErrorKind(new Error("algo raro"))).toBe("other");
  });
});

it("leaves embedding models out of the chat", () => {
  const models = chatModelsOf([
    { name: "qwen3:8b", size: 5.2e9, parameterSize: "8.2B", supportsImages: false, isEmbedding: false },
    { name: "nomic-embed-text", size: 274e6, isEmbedding: true },
  ]);
  expect(models.map((m) => m.id)).toEqual(["qwen3:8b"]);
  expect(models[0].description).toBe("Ollama · 8.2B");
});

it("tells Ollama's pull phases apart, whatever the wording of the layer lines", () => {
  expect(phaseOf({ status: "pulling manifest" })).toBe("preparing");
  expect(phaseOf({ status: "pulling 6a0746a1ec1a", digest: "sha256:6a07" })).toBe("downloading");
  expect(phaseOf({ status: "downloading sha256:6a07", digest: "sha256:6a07" })).toBe("downloading");
  expect(phaseOf({ status: "verifying sha256 digest" })).toBe("verifying");
  expect(phaseOf({ status: "writing manifest" })).toBe("writing");
});

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
