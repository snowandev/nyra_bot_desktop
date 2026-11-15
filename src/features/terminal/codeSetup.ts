import { i18n } from "@/shared/i18n/i18n";
import { base64Of } from "@/shared/lib/base64";
import { textBytes } from "@/shared/lib/format";
import type { Attachment, CodeLanguage, Message } from "@/shared/types";
import { type CodeRuntimes, codeRuntimes, codeSpace } from "./codeStorage";
import { LANGUAGE_NAMES } from "./programs";

// What the conversation's programs get to read: below Rust's limit, so a heavy old attachment never blocks them
const INPUTS_BUDGET = 45 * 1024 * 1024;

const bytesOf = (base64: string) => Math.floor((base64.length * 3) / 4);
// Windows refuses these in a file name (control characters too), and a few device names whatever their extension
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const DEVICE_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;
const MAX_NAME = 120;

// A name every system accepts for the file, the same on all three, and close to the original so the model writes it
// right; a text without an extension gets .txt (a web page is named by its title)
export function safeFileName(name: string, isText: boolean) {
  let safe = name.replace(UNSAFE_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME).replace(/[. ]+$/, "");
  if (!safe) safe = "file";
  if (DEVICE_NAME.test(safe)) safe = `_${safe}`;
  return isText && !/\.[a-z0-9]{1,8}$/i.test(safe) ? `${safe}.txt` : safe;
}

const isText = (attachment: Attachment) => attachment.kind === "text" && !attachment.workbook;

// What the file weighs; null when there's no file to give (an old PDF kept without its original, an audio, kept apart)
function sizeOf(attachment: Attachment) {
  if (attachment.kind === "audio") return null;
  if (attachment.workbook) return bytesOf(attachment.workbook);
  if (attachment.kind === "pdf") return attachment.pdf ? bytesOf(attachment.pdf) : null;
  if (attachment.kind === "image") return bytesOf(attachment.data);
  return textBytes(attachment.data);
}

// The file as the user attached it: the original of a PDF or spreadsheet, not the text Nyra read from it
function fileOf(attachment: Attachment) {
  if (attachment.workbook) return attachment.workbook;
  if (attachment.kind === "pdf") return attachment.pdf ?? "";
  if (attachment.kind === "image") return attachment.data;
  return base64Of(new TextEncoder().encode(attachment.data));
}

// The attached files the programs get, by the name they'll have, newest first; an older one with the same name gives
// way to the newer
function attachedFiles(history: Message[]) {
  const files: { name: string; attachment: Attachment }[] = [];
  const names = new Set<string>();
  let total = 0;
  for (const attachment of history.flatMap((m) => m.attachments ?? []).reverse()) {
    const name = safeFileName(attachment.name, isText(attachment));
    const size = sizeOf(attachment);
    if (names.has(name) || size === null || total + size > INPUTS_BUDGET) continue;
    names.add(name);
    total += size;
    files.push({ name, attachment });
  }
  return files;
}

export const codeInputsOf = (history: Message[]) =>
  attachedFiles(history).map(({ name, attachment }) => ({ name, data: fileOf(attachment) }));

// What a reply needs to run programs: the languages this computer has and the conversation's folder; null when none
export async function codeSetup(conversationId: string, history: Message[]) {
  const runtimes = await codeRuntimes().catch(() => ({}) as CodeRuntimes);
  const languages = (Object.keys(LANGUAGE_NAMES) as CodeLanguage[]).filter((l) => runtimes[l]);
  if (languages.length === 0) return null;
  const dir = await codeSpace(conversationId, []).catch(() => null);
  if (!dir) return null;
  return {
    conversationId,
    dir,
    label: i18n.t("terminal.code.conversationFolder"),
    languages,
    packages: runtimes.packages ?? [],
    missingPackages: runtimes.missingPackages ?? [],
    // Their names, for the model; the files themselves are written when the first program of the reply is approved
    files: attachedFiles(history).map((file) => file.name),
    inputs: () => codeInputsOf(history),
  };
}
