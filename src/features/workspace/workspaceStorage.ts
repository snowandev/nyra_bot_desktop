import { invoke } from "@tauri-apps/api/core";
import type { CellChangeSpec, PdfVisual, WorkspaceFolder, WorkspaceSkipReason } from "@/shared/types";

// A folder connected to a conversation; Rust only reads folders picked in its dialog, and only files of their index

export type IndexedFile = { path: string; size: number; modified: number };

type IndexOutcome =
  | { kind: "ready"; files: IndexedFile[]; skipped: number; truncated: boolean }
  | { kind: "missing" }
  | { kind: "noAccess" };

type ReadOutcome =
  // ignored: not in the index (the .gitignore, node_modules), read because it was asked for by its exact path
  | { kind: "read"; content: string; totalLines: number; from: number; to: number; size: number; ignored?: boolean }
  // The file in base64; its text is read on this side, with the reader of attached PDFs
  | { kind: "pdf"; data: string; size: number; modified: number }
  // The version given as known: the frontend reads it from what it kept
  | { kind: "pdfUnchanged" }
  // An image of the folder (PNG, JPEG, WebP), for vision models
  | { kind: "image"; data: string; size: number; mimeType: string }
  | { kind: "skipped"; reason: WorkspaceSkipReason };

// What the model gets: a PDF already turned into its text, by page ("[Page 3]" lines) and, for vision models, with
// the pictures of its pages and figures (pageStarts: the line where each page begins); an image as its picture
export type TextReadOutcome =
  | Exclude<ReadOutcome, { kind: "pdf" | "pdfUnchanged" | "read" | "image" }>
  | (Extract<ReadOutcome, { kind: "read" }> & {
      pictures?: { pageStarts: number[]; visuals: PdfVisual[] };
      isImage?: boolean;
    });

export type SearchOutcome = { matches: { path: string; line: number; text: string }[]; total: number; truncated: boolean };

// remember is false in a private conversation: Rust allows the folder only until Nyra closes
export const pickWorkspaceFolder = (remember: boolean) =>
  invoke<WorkspaceFolder | null>("pick_workspace_folder", { remember });
export const indexWorkspace = (root: string) => invoke<IndexOutcome>("index_workspace", { root });
// known: the version of a PDF already read here, so Rust doesn't send it again if it is the same
export const readWorkspaceFile = (
  root: string,
  path: string,
  from?: number,
  to?: number,
  known?: { size: number; modified: number },
) => invoke<ReadOutcome>("read_workspace_file", { root, path, from, to, known });
export const searchWorkspace = (root: string, query: string) =>
  invoke<SearchOutcome>("search_workspace", { root, query });
export type OutlineOutcome = { entries: SearchOutcome["matches"]; files: number; truncated: boolean };
// The definitions of a folder's files (or of one file) with their lines: a map of the code without reading it
export const outlineWorkspace = (root: string, path: string) =>
  invoke<OutlineOutcome>("outline_workspace", { root, path });
// Folders no conversation uses any more lose Nyra's access and their vectors; inUse: those of the conversations in
// memory, which may not be saved yet. Returns the folders let go.
export const releaseUnusedWorkspaces = (inUse: string[]) =>
  invoke<string[]>("release_unused_workspaces", { inUse });
// An empty path shows the folder itself
export const revealWorkspaceFile = (root: string, path: string) =>
  invoke<void>("reveal_workspace_file", { root, path });

// Writing: only when the user applies a change; Rust keeps a copy of what was there to undo it

// How a text file is stored on disk; changes are written back the same way
export type TextEncoding = "utf8" | "windows1252" | "utf16Le" | "utf16Be";

// The text with "\n" line ends; crlf says the file uses "\r\n"
export type FileState =
  | { kind: "file"; content: string; modified: number; crlf: boolean; encoding: TextEncoding }
  | { kind: "missing" }
  | { kind: "protected"; reason: WorkspaceSkipReason };

type ApplyOutcome =
  | { kind: "applied"; backup: string; modified: number }
  | { kind: "conflict" }
  // A spreadsheet without the sheet or cell the change names
  | { kind: "noMatch" }
  // A workbook Nyra only reads: the changes went into a new .xlsx next to it
  | { kind: "copied"; backup: string; modified: number; path: string }
  | { kind: "protected"; reason: WorkspaceSkipReason };

// rows and columns: the last ones with something in them, counted from 1
export type WorkbookSheet = { name: string; hidden: boolean; protected: boolean; rows: number; columns: number };
// A formula starts with "="; value is what the file last saved for it, which may be empty
export type CellView = { cell: string; value: string; formula?: string };
export type WorkbookState =
  | { kind: "workbook"; modified: number; writable: boolean; sheets: WorkbookSheet[]; cells: CellView[] }
  | { kind: "missing" }
  | { kind: "protected"; reason: WorkspaceSkipReason };

type UndoOutcome = { kind: "undone"; modified: number | null } | { kind: "conflict" } | { kind: "gone" };

export const inspectWorkspaceFile = (root: string, path: string) =>
  invoke<FileState>("inspect_workspace_file", { root, path });
// expectedModified: the file's time when the model looked at it; undefined for a file it creates
export const applyWorkspaceChange = (
  root: string,
  path: string,
  content: string,
  format: { crlf: boolean; encoding: TextEncoding },
  expectedModified?: number,
) => invoke<ApplyOutcome>("apply_workspace_change", { root, path, content, ...format, expectedModified });
// The workbook as it is now, with the cells of one sheet the review asks for
export const inspectWorkspaceWorkbook = (root: string, path: string, sheet?: string, cells: string[] = []) =>
  invoke<WorkbookState>("inspect_workspace_workbook", { root, path, sheet: sheet ?? null, cells });
export const applyWorkspaceCells = (root: string, path: string, edits: CellChangeSpec[], expectedModified: number) =>
  invoke<ApplyOutcome>("apply_workspace_cells", { root, path, edits, expectedModified });
export const copyWorkspaceCellsAsXlsx = (root: string, path: string, edits: CellChangeSpec[]) =>
  invoke<ApplyOutcome>("copy_workspace_cells_as_xlsx", { root, path, edits });
export const undoWorkspaceChange = (root: string, path: string, backup: string, expectedModified: number) =>
  invoke<UndoOutcome>("undo_workspace_change", { root, path, backup, expectedModified });

// Searching the folder by meaning: Rust cuts the files into fragments and keeps their vectors; the vectors come from
// an embedding model in Ollama, asked from the frontend like every other request to a model
type MeaningChunk = { path: string; modified: number; startLine: number; endLine: number; text: string };
export type MeaningMatch = { path: string; startLine: number; endLine: number; score: number; text: string };
type EmbeddedChunk = Omit<MeaningChunk, "text"> & { vector: number[] };

export const meaningPending = (root: string, model: string) => invoke<string[]>("meaning_pending", { root, model });
export const meaningChunks = (root: string, paths: string[]) =>
  invoke<MeaningChunk[]>("meaning_chunks", { root, paths });
export const meaningStore = (root: string, model: string, chunks: EmbeddedChunk[]) =>
  invoke<void>("meaning_store", { root, model, chunks });
export const meaningSearch = (root: string, model: string, vector: number[], limit: number) =>
  invoke<MeaningMatch[]>("meaning_search", { root, model, vector, limit });
