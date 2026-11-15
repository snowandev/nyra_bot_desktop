import { asAttribute, neutralizeAppTags } from "@/features/chat/reply/appTags";

// Files where a project tells assistants how to work on it. NYRA.md is Nyra's own and always read; the others are
// those of other assistants, read with the compatibility on (Settings → Funciones de Nyra). In this order, which is
// also which one wins when they disagree.
const NYRA_GUIDE = "NYRA.md";
const COMPATIBLE_GUIDES = ["AGENTS.md", "CLAUDE.md"];

export const guideNames = (compatible: boolean) => (compatible ? [NYRA_GUIDE, ...COMPATIBLE_GUIDES] : [NYRA_GUIDE]);

// What all the instructions of one place may take together; past it they are cut
const GUIDES_MAX_CHARS = 24_000;
// An instruction file imports another with "@path", which may import more: this many steps at most
const MAX_IMPORT_DEPTH = 4;

export type GuideFile = {
  path: string;
  text: string;
  // The guide that brought it in with "@path"
  importedBy?: string;
};

// Reads a file of the folder by its path from the top; null if it isn't there or can't be read
type ReadGuide = (path: string) => Promise<string | null>;

const directoryOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

// The text outside code: an "@" in a code block or between backticks is an example, not an import
function withoutCode(text: string) {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
}

// The files a guide imports ("@docs/style.md", as Claude Code reads them), by their path in the folder. An "@" is an
// import only at the start of a word and followed by a path, so an e-mail address isn't one. Only inside the folder:
// paths from the user's home ("@~/…") or absolute are left out, and ".." can't climb above the top.
export function importsIn(text: string, from: string): string[] {
  const found: string[] = [];
  for (const match of withoutCode(text).matchAll(/(?:^|\s)@([^\s`'"<>()[\]{}]+)/g)) {
    const target = match[1].replace(/[.,;:!?]+$/, "");
    if (!target || target.startsWith("~") || target.startsWith("/") || /^[a-zA-Z]:/.test(target)) continue;
    const parts = directoryOf(from) ? directoryOf(from).split("/") : [];
    let escaped = false;
    for (const part of target.split(/[\\/]/)) {
      if (part === "" || part === ".") continue;
      if (part === "..") {
        if (parts.length === 0) escaped = true;
        parts.pop();
      } else parts.push(part);
    }
    const path = parts.join("/");
    if (!escaped && path && !found.includes(path)) found.push(path);
  }
  return found;
}

// The instructions in one folder of the project ("" is the top), with what they import, in the order that wins
export async function guidesIn(directory: string, names: string[], read: ReadGuide): Promise<GuideFile[]> {
  const seen = new Set<string>();
  const files: GuideFile[] = [];
  let chars = 0;
  async function add(path: string, importedBy: string | undefined, depth: number) {
    if (seen.has(path) || chars >= GUIDES_MAX_CHARS) return;
    seen.add(path);
    const text = await read(path);
    if (!text?.trim()) return;
    const room = GUIDES_MAX_CHARS - chars;
    const kept = text.length > room ? `${text.slice(0, room)}\n…` : text;
    chars += kept.length;
    files.push({ path, text: kept, ...(importedBy && { importedBy }) });
    if (depth >= MAX_IMPORT_DEPTH) return;
    for (const imported of importsIn(text, path)) await add(imported, path, depth + 1);
  }
  for (const name of names) await add(directory ? `${directory}/${name}` : name, undefined, 0);
  return files;
}

// The folders between the top and a file, nearest last: their own instructions apply to the file
export function foldersAbove(path: string): string[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

function guideBlocks(files: GuideFile[]) {
  return files
    .map((file) => {
      const from = file.importedBy ? ` imported-by="${asAttribute(file.importedBy)}"` : "";
      return `<project-instructions path="${asAttribute(file.path)}"${from}>\n${neutralizeAppTags(file.text)}\n</project-instructions>`;
    })
    .join("\n");
}

// The project's instructions at the top of the folder, in English like every instruction for the model
export function projectGuidesPrompt(files: GuideFile[]) {
  if (files.length === 0) return "";
  return [
    "The project has instructions for working on it; follow them. Where they disagree, NYRA.md wins over AGENTS.md " +
      "and CLAUDE.md, and a subfolder's instructions win over the top folder's for the files in that subfolder. " +
      "You'll get a subfolder's own instructions when you read a file there.",
    guideBlocks(files),
  ].join("\n");
}

// /init: how the model writes the project's NYRA.md. It proposes it as a change the user reviews, like any other.
export const WRITE_GUIDE_PROMPT = [
  "The user ran /init: write NYRA.md, the instructions Nyra follows whenever it works in this folder.",
  "- Explore first: the manifests and README, how to build, run, test and lint, the folder structure, the conventions " +
    "the code shows, and any CLAUDE.md or AGENTS.md (read them even if the index leaves them out).",
  "- Then propose NYRA.md at the top of the folder as a change. Short and concrete, well under 100 lines: commands, " +
    "structure, conventions and what not to do, only what isn't obvious from the code. Every line based on what you " +
    "read; never invent a command or a path.",
  "- Don't copy CLAUDE.md or AGENTS.md: if one exists, import it with a line of its own like @CLAUDE.md and add only " +
    "what it lacks.",
  "- If NYRA.md already exists, propose improvements to it, keeping what the user wrote.",
  "- Write it in the language of the project's documentation; without any, in the language the user writes to you.",
  "- If the user added something to the request, follow it.",
].join("\n");

// A subfolder's instructions, with the first file read in it
export function subfolderGuidesNote(directory: string, files: GuideFile[]) {
  return (
    `The folder "${asAttribute(directory)}" has its own instructions for the files in it; follow them:\n` +
    guideBlocks(files)
  );
}
