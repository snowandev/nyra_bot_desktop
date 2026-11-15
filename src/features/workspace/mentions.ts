import { foldForSearch } from "@/shared/lib/search";

// "@path" in a message names a file of the connected folder. Recognized by its shape (an @ at the start or after a
// space, followed by a path of the index), so it works in any language and never by guessing words.

const MENTION = /(^|\s)@(\S+)/g;
// A sentence may end right after the path: "mira @src/app.ts."
const TRAILING = /[.,;:!?)\]}»"']+$/;
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const MAX_MENTIONED_FILES = 5;

// The files a message mentions that are in the folder's index, in order and once each. Images are left out: the
// model asks for them when it needs to look at them.
export function mentionedPaths(text: string, indexed: ReadonlySet<string>): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(MENTION)) {
    const candidates = [match[2], match[2].replace(TRAILING, "")];
    const path = candidates.find((c) => indexed.has(c));
    if (path && !IMAGE.test(path) && !found.includes(path)) found.push(path);
  }
  return found.slice(0, MAX_MENTIONED_FILES);
}

// The "@…" being written right before the cursor, with where it starts; null when the cursor isn't on one
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!match) return null;
  return { start: before.length - match[2].length - 1, query: match[2] };
}

// The files that fit what was typed after @: the name starting with it first, then the name containing it, then the
// path; ignoring case and accents, shorter paths first within each
export function matchFiles(paths: readonly string[], query: string, limit = 8): string[] {
  const q = foldForSearch(query);
  if (!q) return [...paths].sort((a, b) => a.length - b.length).slice(0, limit);
  const scored: { path: string; score: number }[] = [];
  for (const path of paths) {
    const folded = foldForSearch(path);
    const name = folded.slice(folded.lastIndexOf("/") + 1);
    const score = name.startsWith(q) ? 0 : name.includes(q) ? 1 : folded.includes(q) ? 2 : -1;
    if (score >= 0) scored.push({ path, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.path.length - b.path.length)
    .slice(0, limit)
    .map((s) => s.path);
}

// The text with the "@…" being written replaced by the chosen file, and where the cursor goes after it
export function withMention(text: string, start: number, caret: number, path: string) {
  const inserted = `@${path} `;
  return { text: text.slice(0, start) + inserted + text.slice(caret).replace(/^ /, ""), caret: start + inserted.length };
}

// What the model gets with the message: the content of the files the user mentioned, already read
export const mentionedFilesNote = (body: string) =>
  [
    "<mentioned-files>",
    "The user mentioned these files of the folder with @. The app already read them for you, so don't ask for them " +
      "again unless you need other lines; their content follows.",
    body,
    "</mentioned-files>",
  ].join("\n");
