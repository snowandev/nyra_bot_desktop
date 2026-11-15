import type { Provider } from "@/providers/types";
import type { Message, Model, ProviderConfig } from "@/shared/types";
import { withoutPdfImages } from "@/features/attachments/attachments";

// What every request to a model has in common, whether it writes a reply or a summary

// A context larger than the model's maximum would waste memory without being usable
export function configForModel(config: ProviderConfig, model: Model): ProviderConfig {
  const { contextLength } = config;
  if (!contextLength || !model.contextWindow) return config;
  return { ...config, contextLength: Math.min(contextLength, model.contextWindow) };
}

export function messagesForModel(messages: Message[], model: Model) {
  return model.supportsImages === false ? withoutPdfImages(messages) : messages;
}

// For requests whose text is only used once complete, like a summary; they can't be cancelled
export async function completeText(
  provider: Provider,
  config: ProviderConfig,
  model: Model,
  messages: Message[],
  {
    system,
    signal = new AbortController().signal,
    onProgress,
  }: { system?: string; signal?: AbortSignal; onProgress?: () => void } = {},
) {
  let text = "";
  const onToken = (token: string) => {
    text += token;
    onProgress?.();
  };
  await provider.chat(config, model, { messages: messagesForModel(messages, model), system, onToken, signal });
  return text.trim();
}

// Tokens arrive faster than the screen refreshes; they are handed over at most once per frame
export function frameBuffer(onText: (text: string) => void) {
  let buffered = "";
  let frame = 0;
  const flush = () => {
    frame = 0;
    if (buffered) onText(buffered);
    buffered = "";
  };
  return {
    push(text: string) {
      buffered += text;
      if (!frame) frame = requestAnimationFrame(flush);
    },
    // Drops text not painted yet, for a request that takes back what it said
    discard() {
      buffered = "";
    },
    // Hands over whatever is left right away
    end() {
      cancelAnimationFrame(frame);
      flush();
    },
  };
}

// Whatever is left when the request ends (or fails) is delivered too
export async function deliverByFrame<T>(
  request: (onToken: (token: string) => void, discardPending: () => void) => Promise<T>,
  onText: (text: string) => void,
) {
  const buffer = frameBuffer(onText);
  let received = false;
  try {
    const result = await request((token) => {
      received = true;
      buffer.push(token);
    }, buffer.discard);
    return { result, received };
  } finally {
    buffer.end();
  }
}
