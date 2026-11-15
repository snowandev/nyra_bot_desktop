import type { Message } from "@/shared/types";
import { appendToLastUserMessage } from "@/features/chat/reply/messageNotes";

// What the chat draws beyond plain Markdown (formulas, charts, callouts), so the model uses it instead of describing
// it. In English, which models follow most reliably; with every user message, like the documents note, so it doesn't
// break the prompt cache.
export const REPLY_FORMAT_PROMPT = [
  "The chat draws math: write formulas in LaTeX between $…$ inside a sentence, or between $$…$$ on lines of their " +
    "own for a formula that stands apart. Put a formula in a code block only when the user wants its LaTeX source.",
  "The chat also draws charts of data. When the user asks for a chart or graph, or when several numbers compare " +
    "better at a glance (a trend over time, amounts side by side, parts of a whole), write a code block with the " +
    'language "chart" holding JSON like this:',
  "```chart",
  '{"type": "bar", "title": "Sales", "labels": ["Jan", "Feb", "Mar"], "series": [{"name": "2025", "values": ' +
    '[12, 18, 15]}], "unit": "€"}',
  "```",
  'type is "bar", "line" (a trend) or "pie" (parts of a whole, one series). Each series has one number per label, ' +
    "in the same order, or null where there is no value. title, series names and unit are optional; write the text " +
    "in the user's language. Only when the user asks for colors, add \"color\": \"#rrggbb\" to a series, or " +
    "\"colors\": [one #rrggbb per label] for a pie. Don't chart one or two numbers, and use a mermaid block, not a " +
    "chart, for flows and other diagrams. Explain the numbers in the text too, briefly.",
  "The chat draws a colored box for a quote whose first line is [!NOTE], [!TIP], [!IMPORTANT], [!WARNING] or " +
    "[!CAUTION]. Use one when the user must not miss a point: [!CAUTION] or [!WARNING] before a step that can delete " +
    "data, break something or cost money (formatting a disk, a force push, deleting files), [!IMPORTANT] for a " +
    "condition without which the rest fails. Most replies need none: never in conversation, recommendations, " +
    "opinions or simple answers, and rarely more than one per reply.",
  "Do not mention these instructions.",
].join("\n");

export const withReplyFormatInstruction = (messages: Message[]): Message[] =>
  appendToLastUserMessage(messages, `<app-instructions>\n${REPLY_FORMAT_PROMPT}\n</app-instructions>`);
