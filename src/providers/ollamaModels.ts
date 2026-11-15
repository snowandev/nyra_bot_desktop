import type { Model, ProviderConfig } from "@/shared/types";
import { endpoint, headers } from "./http";
import { i18n } from "@/shared/i18n/i18n";
import { OllamaConnectionError, OllamaError, readJsonLines, request } from "./ollamaApi";

// Managing the models installed in Ollama: what is there, downloading, deleting and unloading from memory

export type InstalledModel = {
  name: string;
  // Bytes on disk
  size: number;
  // As Ollama writes them: "8.2B", "Q4_K_M"
  parameterSize?: string;
  quantization?: string;
  supportsImages?: boolean;
  thinks?: boolean;
  // Embedding models turn text into vectors; they can't chat
  isEmbedding: boolean;
  contextWindow?: number;
};

export type LoadedModel = {
  name: string;
  // Bytes of RAM/VRAM it takes while loaded
  memory: number;
  // When Ollama unloads it on its own if unused
  expiresAt?: string;
};

type TagsResponse = {
  models: {
    name: string;
    size?: number;
    details?: { family?: string; parameter_size?: string; quantization_level?: string };
  }[];
};

type ShowResponse = {
  capabilities?: string[];
  model_info?: Record<string, unknown>;
};

type PsResponse = {
  models: { name: string; size_vram?: number; size?: number; expires_at?: string; context_length?: number }[];
};

type PullLine = {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
};

// Older Ollama versions don't report capabilities; the name and family are the fallback
export const looksLikeEmbedding = (name: string, family?: string) =>
  name.includes("embed") || family === "bert" || family === "nomic-bert";

// Older Ollama versions don't report these details; leave them unknown instead of failing
async function modelDetails(config: ProviderConfig, model: string) {
  try {
    const res = await request(endpoint(config, "/api/show"), {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({ model }),
    });
    const data = (await res.json()) as ShowResponse;
    const maxContext = Object.entries(data.model_info ?? {}).find(([key]) => key.endsWith(".context_length"))?.[1];
    return {
      capabilities: data.capabilities,
      contextWindow: typeof maxContext === "number" ? maxContext : undefined,
    };
  } catch {
    return {};
  }
}

export async function listInstalledModels(config: ProviderConfig): Promise<InstalledModel[]> {
  const res = await request(endpoint(config, "/api/tags"), { headers: headers(config) });
  const data = (await res.json()) as TagsResponse;
  return Promise.all(
    data.models.map(async (m) => {
      const { capabilities, contextWindow } = await modelDetails(config, m.name);
      return {
        name: m.name,
        size: m.size ?? 0,
        parameterSize: m.details?.parameter_size,
        quantization: m.details?.quantization_level,
        supportsImages: capabilities ? capabilities.includes("vision") : undefined,
        thinks: capabilities?.includes("thinking"),
        isEmbedding: capabilities ? capabilities.includes("embedding") : looksLikeEmbedding(m.name, m.details?.family),
        contextWindow,
      };
    }),
  );
}

// The models the chat can use
export function chatModelsOf(installed: InstalledModel[]): Model[] {
  return installed
    .filter((m) => !m.isEmbedding)
    .map((m) => ({
      id: m.name,
      name: m.name,
      description: ["Ollama", m.parameterSize].filter(Boolean).join(" · "),
      providerId: "ollama",
      supportsImages: m.supportsImages,
      contextWindow: m.contextWindow,
      thinks: m.thinks,
    }));
}

// Shown next to the connection status; older versions without this endpoint just don't show it
export async function ollamaVersion(config: ProviderConfig) {
  try {
    const res = await request(endpoint(config, "/api/version"), { headers: headers(config) });
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

export async function listLoadedModels(config: ProviderConfig): Promise<LoadedModel[]> {
  const res = await request(endpoint(config, "/api/ps"), { headers: headers(config) });
  const data = (await res.json()) as PsResponse;
  return data.models.map((m) => ({ name: m.name, memory: m.size_vram ?? m.size ?? 0, expiresAt: m.expires_at }));
}

// The loaded model's real context can be smaller than its maximum (OLLAMA_CONTEXT_LENGTH, num_ctx)
// Only a hint for sizing the folder's room: an Ollama that is slow to answer doesn't hold the reply back
const LOADED_CONTEXT_TIMEOUT_MS = 3000;

export async function loadedContextWindow(config: ProviderConfig, model: string, signal?: AbortSignal) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  const timer = setTimeout(stop, LOADED_CONTEXT_TIMEOUT_MS);
  signal?.addEventListener("abort", stop);
  try {
    const res = await request(endpoint(config, "/api/ps"), { headers: headers(config), signal: controller.signal });
    const data = (await res.json()) as PsResponse;
    return data.models.find((m) => m.name === model)?.context_length;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}

// "nombre" or "nombre:etiqueta", also with a namespace or a registry ("hf.co/usuario/modelo:Q4_K_M")
export const isValidModelName = (name: string) => /^[A-Za-z0-9][A-Za-z0-9._\-/]*(:[A-Za-z0-9._-]+)?$/.test(name);

export type PullPhase = "preparing" | "downloading" | "verifying" | "writing";

export type PullProgress = {
  phase: PullPhase;
  // Bytes, added up over every layer seen so far
  completed: number;
  total: number;
};

// A line about a layer carries its digest; its status text has changed between Ollama versions
// ("pulling 6a0746…", "downloading …"), so the digest is what tells a download apart
export function phaseOf(line: Pick<PullLine, "status" | "digest">): PullPhase {
  const status = line.status ?? "";
  if (line.digest) return "downloading";
  if (status.startsWith("pulling manifest")) return "preparing";
  if (status.startsWith("verifying")) return "verifying";
  return "writing";
}

// Ollama keeps what was downloaded: pulling the same model again after a cancel or an error resumes it
export async function pullModel(
  config: ProviderConfig,
  name: string,
  onProgress: (progress: PullProgress) => void,
  signal: AbortSignal,
) {
  const res = await request(endpoint(config, "/api/pull"), {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify({ model: name, stream: true }),
    signal,
  });
  // A model comes in several layers, each reported on its own
  const layers = new Map<string, { total: number; completed: number }>();
  let succeeded = false;
  try {
    await readJsonLines<PullLine>(res, (line) => {
      if (line.error) throw new OllamaError(line.error);
      const status = line.status ?? "";
      if (status === "success") {
        succeeded = true;
        return;
      }
      if (line.digest && line.total) layers.set(line.digest, { total: line.total, completed: line.completed ?? 0 });
      let completed = 0;
      let total = 0;
      for (const layer of layers.values()) {
        completed += layer.completed;
        total += layer.total;
      }
      onProgress({ phase: phaseOf(line), completed, total });
    });
  } catch (e) {
    if (signal.aborted || e instanceof OllamaError) throw e;
    // The stream broke halfway: Ollama stopped or the network went down
    throw new OllamaConnectionError({ cause: e });
  }
  if (!succeeded && !signal.aborted) throw new OllamaConnectionError();
}

export type PullErrorKind = "not-found" | "disk" | "connection" | "other";

export function pullErrorKind(error: unknown): PullErrorKind {
  if (error instanceof OllamaConnectionError) return "connection";
  const message = error instanceof Error ? error.message : String(error);
  if (/file does not exist|not found|manifest unknown/i.test(message)) return "not-found";
  if (/no space left/i.test(message)) return "disk";
  return "other";
}

export async function deleteModel(config: ProviderConfig, name: string) {
  await request(endpoint(config, "/api/delete"), {
    method: "DELETE",
    headers: headers(config),
    body: JSON.stringify({ model: name }),
  });
}

// keep_alive 0 tells Ollama to drop it from memory now; it loads again on its own the next time it's used
export async function unloadModel(config: ProviderConfig, name: string) {
  await request(endpoint(config, "/api/generate"), {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify({ model: name, keep_alive: 0, stream: false }),
  });
}

// Embedding models installed, the one to search folders by meaning with: Qwen3's first (it was tested, also with
// questions in Spanish about code in English), else any. null when there is none or Ollama doesn't answer.
// The one the user chose if it is still installed; otherwise qwen3-embedding, which finds best, or any other
export function chooseEmbeddingModel(installed: string[], preferred: string | null) {
  if (preferred && installed.includes(preferred)) return preferred;
  return installed.find((name) => name.startsWith("qwen3-embedding")) ?? installed[0] ?? null;
}

export const embeddingModelsOf = (installed: InstalledModel[]) => installed.filter((m) => m.isEmbedding);

export async function embeddingModelOf(config: ProviderConfig, preferred: string | null) {
  try {
    const installed = embeddingModelsOf(await listInstalledModels(config)).map((m) => m.name);
    return chooseEmbeddingModel(installed, preferred);
  } catch {
    return null;
  }
}

// Qwen3-Embedding finds better with a task written in English before the question, never before the files' fragments
// (its model card; on this project it put the right file first more often)
export const embeddingQuery = (model: string, question: string) =>
  model.startsWith("qwen3-embedding") ? `Instruct: Retrieve the code that answers the question\nQuery: ${question}` : question;

// One vector per text, in the same order
export async function embed(config: ProviderConfig, model: string, texts: string[], signal?: AbortSignal) {
  const res = await request(endpoint(config, "/api/embed"), {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify({ model, input: texts }),
    signal,
  });
  const data = (await res.json()) as { embeddings?: unknown };
  if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) {
    throw new Error(i18n.t("providers.ollama.noEmbeddings"));
  }
  return data.embeddings as number[][];
}
