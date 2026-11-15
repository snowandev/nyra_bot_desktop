// Ollama has no API to browse its library, so a short list of good starting points is kept here.
// Sizes are the download sizes listed on ollama.com.

// What each one is good for is in the catalog, under models.suggested.purposes.<kind>
export type SuggestedModel = {
  name: string;
  size: number;
  kind: "fast" | "balanced" | "vision" | "code" | "reasoning" | "capable";
};

export const SUGGESTED_MODELS: SuggestedModel[] = [
  { name: "llama3.2:3b", size: 2.0e9, kind: "fast" },
  { name: "qwen3:8b", size: 5.2e9, kind: "balanced" },
  { name: "gemma3:4b", size: 3.3e9, kind: "vision" },
  { name: "qwen2.5-coder:7b", size: 4.7e9, kind: "code" },
  { name: "deepseek-r1:8b", size: 5.2e9, kind: "reasoning" },
  { name: "gemma3:12b", size: 8.1e9, kind: "capable" },
];

// Highlighted when nothing is installed yet: good Spanish and runs with 8 GB of memory
export const FIRST_MODEL = "qwen3:8b";

// What the welcome recommends for the computer's memory: the model has to fit beside the system and the apps. why is
// the key of its reason in the catalog, under welcome.ollama.why.
type MemoryRecommendation = { name: string; size: number; why: "light" | "balanced" | "capable" };

const GIB = 1024 ** 3;

export function recommendedFor(memoryBytes: number | null): MemoryRecommendation {
  if (memoryBytes !== null && memoryBytes < 12 * GIB) return { name: "qwen3:4b", size: 2.5e9, why: "light" };
  if (memoryBytes !== null && memoryBytes >= 24 * GIB) return { name: "gemma3:12b", size: 8.1e9, why: "capable" };
  return { name: FIRST_MODEL, size: 5.2e9, why: "balanced" };
}

// Offered when there is no embedding model: small, many languages, and the one searching by meaning prefers
export const RECOMMENDED_EMBEDDING_MODEL = { name: "qwen3-embedding:0.6b", size: 6.39e8 };

export const OLLAMA_LIBRARY_URL = "https://ollama.com/library";
export const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";
