import type { Message } from "@/shared/types";

// Notes for the model (the date, the rules reminder, how to search…) go at the end of the latest user message:
// models weigh recent text most, and unlike a mid-conversation system message, every model template and provider
// accepts it (as a system message it would also replace the SYSTEM prompt of a custom Ollama model). Never stored.
// The note can depend on that message, and nothing is added when it comes out empty.
export function appendToLastUserMessage(
  messages: Message[],
  note: string | ((last: Message) => string | null | undefined),
): Message[] {
  const last = messages[messages.length - 1];
  if (last?.role !== "user") return messages;
  const text = typeof note === "string" ? note : note(last);
  if (!text) return messages;
  return [...messages.slice(0, -1), { ...last, content: `${last.content}\n\n${text}` }];
}
