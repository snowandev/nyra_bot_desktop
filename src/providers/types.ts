import type { ChatUsage, Message, Model, ProviderConfig } from "@/shared/types";

type ChatRequest = {
  messages: Message[];
  // Kept apart from the messages because each API takes it differently (system role, system field…)
  system?: string;
  onToken: (token: string) => void;
  signal: AbortSignal;
  // Only for models that think; without it the reasoning is dropped
  onThinking?: (text: string) => void;
};

export interface Provider {
  id: string;
  name: string;
  description: string;
  defaultBaseUrl: string;
  // Shows "Tamaño del contexto" in Settings. Ollama loads the model with it; a cloud API doesn't take it, so there
  // it only sets when Nyra summarizes and what the context ring measures against
  supportsContextLength: boolean;
  // Ollama loads the model with the size set, and says which one it loaded; elsewhere the size is only Nyra's limit
  loadsContextLength: boolean;
  // Cloud services can't be used without one; for a local server it is optional
  requiresApiKey: boolean;
  listModels(config: ProviderConfig): Promise<Model[]>;
  chat(config: ProviderConfig, model: Model, request: ChatRequest): Promise<ChatUsage | undefined>;
}
