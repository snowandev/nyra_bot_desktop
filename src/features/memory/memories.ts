import { foldForSearch } from "@/shared/lib/search";
import { estimateTextTokens } from "@/features/chat/reply/summary";
import { findSensitiveData } from "@/features/sensitive-data/sensitiveData";
import { neutralizeAppTags } from "@/features/chat/reply/appTags";
import { i18n } from "@/shared/i18n/i18n";
import { FALLBACK_LANGUAGE, type Language, LANGUAGES } from "@/shared/i18n/languages";

// Saved memories: short facts about the user the model gets with every message, and that it can add to by writing
// <nyra-remember>…</nyra-remember> in its reply. Nyra takes the tag out of the reply and saves what it says.

// Matches the Rust side (memories.rs)
export const MEMORY_MAX_CHARS = 300;

const OPEN = "<nyra-remember>";
const CLOSE = "</nyra-remember>";
const TAG = /<nyra-remember>([\s\S]*?)<\/nyra-remember>/g;

// The memories are the user's data, read and edited in Settings, so they go in the interface's language whatever
// language a conversation is in: one language also lets the model see what is already saved. Each language is named
// for the model in English, with two memories written as they should be.
const MEMORY_LANGUAGES: Record<Language, { name: string; examples: string }> = {
  es: { name: "Spanish", examples: '"Trabaja en macOS", "Prefiere respuestas cortas"' },
  en: { name: "English", examples: '"Works on macOS", "Prefers short answers"' },
};

// In English, which models follow most reliably; the memories themselves are written in the interface's language
function howToSave() {
  const language = MEMORY_LANGUAGES[LANGUAGES.find((l) => l === i18n.language) ?? FALLBACK_LANGUAGE];
  return [
    `When the user asks you to remember something, or you learn a lasting and useful fact about them (their work, ` +
      `projects, tools, tastes, what they like and dislike, people and names they mention), add at the very end of ` +
      `your reply, after everything else: ${OPEN}the fact${CLOSE}. One tag per fact, each short and in the third ` +
      `person with no subject, never "The user…" nor "I…".`,
    `Always write each fact in ${language.name}, even when the conversation is in another language: ` +
      `${language.examples}.`,
    "Only save what the user says about themselves, never guesses drawn from what they ask for. " +
      "Don't save passing states (moods, tiredness, today's plans) nor turn them into preferences: \"is tired and " +
      "wants a quick dinner\" is not a memory. Nor things only about this conversation, or secrets (passwords, keys, " +
      "card numbers). Never save again something already in the list, even with other words or in another " +
      "language. The user sees every memory and can delete it; don't mention the tag.",
  ].join(" ");
}

// For the system message. Without memories and when they can't be saved, nothing at all.
export function memoriesPrompt(memories: string[], canSave: boolean): string | null {
  if (memories.length === 0 && !canSave) return null;
  const lines: string[] = [];
  if (memories.length > 0) {
    lines.push(
      "What you remember about the user from earlier conversations. Use it when it helps; don't mention it unless " +
        "it is relevant or they ask:",
      "<memories>",
      // Saved from model output, so Nyra's own tags are disarmed like any text from outside
      ...memories.map((m) => `- ${neutralizeAppTags(m)}`),
      "</memories>",
    );
  }
  if (canSave) lines.push(howToSave());
  return lines.join("\n");
}

// Past this, memories start to weigh on every message, above all with a local model's small context
export const MEMORY_TOKENS_LIMIT = 1500;

// What the saved memories add to every message; zero without any
export const memoryTokens = (memories: string[]) => estimateTextTokens(memoriesPrompt(memories, false) ?? "");

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();
const sameFact = (a: string, b: string) => foldForSearch(tidy(a)).replace(/[.!]+$/, "") === foldForSearch(tidy(b)).replace(/[.!]+$/, "");

// The facts a reply asked to save, and the reply without its tags. Empty, too long, secret or already known
// facts are dropped: a secret must never end up in the memory, even if the model was told not to save it.
export function takeMemories(reply: string, known: string[]) {
  const facts: string[] = [];
  for (const [, raw] of reply.matchAll(TAG)) {
    const fact = tidy(raw);
    const isKnown = [...known, ...facts].some((k) => sameFact(k, fact));
    const isSecret = findSensitiveData(fact).length > 0;
    if (fact && fact.length <= MEMORY_MAX_CHARS && !isKnown && !isSecret) facts.push(fact);
  }
  return { facts, text: withoutMemoryTags(reply) };
}

// What the user reads: no tags, also while the reply is still arriving and a tag is half written
export function withoutMemoryTags(text: string) {
  const withoutComplete = text.replace(TAG, "");
  const start = withoutComplete.lastIndexOf("<nyra-remember");
  const open = start !== -1 ? withoutComplete.slice(start) : "";
  const withoutOpen = open && !open.includes(CLOSE) ? withoutComplete.slice(0, start) : withoutComplete;
  // The tag's first characters at the very end: "<", "<ny", "<nyra-rem"…
  const tail = withoutOpen.match(/<[a-z-]*$/)?.[0] ?? "";
  const withoutTail = tail && OPEN.startsWith(tail) ? withoutOpen.slice(0, -tail.length) : withoutOpen;
  return withoutTail.trimEnd();
}
