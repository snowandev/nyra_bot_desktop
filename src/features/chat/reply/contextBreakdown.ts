import type { ConversationSummary, Message } from "@/shared/types";
import { contentWithTextFiles, imagesOf, withReferencedFiles } from "@/features/attachments/attachments";
import { dateNote } from "./currentDate";
import { memoriesPrompt } from "@/features/memory/memories";
import { type Skill, skillsPrompt, skillTokens } from "@/features/skills/skills";
import { estimateTextTokens, historyForModel, TOKENS_PER_IMAGE } from "./summary";
import type { UserRules } from "./userRules";
import { SEARCH_INSTRUCTION } from "@/features/web/webSearchAgent";

// What fills the context, for the meter. The model reports the total; how it splits is estimated with the same
// counts as the summary (by characters, on the high side) and scaled so the parts add up to that total.

type ContextPartKind = "conversation" | "files" | "folder" | "skills" | "memories" | "instructions";

export type ContextPart = {
  kind: ContextPartKind;
  tokens: number;
  // The folder's name
  name?: string;
  // A single file that takes most of the files' share, which is usually what the user wants to know
  biggest?: string;
};

type BreakdownSources = {
  messages: Message[];
  summary?: ConversationSummary;
  // Marked in the conversation; the model gets their names and descriptions with every message
  skills: Skill[];
  // Installed, to count the instructions of those the latest reply used
  allSkills: Skill[];
  memories: string[];
  rules: UserRules | null;
  webSearch: boolean;
  folder?: { name: string; indexTokens: number };
};

// A file most of the files' share comes from
const BIGGEST_SHARE = 0.7;

function filesOf(history: Message[]) {
  const sizes = new Map<string, { name: string; tokens: number }>();
  let tokens = 0;
  for (const message of withReferencedFiles(history)) {
    const files = estimateTextTokens(contentWithTextFiles(message)) - estimateTextTokens(message.content);
    tokens += files + imagesOf(message).length * TOKENS_PER_IMAGE;
    for (const a of message.attachments ?? []) {
      const own = a.kind === "image" ? TOKENS_PER_IMAGE : estimateTextTokens(a.data);
      const pictures = (a.visuals?.length ?? a.pages?.length ?? 0) * TOKENS_PER_IMAGE;
      const known = sizes.get(a.id);
      sizes.set(a.id, { name: a.name, tokens: (known?.tokens ?? 0) + own + pictures });
    }
  }
  const largest = [...sizes.values()].sort((a, b) => b.tokens - a.tokens)[0];
  return { tokens, biggest: largest && largest.tokens >= tokens * BIGGEST_SHARE ? largest.name : undefined };
}

// The latest reply's own extras: what it read in the folder and the skills it loaded
function latestReplyExtras(messages: Message[], allSkills: Skill[]) {
  const reply = [...messages].reverse().find((m) => m.role === "assistant");
  const asked = [...messages].reverse().find((m) => m.role === "user")?.skill;
  const loaded = [...new Set([...(reply?.skillsUsed ?? []), ...(asked ? [asked] : [])])];
  const skillTokensUsed = allSkills.filter((s) => loaded.includes(s.name)).reduce((sum, s) => sum + skillTokens(s), 0);
  return { folderRead: reply?.workspaceConsult?.tokens ?? 0, skillTokensUsed };
}

// Estimated parts, before scaling; only the ones the conversation has
export function contextParts(sources: BreakdownSources): ContextPart[] {
  const { messages, summary, skills, allSkills, memories, rules, webSearch, folder } = sources;
  const history = historyForModel(messages, summary);
  const files = filesOf(history);
  const extras = latestReplyExtras(messages, allSkills);
  const conversation = history.reduce((sum, m) => sum + estimateTextTokens(m.content), 0);
  const instructions =
    (rules ? estimateTextTokens(rules.system) + estimateTextTokens(rules.reminder) : 0) +
    estimateTextTokens(dateNote()) +
    (webSearch ? estimateTextTokens(SEARCH_INSTRUCTION) : 0);
  // In the order the meter lists them, always the same, so each part keeps its place
  const parts: ContextPart[] = [
    { kind: "conversation", tokens: conversation },
    { kind: "files", tokens: files.tokens, ...(files.biggest && { biggest: files.biggest }) },
    ...(folder ? [{ kind: "folder" as const, tokens: folder.indexTokens + extras.folderRead, name: folder.name }] : []),
    { kind: "skills", tokens: estimateTextTokens(skillsPrompt(skills) ?? "") + extras.skillTokensUsed },
    { kind: "memories", tokens: estimateTextTokens(memoriesPrompt(memories, false) ?? "") },
    { kind: "instructions", tokens: instructions },
  ];
  return parts.filter((p) => p.tokens > 0 || p.kind === "conversation" || p.kind === "folder");
}

// The parts scaled to the total the model reported, in whole tokens that add up to it exactly
export function scaledParts(parts: ContextPart[], used: number): ContextPart[] {
  const estimated = parts.reduce((sum, p) => sum + p.tokens, 0);
  if (estimated <= 0) return parts.map((p) => ({ ...p, tokens: p.kind === "conversation" ? used : 0 }));
  const scaled = parts.map((p) => ({ ...p, tokens: Math.round((p.tokens * used) / estimated) }));
  const largest = scaled.reduce((max, p) => (p.tokens > max.tokens ? p : max), scaled[0]);
  largest.tokens += used - scaled.reduce((sum, p) => sum + p.tokens, 0);
  return scaled.filter((p) => p.tokens > 0);
}

// The part that takes most of what is used, when it deserves attention: the context is filling up, or one part alone
// takes most of it (a large PDF)
export function dominantPart(parts: ContextPart[], fraction: number | null): ContextPart | null {
  const used = parts.reduce((sum, p) => sum + p.tokens, 0);
  const top = parts.reduce<ContextPart | null>((max, p) => (!max || p.tokens > max.tokens ? p : max), null);
  if (!top || used === 0) return null;
  // The conversation is most of a plain chat: that alone isn't news
  const takesAlmostAll = top.kind !== "conversation" && top.tokens / used > 0.7;
  return (fraction !== null && fraction >= 0.75) || takesAlmostAll ? top : null;
}
