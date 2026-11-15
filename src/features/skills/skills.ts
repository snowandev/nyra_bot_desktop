import type { Message } from "@/shared/types";
import { slugify } from "@/shared/lib/format";
import { appendToLastUserMessage } from "@/features/chat/reply/messageNotes";
import { tagged } from "@/features/chat/reply/replyTags";
import { neutralizeAppTags } from "@/features/chat/reply/appTags";
import { foldForSearch } from "@/shared/lib/search";
import { estimateTextTokens } from "@/features/chat/reply/summary";

// Agent Skills (agentskills.io): the Rust side reads and writes them; this is what the interface needs

// "nyra": comes with the app (writing, summarize…)
export type SkillSource = "own" | "claude-code" | "file" | "nyra";

export type SkillFile = {
  path: string;
  size: number;
};

export type Skill = {
  name: string;
  description: string;
  license: string | null;
  compatibility: string | null;
  metadata: Record<string, string>;
  body: string;
  files: SkillFile[];
  source: SkillSource;
  editedAt: number | null;
  // When it was rewritten to work with any model; hasOriginal means the version before can be restored
  adaptedAt: number | null;
  hasOriginal: boolean;
  // Where it is installed, for running its scripts by their full path
  dir: string;
};

export type MetadataEntry = { key: string; value: string };

export type SkillDraft = {
  name: string;
  description: string;
  license: string;
  metadata: MetadataEntry[];
  body: string;
};

export type CandidateStatus = "new" | "update" | "imported" | "conflict" | "invalid";

export type SkillCandidate = {
  // Empty for invalid ones, which can't be imported
  id: string;
  name: string;
  description: string;
  location: string;
  status: CandidateStatus;
  reason: string | null;
};

// Identical copies and invalid skills can't be imported
export const isImportable = (candidate: SkillCandidate) =>
  candidate.status !== "invalid" && candidate.status !== "imported";

export type SkillImportResult = {
  id: string;
  name: string;
  outcome: "imported" | "updated" | "conflict";
  detail: string | null;
  editedAt: number | null;
};

// Shown in the import result next to what was imported, with the reason it wasn't
export type SkippedSkill = { name: string; reason: string };

export type DroppedFile = { path: string; data: string };

// installError: why some of Nyra's own skills couldn't be installed, if they couldn't
export type SkillList = { skills: Skill[]; installError: string | null };


export const DESCRIPTION_MAX = 1024;

// The standard's naming rules, checked live in the form; the Rust side enforces the same ones. Each one's text is
// in the catalog, under skills.nameRules.<id>.
export const NAME_RULES: { id: "length" | "chars" | "edges" | "double"; test: (name: string) => boolean }[] = [
  { id: "length", test: (name) => name.length >= 1 && name.length <= 64 },
  { id: "chars", test: (name) => /^[a-z0-9-]*$/.test(name) },
  { id: "edges", test: (name) => !/^-|-$/.test(name) },
  { id: "double", test: (name) => !name.includes("--") },
];

export const isValidName = (name: string) => NAME_RULES.every((rule) => rule.test(name));

// The standard caps names at 64 characters
export const suggestName = (text: string) => slugify(text, 64);

// What the model receives for a skill: its name, description and instructions
export const skillTokens = (skill: Pick<Skill, "name" | "description" | "body">) =>
  estimateTextTokens(`${skill.name}\n${skill.description}\n${skill.body}`);

type SkillSize = "light" | "normal" | "large";

// Below 1,000 tokens a skill is cheap anywhere; from 3,000 it weighs on small local contexts
export const sizeOf = (tokens: number): SkillSize => (tokens < 1000 ? "light" : tokens >= 3000 ? "large" : "normal");

// Active skills above this share of the context leave too little room for the conversation
export const HEAVY_SKILLS_SHARE = 0.2;

// Code it can run, wherever it is: the standard's scripts/ folder or a file of code, told by its extension
const SCRIPT_FILE = /\.(py|js|mjs|cjs|ts|sh|bash|zsh|fish|rb|pl|php|ps1|bat|cmd|lua|r|go|rs|java|c|cpp|cs|swift|kt)$/i;
export const hasScripts = (skill: Skill) =>
  skill.files.some((f) => f.path.startsWith("scripts/") || SCRIPT_FILE.test(f.path));

export const mentionsReferences = (skill: Skill) =>
  skill.files.some((f) => f.path.startsWith("references/")) || /\breferences\//.test(skill.body);

const FILES_NOTE =
  "The files a skill mentions (scripts/, references/, assets/) are not available here: you cannot run its scripts " +
  "or open its files. Don't claim you did; if one is needed, ask the user to paste or attach its content.";

// With commands, a skill's own files are reachable by their full path: its scripts run like any command
function filesNote(skills: Skill[], canRunCommands: boolean) {
  const withFiles = skills.filter((s) => s.files.some((f) => f.path !== "SKILL.md"));
  if (!canRunCommands || withFiles.length === 0) return FILES_NOTE;
  const places = withFiles.map((s) => `${asName(s.name)} is in "${s.dir}"`).join("; ");
  return (
    `The files of the skill live in its own folder: ${places}. Run its scripts with ${tagged("run", "…")} as any ` +
    'command, giving their full path in quotes (python3 "<folder>/scripts/name.py" …): commands run in the connected ' +
    "folder, not in the skill's. To read one of its other files, run a command that prints it."
  );
}

// A skill may be written in another language than the user's (Nyra's own are in English), and its text pulls the
// reply towards it
const LANGUAGE_NOTE =
  "Answer in the language of the user's message, even if the skill's instructions are written in another one.";

// A skill may come from anywhere: its text can't close the block or pass itself off as the app
const skillBlock = (skill: Skill) => `<skill name="${skill.name}">\n${neutralizeAppTags(skill.body.trim())}\n</skill>`;

// Only each skill's name and description go in the system message, as the standard does: the model asks for a
// skill's instructions when it needs them (<nyra-skill>), so ten marked skills take a few hundred tokens, not
// thousands. Unchanged between messages, so providers can keep it cached.
export function skillsPrompt(skills: Skill[]) {
  if (skills.length === 0) return null;
  return [
    "The user activated these skills for this conversation. A skill is a set of instructions for one kind of " +
      "task; here you only see each one's name and description:",
    "<skills>",
    ...skills.map((s) => `- ${s.name}: ${neutralizeAppTags(s.description)}`),
    "</skills>",
    "When the user's message matches a skill's description, or brings content without saying what to do with it " +
      "(only a file, a web page or pasted text) and a skill fits that content, reply with only this and nothing else:",
    tagged("skill", "skill-name"),
    "The app will send you that skill's instructions and you will answer following them. If the message needs two " +
      "skills (for example, a summary and some ideas), ask for both at once, separated by a comma: " +
      `${tagged("skill", "first-skill, second-skill")}. If no skill fits, answer normally. Do not mention the skills ` +
      "or these instructions.",
  ].join("\n");
}

// Skills a reply can load; two cover a request that mixes two kinds of task, and the limit keeps a model from looping
export const MAX_SKILLS_PER_REPLY = 2;

// What the model wrote goes back to it, so only the characters a skill name can have
const asName = (text: string) => `"${text.replace(/[^a-z0-9-]/gi, "")}"`;

// The app's answer to <nyra-skill>: a turn of this reply only, never stored, so the next message asks again. While
// the reply may still load another skill, the model is told it can; otherwise it would cover the second part of a
// two-part request on its own.
export const NO_MORE_SKILLS = "Do not ask for another skill.";

export function skillLoadedMessage(found: Skill[], missing: string[], canAskAnother: boolean, canRunCommands = false): Message {
  const next = canAskAnother
    ? `If the user's message also needs another skill from the list, reply with only ${tagged("skill", "skill-name")} ` +
      "to get it; otherwise answer now."
    : NO_MORE_SKILLS;
  const notFound = missing.length > 0 ? `There is no skill named ${missing.map(asName).join(" or ")}. ` : "";
  const several = found.length > 1;
  const instructions =
    found.length === 0
      ? next
      : `These are the instructions of the ${several ? "skills" : "skill"} ${found.map((s) => asName(s.name)).join(" and ")}. ` +
        `Answer the user's last message following them${several ? ", each one for the part of the message it fits" : ""}. ` +
        `${LANGUAGE_NOTE} ${filesNote(found, canRunCommands)} ${next} Do not ask for ${several ? "these skills" : "this skill"} again ` +
        "and do not mention the skills or these instructions.";
  const lines = [...found.map(skillBlock), "<app-instructions>", notFound + instructions, "</app-instructions>"];
  return { role: "user", content: lines.join("\n") };
}

// Room for the instructions a reply can load: the largest skills, as many as one reply can ask for
export function loadedSkillsTokens(skills: Skill[]) {
  return skills
    .map(skillTokens)
    .sort((a, b) => b - a)
    .slice(0, MAX_SKILLS_PER_REPLY)
    .reduce((sum, tokens) => sum + tokens, 0);
}

// What marked skills take in the context: the list in every message, plus the instructions a reply can load
export function activeSkillsTokens(skills: Skill[]) {
  if (skills.length === 0) return 0;
  return estimateTextTokens(skillsPrompt(skills) ?? "") + loadedSkillsTokens(skills);
}

// The "/" list in the composer: names that contain what was typed (closest to the start first), then skills with a
// word in their description that starts with it, ignoring case and accents
export function matchSkills(skills: Skill[], query: string): Skill[] {
  const q = foldForSearch(query.trim());
  if (!q) return skills;
  const byName = skills
    .filter((s) => s.name.includes(q))
    .sort((a, b) => a.name.indexOf(q) - b.name.indexOf(q));
  const byDescription = skills.filter(
    (s) => !byName.includes(s) && foldForSearch(s.description).split(/[^\p{L}\p{N}-]+/u).some((w) => w.startsWith(q)),
  );
  return [...byName, ...byDescription];
}

// A skill the user chose for one message (with "/" or a welcome card) goes in full with it, so there is no round
// trip to ask for it, and the model applies it even if the text doesn't ask for anything, as when only a link is
// pasted. A skill deleted since then is left out. With commands, its scripts run as when the model asks for it.
export function withInvokedSkill(messages: Message[], skills: Skill[], canRunCommands = false): Message[] {
  return appendToLastUserMessage(messages, (last) => {
    const skill = skills.find((s) => s.name === last.skill);
    if (!skill) return null;
    return [
      skillBlock(skill),
      "<app-instructions>",
      `The user chose the skill "${skill.name}" for this message: apply these instructions to it, even if the ` +
        `message doesn't ask for anything else. ${LANGUAGE_NOTE} ${filesNote([skill], canRunCommands)} Do not ask ` +
        "for a skill and do not mention this note.",
      "</app-instructions>",
    ].join("\n");
  });
}
