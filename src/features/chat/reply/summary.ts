import type { ConversationSummary, Message, ProposedChange } from "@/shared/types";
import { contentWithTextFiles, imagesOf, withReferencedFiles } from "@/features/attachments/attachments";
import { documentAttachmentsAt } from "@/features/documents/documents";
import { neutralizeAppTags } from "./appTags";

// A reply that leaves this share of the context used starts the summary
export const SUMMARY_TRIGGER = 0.8;
// After summarizing, everything sent to the model must fit in this share of the context
const CONTEXT_BUDGET = 0.5;
// Recent messages kept verbatim may use most of it; the summary gets the rest
const RECENT_BUDGET = 0.35;
// A longer summary stops paying off: past this, keeping messages verbatim says more
const SUMMARY_MAX_TOKENS = 6000;
// Of each file, the summary request carries only the start: enough to describe it, and the request stays fast
const FILE_CHARS_FOR_SUMMARY = 2000;

// Rough figures on the high side, so estimates stay under the budget rather than over it
const CHARS_PER_TOKEN = 3;
export const TOKENS_PER_IMAGE = 768;
const TOKENS_PER_WORD = 2;

const SUMMARY_PREAMBLE =
  "Summary of the earlier part of this conversation. The files it mentions are no longer attached; " +
  "if you need the full content of one, ask the user to reference it again from the Files panel.";

// How the model sees each attached file once part of the conversation has been summarized
export type FileState = "complete" | "summarized" | "referenced";

type SummaryPlan = {
  // First message kept verbatim; everything before it is summarized
  cut: number;
  maxTokens: number;
};

export function estimateTextTokens(text: string) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateTokens(messages: Message[]) {
  return messages.reduce(
    (sum, m) => sum + estimateTextTokens(contentWithTextFiles(m)) + imagesOf(m).length * TOKENS_PER_IMAGE,
    0,
  );
}

function wordsFor(tokens: number) {
  return Math.max(1, Math.floor(tokens / TOKENS_PER_WORD));
}

// Keeps the latest exchanges that fit in the recent budget, or none if even the last one doesn't. Asked for by hand
// (/compact), it keeps only the latest exchange, even when more would fit.
// reservedTokens is what every request carries besides the history (the user's rules and active skills).
export function planSummary(
  messages: Message[],
  summary: ConversationSummary | undefined,
  contextLimit: number,
  reservedTokens = 0,
  byHand = false,
): SummaryPlan | null {
  const budget = Math.floor(contextLimit * CONTEXT_BUDGET) - reservedTokens;
  if (budget <= 0) return null;
  // Same share of the budget for recent messages as without reserved tokens
  const recentBudget = budget * (RECENT_BUDGET / CONTEXT_BUDGET);
  // A referenced file weighs the same as an attached one
  const resolved = withReferencedFiles(messages);
  const start = summary?.fromIndex ?? 0;
  let cut = resolved.length;
  for (let i = resolved.length - 1; i >= start; i--) {
    if (resolved[i].role !== "user") continue;
    if (estimateTokens(resolved.slice(i)) > recentBudget) break;
    cut = i;
    if (byHand) break;
  }
  if (cut <= start) return null;
  const maxTokens = Math.min(SUMMARY_MAX_TOKENS, budget - estimateTokens(resolved.slice(cut)));
  return { cut, maxTokens };
}

// Changing a message the summary covers makes it describe a conversation that no longer exists
export function summaryStillValid(summary: ConversationSummary | undefined, changedIndex: number) {
  return summary && changedIndex >= summary.fromIndex ? summary : undefined;
}

// References are resolved before cutting, because they can point to files in the summarized part
export function historyForModel(messages: Message[], summary: ConversationSummary | undefined): Message[] {
  const resolved = withReferencedFiles(messages);
  if (!summary) return resolved;
  const preamble: Message = { role: "user", content: `${SUMMARY_PREAMBLE}\n\n${summary.text}` };
  return [preamble, ...resolved.slice(summary.fromIndex)];
}

export function fileStatesOf(messages: Message[], summary: ConversationSummary) {
  const referencedIds = new Set(messages.slice(summary.fromIndex).flatMap((m) => m.references ?? []));
  const states = new Map<string, FileState>();
  messages.forEach((m, i) =>
    [...(m.attachments ?? []), ...documentAttachmentsAt(m, i)].forEach((a) => {
      const state = i >= summary.fromIndex ? "complete" : referencedIds.has(a.id) ? "referenced" : "summarized";
      states.set(a.id, state);
    }),
  );
  return states;
}

export const SUMMARY_SYSTEM =
  "You write the summary of a conversation between a user and Nyra, an assistant, so the chat can go on with it " +
  "in place of the earlier messages.";

// What the user decided about each change, as the model needs to know it
const CHANGE_OUTCOME: Record<ProposedChange["status"], string> = {
  pending: "proposed, not applied yet",
  applied: "applied",
  discarded: "discarded by the user",
  undone: "applied, then undone by the user",
  noMatch: "could not be applied",
  conflict: "could not be applied",
  protected: "could not be applied",
};

const shortened = (text: string) =>
  text.length <= FILE_CHARS_FOR_SUMMARY ? text : `${text.slice(0, FILE_CHARS_FOR_SUMMARY)}\n[… cut for the summary]`;

// What a reply did in the connected folder, which its text doesn't say: the model only sees it here
function folderActivity(message: Message) {
  const read = message.workspaceConsult?.read.map((r) => r.path) ?? [];
  const changes = (message.workspaceChanges ?? []).map(
    (c) => `${c.kind === "create" ? "create" : "edit"} ${c.path} (${CHANGE_OUTCOME[c.status]})`,
  );
  return [
    read.length > 0 && `[Read in the folder: ${read.join(", ")}]`,
    changes.length > 0 && `[Changes to the folder: ${changes.join("; ")}]`,
  ]
    .filter(Boolean)
    .join("\n");
}

// The conversation as one text: files cut to their start, images by name only, reasoning left out
function asText(message: Message) {
  const files = (message.attachments ?? []).map((a) =>
    a.kind === "image" ? `[Image: ${a.name}]` : `[File: ${a.name}]\n${neutralizeAppTags(shortened(a.data))}`,
  );
  const speaker = message.role === "user" ? "[User]" : "[Nyra]";
  return [speaker, ...files, message.content, folderActivity(message)].filter(Boolean).join("\n");
}

// Only the messages since the last summary, which it updates instead of summarizing again: earlier details
// would fade with every round. One plain request, so it fits and is quick even when the context is almost full.
export function summaryRequest(messages: Message[], summary: ConversationSummary | undefined, plan: SummaryPlan) {
  const part = withReferencedFiles(messages).slice(summary?.fromIndex ?? 0, plan.cut);
  const instruction = [
    summary
      ? "Update the previous summary with the new messages. Copy its facts as they are, with every name, number " +
        "and list item, unless a new message changes them; then correct them, and add what is new. Don't shorten " +
        "or reword what still holds."
      : "Summarize the conversation above.",
    "Organize it under short ## headings written in the conversation's language, one for each of these that " +
      "has something to say, in this order:",
    "- what the user wants, in one or two sentences",
    "- facts and decisions: names, numbers, dates, paths, code and choices made, exactly as they were",
    "- what is done and what is under way",
    "- open questions and next steps",
    "- how the user wants things done, if they said so",
    "- only if there were files: each attached file by name with its key content in one line, and the folder's " +
      "files that were read or changed, with what happened to each change",
    `Use at most ${wordsFor(plan.maxTokens)} words; shorter is better. Write it in the conversation's language, ` +
      "without any introduction.",
  ].join("\n");
  const content = [
    summary && `Previous summary:\n${summary.text}`,
    `${summary ? "New messages" : "Conversation"}:\n${part.map(asText).join("\n\n")}`,
    instruction,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
  return [{ role: "user" as const, content }];
}

export function fitsInTokens(text: string, maxTokens: number) {
  return estimateTextTokens(text) <= maxTokens;
}

export function shortenRequest(text: string, maxTokens: number): Message[] {
  const content =
    `Shorten this summary to at most ${wordsFor(maxTokens)} words, keeping the most important facts. ` +
    `Keep its language and reply only with the shortened summary.\n\n${text}`;
  return [{ role: "user", content }];
}

// Last resort when the model ignores the limit: cut at a sentence or line end
export function trimToTokens(text: string, maxTokens: number) {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  const head = text.slice(0, maxChars);
  const end = Math.max(head.lastIndexOf("\n"), head.lastIndexOf(". "));
  return (end > maxChars / 2 ? head.slice(0, end + 1) : head).trim();
}
