import type { Message } from "@/shared/types";
import { appendToLastUserMessage } from "./messageNotes";

// A model only knows the world up to its training, and has no clock: it is told today's date with every
// message, from this computer's clock and time zone. In English, which models follow most reliably.
export function dateNote(now = new Date()) {
  const date = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [
    "<current-date>",
    `Today is ${date}, ${time} local time (${zone}). Your training data may be older than this date. ` +
      "Do not mention this note.",
    "</current-date>",
  ].join("\n");
}

export const withCurrentDate = (messages: Message[], now = new Date()): Message[] =>
  appendToLastUserMessage(messages, dateNote(now));
