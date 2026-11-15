import type { CodeLanguage, CommandRun } from "@/shared/types";

// The programs the model writes, as the cards and steps name them

// What a program created or changed is listed for the model up to this many files
export const LISTED_FILES = 30;

export const LANGUAGE_NAMES: Record<CodeLanguage, string> = { python: "Python 3", javascript: "Node.js" };

export const isCodeLanguage = (language: string): language is CodeLanguage => language in LANGUAGE_NAMES;

export const languageName = (language: string) => (isCodeLanguage(language) ? LANGUAGE_NAMES[language] : language);

// The first line that says something, past imports and comments
function firstStatement(source: string) {
  const lines = source.split("\n").map((l) => l.trim());
  const meaningful = lines.filter((l) => l && !/^(#|\/\/|import\b|from\s+\S+\s+import\b|const\s+\w+\s*=\s*require\()/.test(l));
  return meaningful[0] ?? lines.find(Boolean) ?? "";
}

// A command as it is; a program by its language and its first statement, where a line has room for one
export function runLabel(run: CommandRun) {
  if (!run.code) return run.command;
  const line = firstStatement(run.code.source);
  const short = line.length > 60 ? `${line.slice(0, 59)}…` : line;
  return short ? `${languageName(run.code.language)} · ${short}` : languageName(run.code.language);
}
