import { i18n } from "@/shared/i18n/i18n";
import type { ChangedRange } from "./fileChanges";
import { looksNumeric } from "./cellGrid";

// A CSV change shown as a table instead of lines. The change itself is still made line by line (SEARCH/REPLACE), so
// each changed block pairs its removed lines with its added ones: a pair is a changed row, and what is left over is
// rows added or removed.

export type CsvRow =
  | { kind: "same"; number: number; cells: string[] }
  | { kind: "modified"; number: number; cells: string[]; before: string[]; block: number }
  | { kind: "added"; number: number; cells: string[]; block: number }
  // number: where the row was in the original file
  | { kind: "removed"; number: number; cells: string[]; block: number };

const SEPARATORS = [",", ";", "\t", "|"];

export const isCsvPath = (path: string) => /\.(csv|tsv)$/i.test(path);

// The fields of one line; null when a quoted field goes on to the next line, which a line-by-line table can't show
export function splitCsvLine(line: string, separator: string): string[] | null {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"' && cell === "") {
      quoted = true;
    } else if (c === separator) {
      cells.push(cell);
      cell = "";
    } else {
      cell += c;
    }
  }
  if (quoted) return null;
  cells.push(cell);
  return cells;
}

// The separator that splits the first lines into the same number of fields, more than one
export function separatorOf(text: string) {
  const lines = text.split("\n").filter((l) => l.trim()).slice(0, 10);
  let best = { separator: ",", score: 0 };
  for (const separator of SEPARATORS) {
    const counts = lines.map((l) => splitCsvLine(l, separator)?.length ?? 0);
    const same = counts.length > 0 && counts.every((n) => n === counts[0]);
    const score = same && counts[0] > 1 ? counts[0] : 0;
    if (score > best.score) best = { separator, score };
  }
  return best.separator;
}

// The name a separator has for the user
export function separatorLabel(separator: string) {
  return separator === "\t" ? i18n.t("changes.csv.tab") : i18n.t("changes.csv.quoted", { separator });
}

// Every row of the file with what the change does to it; null when the file can't be shown as a table
export function csvDiffRows(original: string, ranges: ChangedRange[], separator: string): CsvRow[] | null {
  const lines = original.replace(/^\uFEFF/, "").replace(/\n$/, "").split("\n");
  const split = (line: string) => splitCsvLine(line, separator);
  const rows: CsvRow[] = [];
  let at = 0;
  let offset = 0;
  const same = (to: number) => {
    for (; at < to; at++) {
      const cells = split(lines[at]);
      if (!cells) return false;
      rows.push({ kind: "same", number: at + 1 + offset, cells });
    }
    return true;
  };
  for (const [block, range] of ranges.entries()) {
    if (!same(range.start)) return null;
    const pairs = Math.max(range.removed.length, range.added.length);
    for (let i = 0; i < pairs; i++) {
      const removed = i < range.removed.length ? split(range.removed[i]) : undefined;
      const added = i < range.added.length ? split(range.added[i]) : undefined;
      if (removed === null || added === null) return null;
      if (removed && added) rows.push({ kind: "modified", number: range.start + 1 + offset + i, cells: added, before: removed, block });
      else if (added) rows.push({ kind: "added", number: range.start + 1 + offset + i, cells: added, block });
      else if (removed) rows.push({ kind: "removed", number: range.start + 1 + i, cells: removed, block });
    }
    offset += range.added.length - range.removed.length;
    at = range.start + range.removed.length;
  }
  return same(lines.length) ? rows : null;
}

// A header is text above numbers: the first row has no number and a later one does
export function looksLikeHeader(rows: CsvRow[]) {
  const [first, ...rest] = rows;
  if (!first || first.cells.some(looksNumeric)) return false;
  return rest.slice(0, 20).some((row) => row.cells.some(looksNumeric));
}
