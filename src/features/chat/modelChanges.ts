import type { Message } from "@/shared/types";

// Where the conversation goes on with another model: the reply's question (or the reply, if it has none) gets a line
// with the new model's name. The first reply sets the model and gets none.
export function modelChangesOf(messages: Pick<Message, "role" | "model">[]): Map<number, string> {
  const changes = new Map<number, string>();
  let previous: string | undefined;
  messages.forEach((m, i) => {
    if (m.role !== "assistant" || !m.model) return;
    if (previous && m.model !== previous) changes.set(messages[i - 1]?.role === "user" ? i - 1 : i, m.model);
    previous = m.model;
  });
  return changes;
}
