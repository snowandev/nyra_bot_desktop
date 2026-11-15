import { expect, it } from "vitest";
import { isOutOfMemory } from "./errors";

it("recognizes Ollama running out of memory, whatever the runner", () => {
  expect(
    isOutOfMemory(
      "Ollama respondió 500: mlx runner failed: panic: mlx: [METAL] Command buffer execution failed: Insufficient Memory (00000008:kIOGPUCommandBufferCallbackErrorOutOfMemory).",
    ),
  ).toBe(true);
  expect(isOutOfMemory("CUDA error: out of memory")).toBe(true);
  expect(isOutOfMemory("llama runner: failed to allocate compute buffers")).toBe(true);
  expect(isOutOfMemory("No se pudo conectar con Ollama. ¿Está abierto?")).toBe(false);
});
