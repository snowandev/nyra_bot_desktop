import { anthropic } from "./anthropic";
import { gemini } from "./gemini";
import { lmStudio } from "./lmStudio";
import { ollama } from "./ollama";
import { openai } from "./openai";
import type { Provider } from "./types";

// Local servers first, then the cloud
export const PROVIDERS: Provider[] = [ollama, lmStudio, anthropic, openai, gemini];

export function getProvider(id: string) {
  return PROVIDERS.find((p) => p.id === id);
}
