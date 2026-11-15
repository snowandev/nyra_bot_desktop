import { i18n } from "@/shared/i18n/i18n";
import type { CellChangeSpec } from "@/shared/types";
import type { CellView } from "./workspaceStorage";

// What the review of a spreadsheet shows: the changed cells in their place, with the headers (row 1, column A) and one
// row and column around each change; the rest folds into "Filas 4–9 sin cambios" or a narrow "E–H" column.

type CellKind = "modified" | "added" | "emptied";

export type CellChange = {
  sheet: string;
  cell: string;
  row: number;
  column: number;
  before: CellView;
  after: string;
  kind: CellKind;
};

// Rows count from 1, as the user sees them; columns from 0, as letters
type GridRow = { row: number } | { fold: true; from: number; to: number };
type GridColumn = { column: number } | { fold: true; from: number; to: number };

// A run of hidden rows or columns shorter than this is shown: folding a single row hides nothing worth it
const MIN_FOLD = 2;
const CONTEXT = 1;

export function columnName(index: number) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

export function cellPosition(cell: string): { row: number; column: number } | null {
  const match = cell.toUpperCase().match(/^\$?([A-Z]{1,3})\$?(\d+)$/);
  if (!match) return null;
  const column = [...match[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  return { row: Number(match[2]), column };
}

export const cellName = (row: number, column: number) => `${columnName(column)}${row}`;

export const isEmptyCell = (view: CellView | undefined) => !view || (view.value === "" && !view.formula);

export function kindOf(before: CellView | undefined, after: string): CellKind {
  if (isEmptyCell(before)) return "added";
  return after.trim() === "" ? "emptied" : "modified";
}

export const isFormula = (text: string | undefined) => !!text?.trim().startsWith("=");

// The changes of a spreadsheet with what each cell holds now, sheet by sheet in the order the model wrote them
export function cellChanges(specs: CellChangeSpec[], before: (sheet: string, cell: string) => CellView | undefined) {
  return specs.flatMap((spec): CellChange[] => {
    const at = cellPosition(spec.cell);
    if (!at) return [];
    const now = before(spec.sheet, spec.cell) ?? { cell: spec.cell, value: "" };
    return [{ ...spec, ...at, before: now, after: spec.value.trim(), kind: kindOf(now, spec.value) }];
  });
}

// Shown indexes with the hidden runs folded; expanded runs stay open
function withFolds<T>(
  count: number,
  first: number,
  shown: Set<number>,
  expanded: Set<number>,
  item: (i: number) => T,
  fold: (from: number, to: number) => T,
) {
  const out: T[] = [];
  for (let i = first; i < first + count; ) {
    if (shown.has(i) || expanded.has(i)) {
      out.push(item(i++));
      continue;
    }
    let end = i;
    while (end < first + count && !shown.has(end) && !expanded.has(end)) end++;
    if (end - i < MIN_FOLD) for (let k = i; k < end; k++) out.push(item(k));
    else out.push(fold(i, end - 1));
    i = end;
  }
  return out;
}

export function gridLayout(
  changes: Pick<CellChange, "row" | "column">[],
  size: { rows: number; columns: number },
  expanded: { rows: Set<number>; columns: Set<number> },
) {
  const rowCount = Math.max(size.rows, 1, ...changes.map((c) => c.row));
  const columnCount = Math.max(size.columns, 1, ...changes.map((c) => c.column + 1));
  const rows = new Set([1]);
  const columns = new Set([0]);
  for (const { row, column } of changes) {
    for (let d = -CONTEXT; d <= CONTEXT; d++) {
      rows.add(row + d);
      columns.add(column + d);
    }
  }
  return {
    rows: withFolds<GridRow>(rowCount, 1, rows, expanded.rows, (row) => ({ row }), (from, to) => ({ fold: true, from, to })),
    columns: withFolds<GridColumn>(
      columnCount,
      0,
      columns,
      expanded.columns,
      (column) => ({ column }),
      (from, to) => ({ fold: true, from, to }),
    ),
  };
}

// "XLSX" for "finanzas/presupuesto.xlsx"
export const fileExtension = (path: string) => path.split(".").pop()?.toUpperCase() ?? "";

// "Enero · 4 celdas", one per sheet
export function sheetsSummary(cells: CellChangeSpec[]) {
  const sheets = [...new Set(cells.map((c) => c.sheet))];
  return sheets.map((sheet) => `${sheet} · ${i18n.t("cells.count", { count: cells.filter((c) => c.sheet === sheet).length })}`);
}

// Sheet by sheet, in the order they were first named, so "Cambio 3 de 5" walks the file once
export function orderedBySheet(changes: CellChange[]) {
  const sheets = [...new Set(changes.map((c) => c.sheet))];
  return sheets.flatMap((sheet) => changes.filter((c) => c.sheet === sheet));
}

// Every cell the grid shows, to read them from the workbook at once
export function visibleCells(layout: ReturnType<typeof gridLayout>) {
  const rows = layout.rows.flatMap((r) => ("row" in r ? [r.row] : []));
  const columns = layout.columns.flatMap((c) => ("column" in c ? [c.column] : []));
  return rows.flatMap((row) => columns.map((column) => cellName(row, column)));
}

// Numbers read right-aligned, as in a spreadsheet
export const looksNumeric = (text: string) => /^-?\d[\d.,]*(e[+-]?\d+)?%?$/i.test(text.trim());
