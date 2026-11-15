import { i18n } from "@/shared/i18n/i18n";

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// Ollama out of GPU or system memory, whatever the runner (llama.cpp, MLX) and system call it
export const isOutOfMemory = (message: string) =>
  /insufficient memory|out of memory|outofmemory|failed to allocate|cudaMalloc failed|not enough memory/i.test(message);

export function outOfMemoryMessage(modelName: string, withFolder: boolean) {
  return i18n.t(withFolder ? "lib.outOfMemoryFolder" : "lib.outOfMemory", { model: modelName });
}
