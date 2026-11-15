import type { Message } from "@/shared/types";
import { dateNote, withCurrentDate } from "./currentDate";
import { DOCUMENTS_PROMPT, withDocumentsInstruction } from "@/features/documents/documents";
import { REPLY_FORMAT_PROMPT, withReplyFormatInstruction } from "@/features/markdown/replyFormat";
import { loadedSkillsTokens, type Skill, skillsPrompt, withInvokedSkill } from "@/features/skills/skills";
import { estimateTextTokens } from "./summary";
import { type UserRules, withRulesReminder } from "./userRules";
import { SEARCH_INSTRUCTION } from "@/features/web/webSearchAgent";

// What a reply's request carries besides the conversation: the system message and the notes added to the latest
// user message. Shared by the reply and by the budget the summary has to leave room for.

// A skill deleted after it was activated simply stops being sent
export function activeSkillsOf(skills: Skill[], skillNames: string[] = []) {
  return skills.filter((skill) => skillNames.includes(skill.name));
}

// undefined without rules, memories, folder or skills, so a custom Ollama model keeps its own SYSTEM prompt
export function systemPrompt(
  rules: UserRules | null,
  marked: Skill[],
  memories: string | null = null,
  workspace: string | null = null,
) {
  return [rules?.system, memories, workspace, skillsPrompt(marked)].filter(Boolean).join("\n\n") || undefined;
}

// The notes for the model at the end of the latest user message: the chosen skill, the date, the rules reminder, how
// to write documents and what the chat draws. The search instruction is added by the reply loop.
export function withRequestNotes(messages: Message[], skills: Skill[], rules: UserRules | null, canRunCommands = false) {
  const withSkill = withInvokedSkill(messages, skills, canRunCommands);
  return withReplyFormatInstruction(withDocumentsInstruction(withRulesReminder(withCurrentDate(withSkill), rules)));
}

// Sent with every reply, so the summary budget has to leave room for them. A marked skill's instructions only come in
// the reply that asks for it, so room is kept for the largest ones.
export function reservedTokensFor(
  rules: UserRules | null,
  marked: Skill[],
  webSearch: boolean,
  memories: string | null = null,
) {
  return (
    estimateTextTokens(systemPrompt(rules, marked, memories) ?? "") +
    loadedSkillsTokens(marked) +
    (rules ? estimateTextTokens(rules.reminder) : 0) +
    estimateTextTokens(dateNote()) +
    estimateTextTokens(DOCUMENTS_PROMPT) +
    estimateTextTokens(REPLY_FORMAT_PROMPT) +
    (webSearch ? estimateTextTokens(SEARCH_INSTRUCTION) : 0)
  );
}
