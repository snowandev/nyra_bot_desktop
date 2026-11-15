import type { Message } from "@/shared/types";
import { i18n } from "@/shared/i18n/i18n";
import { estimateTokens } from "./summary";

// Keeps a conversation within the maximum context of the model about to reply, e.g. after switching to one with
// a smaller window. Only what is sent is trimmed; the conversation stays whole, so a bigger model gets it all.

// Room left for the reply itself
const REPLY_SHARE = 0.25;
const REPLY_MAX = 4096;

type ContextFit =
  | { kind: "fits" }
  | { kind: "trimmed"; messages: Message[]; omitted: number }
  | { kind: "too-large"; needed: number; budget: number };

// In English, like the rest of what Nyra tells the model
function omittedNote(count: number): Message {
  return {
    role: "user",
    content:
      `[${count} earlier messages of this conversation were left out because they don't fit in this model's ` +
      "context. Don't assume what they said; if something from them is needed, ask the user.]",
  };
}

function replyRoom(limit: number) {
  return Math.min(REPLY_MAX, Math.floor(limit * REPLY_SHARE));
}

// history is what would be sent (with the summary first when hasSummary). Keeps the summary and the latest
// messages that fit, always starting at a user message; drops the summary too only if nothing fits with it.
export function fitToContext(
  history: Message[],
  limit: number | undefined,
  reservedTokens: number,
  hasSummary: boolean,
): ContextFit {
  if (!limit) return { kind: "fits" };
  const budget = limit - reservedTokens - replyRoom(limit);
  if (estimateTokens(history) <= budget) return { kind: "fits" };

  const head = hasSummary ? history.slice(0, 1) : [];
  const rest = hasSummary ? history.slice(1) : history;
  const sizes = rest.map((m) => estimateTokens([m]));
  const noteTokens = estimateTokens([omittedNote(rest.length)]);

  for (const keep of [head, []]) {
    const available = budget - estimateTokens(keep) - noteTokens;
    let used = 0;
    let start = -1;
    for (let i = rest.length - 1; i >= 0; i--) {
      used += sizes[i];
      if (used > available) break;
      if (rest[i].role === "user") start = i;
    }
    if (start >= 0) {
      return { kind: "trimmed", messages: [...keep, omittedNote(start), ...rest.slice(start)], omitted: start };
    }
  }

  const lastUser = rest.map((m) => m.role).lastIndexOf("user");
  return { kind: "too-large", needed: estimateTokens(rest.slice(Math.max(0, lastUser))), budget };
}

export function tooLargeMessage(fit: Extract<ContextFit, { kind: "too-large" }>, modelName: string) {
  return i18n.t("reply.tooLarge", { model: modelName, needed: fit.needed, left: Math.max(0, fit.budget) });
}
