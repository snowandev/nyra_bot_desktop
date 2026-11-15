import { i18n } from "@/shared/i18n/i18n";
import type { Attachment, Message, SheetVersion } from "@/shared/types";
import { CELL_RULES, type ParsedChange } from "@/features/workspace/fileChanges";
import { editAttachedWorkbook, type WorkbookEditError } from "./spreadsheetStorage";

// Changes to an attached spreadsheet make a new version of it, kept with the reply that made it; the user's file never
// changes. The next changes start from the latest version.

// In the system message while the conversation has an attached spreadsheet; in English, which models follow best
export const SHEET_ATTACHMENTS_PROMPT = [
  "The user attached spreadsheets to this conversation, shown as one table per sheet. When the user asks you to " +
    "change one (.xlsx, .xlsm), Nyra doesn't overwrite their file: it makes a new version of it in the conversation, " +
    "which they can review and save (an .xls or .ods becomes an .xlsx). After explaining what you'll change, add at " +
    "the end of your reply one block " +
    "per sheet, naming the file as it was attached:",
  '<nyra-cells file="name.xlsx" sheet="Sheet name">',
  "B3: 120",
  "D10: =SUM(D2:D9)",
  "</nyra-cells>",
  `${CELL_RULES} The changes apply to the file's latest version, the one shown last. Don't put these blocks in a ` +
    "code fence.",
].join("\n");

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const lineageOf = (attachment: Attachment) => attachment.version?.lineage ?? attachment.id;
export const versionNumberOf = (attachment: Attachment) => attachment.version?.number ?? 1;

// Every spreadsheet in the conversation, attached by the user or made by a reply, oldest first
function workbooksOf(messages: Message[]) {
  return messages.flatMap((m) => (m.attachments ?? []).filter((a) => a.workbook));
}

export const hasAttachedWorkbooks = (messages: Message[]) => workbooksOf(messages).length > 0;

// The version changes start from: the latest of the file with that name, also when a version is an .xlsx made from an
// .xls and the model still uses the old name
export function latestWorkbook(messages: Message[], file: string) {
  const workbooks = workbooksOf(messages);
  const named = workbooks.filter((a) => sameName(a.name, file)).at(-1);
  return named && workbooks.filter((a) => lineageOf(a) === lineageOf(named)).at(-1);
}

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const asXlsxName = (name: string) => name.replace(/\.[^.]+$/, "") + ".xlsx";

// Each lineage's latest version, which is the one the model works with
export function latestOfEachLineage(messages: Message[]) {
  const latest = new Map<string, Attachment>();
  for (const attachment of workbooksOf(messages)) latest.set(lineageOf(attachment), attachment);
  return latest;
}

// "Seguir desde esta": a copy of an earlier version that becomes the latest, so the next changes start from it.
// It goes with the latest reply, after every other version; nothing is removed.
export function restoredVersion(messages: Message[], fileId: string) {
  const source = workbooksOf(messages).find((a) => a.id === fileId);
  const index = messages.map((m) => m.role).lastIndexOf("assistant");
  if (!source?.workbook || index === -1) return null;
  const lineage = lineageOf(source);
  const number = Math.max(...workbooksOf(messages).filter((a) => lineageOf(a) === lineage).map(versionNumberOf)) + 1;
  const id = crypto.randomUUID();
  const attachment: Attachment = { ...source, id, version: { lineage, number } };
  const version: SheetVersion = {
    id,
    file: source.name,
    number,
    baseId: source.id,
    cells: [],
    cellsBefore: [],
    restoredFrom: versionNumberOf(source),
  };
  return { index, attachment, version };
}

// "gastos.xlsx" → "gastos (versión 2).xlsx", the name the save dialog offers
export function versionFileName(name: string, number: number) {
  if (number <= 1) return name;
  const dot = name.lastIndexOf(".");
  const suffix = i18n.t("attachments.versions.suffix", { number });
  return dot > 0 ? `${name.slice(0, dot)} ${suffix}${name.slice(dot)}` : `${name} ${suffix}`;
}

function editErrorText(error: unknown, file: string) {
  const known = error as Partial<WorkbookEditError>;
  switch (known?.kind) {
    case "readOnly":
      return i18n.t("attachments.versions.errors.readOnly", { file });
    case "sheetMissing":
      return i18n.t("attachments.versions.errors.sheetMissing", { sheet: known.sheet, file });
    case "sheetProtected":
      return i18n.t("attachments.versions.errors.sheetProtected", { sheet: known.sheet });
    case "badCell":
      return i18n.t("attachments.versions.errors.badCell", { cell: known.cell });
    default:
      return i18n.t("attachments.versions.errors.damaged", { file });
  }
}

// The new versions a reply's changes make, each from the latest version of its file. One that can't be made is kept
// with why, so the reply says it.
export async function makeSheetVersions(messages: Message[], parsed: ParsedChange[]) {
  const attachments: Attachment[] = [];
  const versions: SheetVersion[] = [];
  for (const change of parsed) {
    const file = change.file ?? "";
    const cells = change.cells ?? [];
    const base = latestWorkbook([...messages, { role: "assistant", content: "", attachments }], file);
    const id = crypto.randomUUID();
    if (!base?.workbook) {
      const error = i18n.t("attachments.versions.errors.noAttachment", { file });
      versions.push({ id, file, number: 0, baseId: "", cells, cellsBefore: [], error });
      continue;
    }
    const number = versionNumberOf(base) + 1;
    try {
      const made = await editAttachedWorkbook(base.workbook, cells);
      // An .xls or .ods can only be written as a new .xlsx
      const name = made.converted ? asXlsxName(base.name) : base.name;
      attachments.push({
        id,
        kind: "text",
        name,
        mimeType: made.converted ? XLSX_TYPE : base.mimeType,
        data: made.text,
        workbook: made.workbook,
        version: { lineage: lineageOf(base), number },
      });
      const cellsBefore = made.before.map(({ sheet, cell, value, formula }) => ({ sheet, cell, value, ...(formula && { formula }) }));
      versions.push({ id, file: name, number, baseId: base.id, cells, cellsBefore });
    } catch (e) {
      versions.push({ id, file: base.name, number, baseId: base.id, cells, cellsBefore: [], error: editErrorText(e, base.name) });
    }
  }
  return { attachments, versions };
}
