import {
  applyWorkspaceCells,
  applyWorkspaceChange,
  copyWorkspaceCellsAsXlsx,
  type CellView,
  type FileState,
  inspectWorkspaceFile,
  inspectWorkspaceWorkbook,
  undoWorkspaceChange,
  type WorkbookSheet,
  type WorkbookState,
} from "./workspaceStorage";
import { i18n } from "@/shared/i18n/i18n";
import { withSecretsHidden } from "@/features/sensitive-data/sensitiveData";
import type { Message, ProposedChange } from "@/shared/types";
import { applyBlocks, type ChangedRange, changeAsText, type ParsedChange, takeChanges } from "./fileChanges";
import { estimateTextTokens } from "@/features/chat/reply/summary";
import { asAttribute, neutralizeAppTags } from "@/features/chat/reply/appTags";

// What happens to a proposed change on disk: checked when the reply ends, again when it is reviewed and when it is
// applied. Every check reads the file as it is now.

type Checked = { change: ProposedChange; state: FileState; content?: string; ranges?: ChangedRange[] };

// The change as the file is now: whether it can still be applied, and what it would write
async function check(change: ProposedChange): Promise<Checked> {
  const state = await inspectWorkspaceFile(change.root, change.path);
  const settled = change.status === "applied" || change.status === "discarded";
  const set = (patch: Partial<ProposedChange>): ProposedChange => (settled ? change : { ...change, ...patch });
  if (state.kind === "protected") return { change: set({ status: "protected", reason: state.reason }), state };
  if (change.kind === "create") {
    if (state.kind === "file" && change.status !== "applied") return { change: set({ status: "conflict" }), state };
    return { change, state, content: change.content ?? "" };
  }
  if (state.kind === "missing") return { change: set({ status: "protected", reason: "missing" }), state };
  if (change.baseModified !== undefined && state.modified !== change.baseModified && !settled) {
    return { change: set({ status: "conflict" }), state };
  }
  const result = applyBlocks(state.content, change.blocks);
  if ("failedBlock" in result) return { change: set({ status: "noMatch", failedBlock: result.failedBlock }), state };
  return { change, state, content: result.content, ranges: result.ranges };
}

// A spreadsheet: whether its cells can still be written, read from the workbook as it is now
async function checkCells(change: ProposedChange): Promise<{ change: ProposedChange; state: WorkbookState }> {
  const state = await inspectWorkspaceWorkbook(change.root, change.path);
  const settled = change.status === "applied" || change.status === "discarded";
  const set = (patch: Partial<ProposedChange>) => ({ change: settled ? change : { ...change, ...patch }, state });
  if (state.kind === "protected") return set({ status: "protected", reason: state.reason });
  if (state.kind === "missing") return set({ status: "protected", reason: "missing" });
  if (!state.writable) return set({ status: "protected", reason: "readOnly" });
  const touched = new Set((change.cells ?? []).map((c) => c.sheet));
  const sheets = new Map(state.sheets.map((s) => [s.name, s]));
  if ([...touched].some((name) => !sheets.has(name))) return set({ status: "noMatch" });
  if ([...touched].some((name) => sheets.get(name)?.protected)) return set({ status: "protected", reason: "sheetProtected" });
  if (change.baseModified !== undefined && state.modified !== change.baseModified) return set({ status: "conflict" });
  return { change, state };
}

const modifiedOfState = (state: FileState | WorkbookState) =>
  state.kind === "file" || state.kind === "workbook" ? state.modified : undefined;

// The cards of a finished reply. modifiedOf: the files' times when the reply started, so a file edited while the
// model worked shows as changed instead of being overwritten later.
export async function proposeChanges(root: string, parsed: ParsedChange[], modifiedOf: Map<string, number>) {
  return Promise.all(
    parsed.map(async (p): Promise<ProposedChange> => {
      const change: ProposedChange = { id: crypto.randomUUID(), root, ...p, status: "pending" };
      const inspect = p.kind === "cells" ? inspectWorkspaceWorkbook : inspectWorkspaceFile;
      const state = await inspect(root, p.path).catch((): FileState => ({ kind: "missing" }));
      const current = modifiedOfState(state);
      const baseModified = current === undefined ? undefined : (modifiedOf.get(p.path) ?? current);
      const based = { ...change, ...(baseModified !== undefined && { baseModified }) };
      return (await (p.kind === "cells" ? checkCells(based) : check(based))).change;
    }),
  );
}

// For the review of a spreadsheet: its sheets and what each changed cell holds now
export type CellsReview = { sheets: WorkbookSheet[]; before: Map<string, CellView> };

export const cellKey = (sheet: string, cell: string) => `${sheet}!${cell}`;

export async function reviewCells(change: ProposedChange): Promise<{ change: ProposedChange } & CellsReview> {
  const checked = await checkCells(change);
  const before = new Map<string, CellView>();
  if (checked.state.kind !== "workbook") return { change: checked.change, sheets: [], before };
  const sheetNames = [...new Set((change.cells ?? []).map((c) => c.sheet))];
  for (const sheet of sheetNames) {
    const cells = (change.cells ?? []).filter((c) => c.sheet === sheet).map((c) => c.cell);
    const state = await inspectWorkspaceWorkbook(change.root, change.path, sheet, cells);
    if (state.kind === "workbook") for (const view of state.cells) before.set(cellKey(sheet, view.cell), view);
  }
  return { change: checked.change, sheets: checked.state.sheets, before };
}

// For the review: the original next to the proposal, if the change still fits the file
export async function reviewChange(change: ProposedChange) {
  const checked = await check(change);
  const file = checked.state.kind === "file" ? checked.state : null;
  return {
    change: checked.change,
    original: file?.content ?? "",
    ranges: checked.ranges ?? [],
    crlf: file?.crlf ?? false,
    encoding: file?.encoding ?? "utf8",
  };
}

async function applyCells(change: ProposedChange): Promise<ProposedChange> {
  const checked = await checkCells({ ...change, status: change.status === "undone" ? "pending" : change.status });
  if (checked.change.status !== "pending" || checked.state.kind !== "workbook") return checked.change;
  // Kept with the change: once written, the file only has the new values
  const { before } = await reviewCells(change);
  const cellsBefore = [...before].map(([key, view]) => ({ ...view, sheet: key.slice(0, key.lastIndexOf("!")) }));
  const outcome = await applyWorkspaceCells(change.root, change.path, change.cells ?? [], checked.state.modified);
  if (outcome.kind === "conflict") return { ...change, status: "conflict" };
  if (outcome.kind === "noMatch") return { ...change, status: "noMatch" };
  if (outcome.kind === "protected") return { ...change, status: "protected", reason: outcome.reason };
  return { ...change, status: "applied", cellsBefore, applied: { backup: outcome.backup, modified: outcome.modified } };
}

// A workbook Nyra only reads (.xls, .ods): the changes go into a new .xlsx next to it, and the original stays
export async function copyAsXlsx(change: ProposedChange): Promise<ProposedChange> {
  const { before } = await reviewCells(change);
  const cellsBefore = [...before].map(([key, view]) => ({ ...view, sheet: key.slice(0, key.lastIndexOf("!")) }));
  const outcome = await copyWorkspaceCellsAsXlsx(change.root, change.path, change.cells ?? []);
  if (outcome.kind === "noMatch") return { ...change, status: "noMatch" };
  if (outcome.kind !== "copied") throw new Error(i18n.t("changes.error.copyFailed"));
  return {
    ...change,
    status: "applied",
    cellsBefore,
    copiedTo: outcome.path,
    applied: { backup: outcome.backup, modified: outcome.modified },
  };
}

// What Nyra is asked when a spreadsheet change no longer fits: it reads the workbook again and proposes it anew. It is
// sent as the user's message, so it is written in the interface's language like anything the user types.
export function cellsRetryText(change: ProposedChange) {
  return i18n.t(change.status === "conflict" ? "changes.ask.cellsConflict" : "changes.ask.cellsMissing", {
    path: change.path,
  });
}

export async function applyChange(change: ProposedChange): Promise<ProposedChange> {
  if (change.kind === "cells") return applyCells(change);
  const checked = await check({ ...change, status: change.status === "undone" ? "pending" : change.status });
  if (checked.content === undefined || checked.change.status !== "pending") return checked.change;
  const file = checked.state.kind === "file" ? checked.state : null;
  // A new file is written in UTF-8 with "\n"; an existing one keeps its line ends and its encoding
  const format = { crlf: file?.crlf ?? false, encoding: file?.encoding ?? ("utf8" as const) };
  const outcome = await applyWorkspaceChange(change.root, change.path, checked.content, format, file?.modified);
  if (outcome.kind === "conflict" || outcome.kind === "noMatch") return { ...change, status: "conflict" };
  if (outcome.kind === "protected") return { ...change, status: "protected", reason: outcome.reason };
  return { ...change, status: "applied", applied: { backup: outcome.backup, modified: outcome.modified } };
}

// Past this share of the model's context, the file and the change don't fit in a request of their own
const FIX_CONTEXT_SHARE = 0.7;
const DEFAULT_CONTEXT = 32_768;

// For the model to redo a change that doesn't fit the file as it is now; asked apart from the conversation
export function fixRequest(change: ProposedChange, content: string): Message {
  const problem =
    change.status === "conflict"
      ? "The file changed after you read it, so the change may no longer fit."
      : "In one of its pairs, the lines to replace are not written that way in the file.";
  // The model never gets a secret's value, as when it read the file; a fix that touches one doesn't fit and is refused
  return {
    role: "user",
    content:
      `<app-instructions>\nYou proposed a change to ${asAttribute(change.path)}. ${problem} Below are the file as ` +
      "it is now and the change you proposed. Write the same change again as one <nyra-edit> block for this file, " +
      "with SEARCH parts that copy the file's current lines exactly. Answer with the block only.\n</app-instructions>\n" +
      `<file path="${asAttribute(change.path)}">\n${neutralizeAppTags(withSecretsHidden(content).text)}\n</file>\n` +
      `<proposed-change>\n${neutralizeAppTags(changeAsText(change))}\n</proposed-change>`,
  };
}

// "Pedir que lo corrija" without leaving the card: the model gets the file as it is now and its change, and the new
// blocks are kept only if they fit. ask sends one request to the model and resolves with its reply.
export async function fixChange(
  change: ProposedChange,
  contextWindow: number | undefined,
  ask: (request: Message) => Promise<string>,
): Promise<ProposedChange> {
  const state = await inspectWorkspaceFile(change.root, change.path);
  if (state.kind !== "file") throw new Error(i18n.t("changes.error.fileGone"));
  const request = fixRequest(change, state.content);
  if (estimateTextTokens(request.content) > (contextWindow ?? DEFAULT_CONTEXT) * FIX_CONTEXT_SHARE) {
    throw new Error(i18n.t("changes.error.tooLargeToFix"));
  }
  const reply = await ask(request);
  const fixed = takeChanges(reply).changes.find((c) => c.kind === "edit" && c.path === change.path);
  if (!fixed || "failedBlock" in applyBlocks(state.content, fixed.blocks)) {
    throw new Error(i18n.t("changes.error.fixFailed"));
  }
  const rest = { ...change };
  delete rest.failedBlock;
  return { ...rest, blocks: fixed.blocks, status: "pending", reviewed: false, corrected: true, baseModified: state.modified };
}

// Throws with the reason when it can't be undone, so the card can say it
export async function undoChange(change: ProposedChange): Promise<ProposedChange> {
  if (!change.applied) return change;
  // A copy of a read-only workbook is removed; the original was never touched
  const path = change.copiedTo ?? change.path;
  const outcome = await undoWorkspaceChange(change.root, path, change.applied.backup, change.applied.modified);
  if (outcome.kind === "conflict") {
    throw new Error(i18n.t("changes.error.undoConflict"));
  }
  if (outcome.kind === "gone") throw new Error(i18n.t("changes.error.backupGone"));
  const rest = { ...change };
  delete rest.applied;
  if (change.copiedTo) {
    delete rest.copiedTo;
    return { ...rest, status: "protected", reason: "readOnly" };
  }
  return { ...rest, status: "undone", ...(outcome.modified !== null && { baseModified: outcome.modified }) };
}
