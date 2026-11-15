import { invoke } from "@tauri-apps/api/core";
import type { CellChangeSpec } from "@/shared/types";
import type { CellView, WorkbookSheet } from "@/features/workspace/workspaceStorage";

// The file goes as the raw request body, so megabytes don't travel through JSON as arrays of numbers
export const readSpreadsheet = (bytes: Uint8Array) => invoke<string>("read_spreadsheet", bytes);

// Why a version couldn't be made, as Rust says it
export type WorkbookEditError =
  | { kind: "readOnly" }
  | { kind: "damaged" }
  | { kind: "sheetMissing"; sheet: string }
  | { kind: "sheetProtected"; sheet: string }
  | { kind: "badCell"; cell: string };

// converted: made from an .xls or .ods, so it is an .xlsx now
type AttachedVersion = {
  workbook: string;
  text: string;
  before: (CellView & { sheet: string })[];
  converted: boolean;
};

// The attached file (base64) never changes: the edits make a new one
export const editAttachedWorkbook = (workbook: string, edits: CellChangeSpec[]) =>
  invoke<AttachedVersion>("edit_attached_workbook", { workbook, edits });

export const attachedWorkbookView = (workbook: string, sheet: string | undefined, cells: string[]) =>
  invoke<{ writable: boolean; sheets: WorkbookSheet[]; cells: CellView[] }>("attached_workbook_view", {
    workbook,
    sheet: sheet ?? null,
    cells,
  });

// false when the user closes the save dialog
export const saveSpreadsheet = (filename: string, workbook: string) =>
  invoke<boolean>("save_spreadsheet", { filename, workbook });
