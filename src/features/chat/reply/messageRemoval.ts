import type { ConversationSummary, Message } from "@/shared/types";
import { summaryStillValid } from "./summary";

// What is left of a conversation once a user message goes, with the reply that answers it (all its versions)

// Later messages may send one of its files again by id; without the file that reference points to nothing
function withoutReferencesTo(messages: Message[], ids: Set<string>) {
  return messages.map((m) => {
    if (!m.references?.some((id) => ids.has(id))) return m;
    const references = m.references.filter((id) => !ids.has(id));
    const rest = { ...m };
    delete rest.references;
    return references.length > 0 ? { ...rest, references } : rest;
  });
}

// null when the index isn't a user message. A summary that covered it no longer describes the conversation, so it
// goes and is made again when needed; one that starts before it stays as it was.
export function withoutUserMessage(messages: Message[], summary: ConversationSummary | undefined, index: number) {
  if (messages[index]?.role !== "user") return null;
  const count = messages[index + 1]?.role === "assistant" ? 2 : 1;
  const removed = messages.slice(index, index + count);
  const ids = new Set(removed.flatMap((m) => m.attachments?.map((a) => a.id) ?? []));
  const kept = [...messages.slice(0, index), ...messages.slice(index + count)];
  return {
    messages: ids.size > 0 ? withoutReferencesTo(kept, ids) : kept,
    summary: summaryStillValid(summary, index),
    // The message never got a reply, e.g. its file didn't fit: its text can go back to the composer
    wasUnanswered: count === 1,
  };
}
