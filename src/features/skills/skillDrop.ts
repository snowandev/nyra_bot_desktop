import { readAsBase64 } from "@/features/attachments/attachments";
import { i18n } from "@/shared/i18n/i18n";
import type { DroppedFile } from "./skills";

// Same limits as the Rust side, checked early so a huge folder isn't read into memory for nothing
const MAX_FILES = 500;
const MAX_BYTES = 20 * 1024 * 1024;
const SKIPPED_FOLDERS = new Set([".git", "node_modules", "__MACOSX"]);

function readEntries(reader: FileSystemDirectoryReader) {
  return new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
}

function fileOf(entry: FileSystemFileEntry) {
  return new Promise<File>((resolve, reject) => entry.file(resolve, reject));
}

async function collect(entry: FileSystemEntry, path: string, out: { path: string; file: File }[]) {
  if (out.length > MAX_FILES) throw new Error(i18n.t("skills.drop.tooManyFiles", { max: MAX_FILES }));
  if (entry.isFile) {
    out.push({ path, file: await fileOf(entry as FileSystemFileEntry) });
    return;
  }
  if (!entry.isDirectory || SKIPPED_FOLDERS.has(entry.name)) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries returns the folder in batches until an empty one
  for (let batch = await readEntries(reader); batch.length > 0; batch = await readEntries(reader)) {
    for (const child of batch) await collect(child, `${path}/${child.name}`, out);
  }
}

// Entries must be taken while the drop event runs; the DataTransfer is emptied right after it
export function droppedEntries(dataTransfer: DataTransfer | null): FileSystemEntry[] {
  return Array.from(dataTransfer?.items ?? []).flatMap((item) => item.webkitGetAsEntry() ?? []);
}

// Folders keep their relative paths ("my-skill/SKILL.md"), so the Rust side can find each skill's root
export async function readDroppedSkills(entries: FileSystemEntry[]): Promise<DroppedFile[]> {
  const found: { path: string; file: File }[] = [];
  for (const entry of entries) await collect(entry, entry.name, found);
  const total = found.reduce((sum, f) => sum + f.file.size, 0);
  if (total > MAX_BYTES) throw new Error(i18n.t("skills.drop.tooBig"));
  return Promise.all(found.map(async ({ path, file }) => ({ path, data: await readAsBase64(file) })));
}
