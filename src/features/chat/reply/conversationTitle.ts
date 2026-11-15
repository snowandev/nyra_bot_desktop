import type { Message } from "@/shared/types";
import { shortened } from "@/shared/lib/format";

// Enough to know what the conversation is about; a long paste would only make the request slower
const EXCERPT_CHARS = 2000;
const MAX_TITLE_CHARS = 60;

const excerpt = (text: string) => shortened(text, EXCERPT_CHARS);

// In English, which models follow most reliably; the title itself comes out in the conversation's language
export function titleRequest(question: string, answer: string): Message[] {
  const content = [
    "Write a title for this conversation: 2 to 6 words naming its topic, in the same language as the user's " +
      "message. Reply with only the title: no quotes, no final period, no markdown.",
    "<user-message>",
    excerpt(question),
    "</user-message>",
    "<assistant-reply>",
    excerpt(answer),
    "</assistant-reply>",
  ].join("\n");
  return [{ role: "user", content }];
}

// Models add quotes, a "Título:" label or markdown even when asked not to; null when nothing usable is left
export function cleanTitle(text: string): string | null {
  const line =
    text
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  const title = line
    .replace(/^(?:t[ií]tulo|title)\s*:\s*/i, "")
    .replace(/[*_#`]/g, "")
    .replace(/^["'«“‘\s]+|["'»”’\s.]+$/g, "")
    .trim();
  if (!title) return null;
  const chars = Array.from(title);
  return chars.length > MAX_TITLE_CHARS ? `${chars.slice(0, MAX_TITLE_CHARS).join("").trimEnd()}…` : title;
}
