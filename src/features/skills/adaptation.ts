import { i18n } from "@/shared/i18n/i18n";
import type { Message } from "@/shared/types";
import { DESCRIPTION_MAX, type Skill } from "./skills";
import { estimateTextTokens } from "@/features/chat/reply/summary";

// Rewrites a skill made for one assistant (Claude Code, ChatGPT, Gemini…) so any model, cloud or local, can use it

export type Adaptation = {
  description: string;
  body: string;
};

// In English, which models follow most reliably; each part of the skill keeps its own language
export const ADAPTATION_SYSTEM = [
  "You rewrite Agent Skills (a SKILL.md: a description plus Markdown instructions) so they work with any AI " +
    "assistant, model and provider, cloud or local. The result must be neutral: it describes the task and how to do " +
    "it well, not the product or tool the skill was written for.",
  "Rules:",
  "- Remove or neutralize every reference to a specific assistant, company or product (Claude, Claude Code, " +
    'Anthropic, ChatGPT, OpenAI, GPT, Codex, Gemini, Copilot, Cursor and similar). Say "the assistant" or write the ' +
    "step directly.",
  "- The assistant may have no tools: it may not be able to run commands or scripts, read or write files, browse the " +
    "web or call other agents. Rewrite every step that depends on a specific tool (Bash, Read, Edit, Write, Grep, " +
    "WebFetch, code interpreter, canvas, artifacts, MCP servers, slash commands, subagents…) so it still works: give " +
    "the user the command or code to run, ask them to paste or attach what is needed, or do the work in the reply " +
    "itself. Never pretend a tool was used.",
  "- Keep everything about the task: domain knowledge, rules, steps, checklists, formats, examples, templates, " +
    "limits and warnings. Do not drop or summarize useful content, and do not add facts that are not in the original.",
  "- Files bundled with the skill (scripts/, references/, assets/) may be mentioned, but as files the user can paste " +
    "or attach, not as something the assistant opens or runs.",
  "- Keep the language and the Markdown structure of the original.",
  `- The description says what the skill does and when to use it, in at most ${DESCRIPTION_MAX} characters.`,
  "Reply with exactly these two blocks and nothing else:",
  "<description>\n…\n</description>",
  "<instructions>\n…\n</instructions>",
].join("\n");

export function adaptationRequest(skill: Pick<Skill, "name" | "description" | "body">): Message[] {
  const content = [
    `<skill name="${skill.name}">`,
    `<description>\n${skill.description}\n</description>`,
    `<instructions>\n${skill.body.trim()}\n</instructions>`,
    "</skill>",
  ].join("\n");
  return [{ role: "user", content }];
}

// The reply is about as long as the skill, so the request needs room for the skill twice
export function adaptationTokens(skill: Pick<Skill, "description" | "body">) {
  return estimateTextTokens(ADAPTATION_SYSTEM) + 2 * estimateTextTokens(`${skill.description}\n${skill.body}`);
}

// The instructions come last and may quote either tag, so they end at the last closing tag and the
// description at its first one
function block(text: string, tag: string, endsAtLastClose: boolean) {
  const start = text.indexOf(`<${tag}>`);
  if (start === -1) return null;
  const contentStart = start + tag.length + 2;
  const close = `</${tag}>`;
  const end = endsAtLastClose ? text.lastIndexOf(close) : text.indexOf(close, contentStart);
  return end < contentStart ? null : text.slice(contentStart, end).trim();
}

export function parseAdaptation(reply: string): Adaptation {
  // Some models write their reasoning first; it is not part of the result
  const text = reply.replace(/<think>[\s\S]*?<\/think>/g, "");
  const description = block(text, "description", false);
  const body = block(text, "instructions", true);
  if (description === null || body === null) {
    throw new Error(i18n.t("skills.adapt.badFormat"));
  }
  if (!description || !body) throw new Error(i18n.t("skills.adapt.emptyParts"));
  if (description.length > DESCRIPTION_MAX) {
    throw new Error(i18n.t("skills.adapt.descriptionTooLong", { max: DESCRIPTION_MAX }));
  }
  return { description, body };
}

const PRODUCT_NAMES: [string, RegExp][] = [
  ["Claude", /\bClaude\b/],
  ["Anthropic", /\bAnthropic\b/],
  ["ChatGPT", /\bChatGPT\b/i],
  ["OpenAI", /\bOpenAI\b/i],
  ["GPT", /\bGPT(-\d[\w.]*)?\b/],
  ["Codex", /\bCodex\b/],
  ["Gemini", /\bGemini\b/],
  ["Copilot", /\bCopilot\b/],
  ["Cursor", /\bCursor\b/],
];

// Product names left in the adapted text, to point them out during the review
export function productMentions({ description, body }: Adaptation) {
  const text = `${description}\n${body}`;
  return PRODUCT_NAMES.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}
