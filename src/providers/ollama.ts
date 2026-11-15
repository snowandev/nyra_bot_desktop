import { i18n } from "@/shared/i18n/i18n";
import { contentWithTextFiles, imagesOf } from "@/features/attachments/attachments";
import type { ChatUsage } from "@/shared/types";
import { endpoint, headers } from "./http";
import { readJsonLines, request } from "./ollamaApi";
import { chatModelsOf, listInstalledModels, loadedContextWindow } from "./ollamaModels";
import type { Provider } from "./types";

type ChatChunk = {
  message?: { content?: string; thinking?: string };
  error?: string;
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
};

export const ollama: Provider = {
  id: "ollama",
  name: "Ollama",
  get description() {
    return i18n.t("providers.ollama.description");
  },
  defaultBaseUrl: "http://localhost:11434",
  supportsContextLength: true,
  loadsContextLength: true,
  requiresApiKey: false,

  async listModels(config) {
    return chatModelsOf(await listInstalledModels(config));
  },

  async chat(config, model, { messages, system, onToken, signal, onThinking }) {
    const chatMessages = messages.map((m) => {
      // Screenshots kept with a reply were already seen when it was written
      const images = m.role === "user" ? imagesOf(m) : [];
      return { role: m.role, content: contentWithTextFiles(m), ...(images.length > 0 && { images }) };
    });
    const res = await request(endpoint(config, "/api/chat"), {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({
        model: model.id,
        // Ollama keeps system messages when it has to drop old ones to fit the context
        messages: system ? [{ role: "system", content: system }, ...chatMessages] : chatMessages,
        stream: true,
        // Without it a thinking model may write its reasoning inside the reply; other models reject the field
        ...(model.thinks && { think: config.reasoning ?? true }),
        // Changing num_ctx makes Ollama reload the model, so only send it when the user set one
        ...(config.contextLength && { options: { num_ctx: config.contextLength } }),
      }),
      signal,
    });

    let usage: ChatUsage | undefined;
    await readJsonLines<ChatChunk>(res, (chunk) => {
      if (chunk.error) throw new Error(chunk.error);
      if (chunk.message?.thinking) onThinking?.(chunk.message.thinking);
      if (chunk.message?.content) onToken(chunk.message.content);
      if (chunk.done) usage = { inputTokens: chunk.prompt_eval_count ?? 0, outputTokens: chunk.eval_count ?? 0 };
    });

    if (!usage) return undefined;
    return { ...usage, contextWindow: await loadedContextWindow(config, model.id) };
  },
};
