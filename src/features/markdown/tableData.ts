import type { Element } from "hast";
import { textOf } from "./hastText";

// A table of a reply as data: to sort it, copy it and save it as a workbook. Numbers are told by their shape, not by
// the language, so "1.234,5", "1,234.5" and "1 234,5" are all read the same.

export type TableData = { header: string[]; rows: string[][] };
export type TableSort = { column: number; direction: "ascending" | "descending" };
// What Rust writes as a cell: a number only when the whole cell is one
type TableCell = { text: string; number: number | null };

const elements = (node: Element, tag: string) =>
  node.children.filter((child): child is Element => child.type === "element" && child.tagName === tag);

const cellsOf = (row: Element) =>
  row.children
    .filter((child): child is Element => child.type === "element" && (child.tagName === "th" || child.tagName === "td"))
    .map((cell) => textOf(cell).trim());

export function tableData(table: Element): TableData {
  const head = elements(table, "thead")[0];
  const body = elements(table, "tbody")[0];
  const header = head ? elements(head, "tr").flatMap(cellsOf) : [];
  const rows = body ? elements(body, "tr").map(cellsOf) : [];
  return { header, rows };
}

// The decimal mark comes from the shape: with both, the last; with one, decimal unless it groups thousands (three
// digits after it, and not after a lone 0: "0.125"). \s also covers the spaces that keep a number on one line.
function numberValue(written: string): number | null {
  const s = written.replace(/[\s']/g, "").replace(/^−/, "-");
  if (!/^[+-]?\d[\d.,]*$/.test(s) || /[.,]$/.test(s)) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let decimal: "." | "," | null = null;
  if (lastDot >= 0 && lastComma >= 0) decimal = lastDot > lastComma ? "." : ",";
  else if (lastDot >= 0 || lastComma >= 0) {
    const mark = lastDot >= 0 ? "." : ",";
    const [whole, ...groups] = s.split(mark);
    const groupsThousands = groups.every((g) => g.length === 3) && !/^[+-]?0$/.test(whole);
    if (groups.length > 1 && !groupsThousands) return null;
    decimal = groupsThousands ? null : mark;
  }
  const thousands = decimal === "." ? "," : decimal === "," ? "." : /[.,]/.exec(s)?.[0];
  const plain = (thousands ? s.split(thousands).join("") : s).replace(",", ".");
  return /^[+-]?\d+(\.\d+)?$/.test(plain) ? Number(plain) : null;
}

// The whole cell is a number: what a workbook can add up
export const cellNumber = (text: string) => numberValue(text.trim());

// A number with its currency, percent sign or a short unit around it still sorts as a number: "168 €", "$1,200", "45 %"
const WITH_UNIT = /^(?:\p{Sc}|[A-Z]{1,2}\$)?\s*([+\-−]?\d[\d.,\s']*)\s*(?:%|\p{Sc}|\p{L}{1,6}\.?)?$/u;

function sortNumber(text: string) {
  const match = WITH_UNIT.exec(text.trim());
  return match ? numberValue(match[1]) : null;
}

// The rows' positions in the sorted order. Empty cells go last either way; numbers before text.
export function sortedOrder(rows: string[][], { column, direction }: TableSort, locale: string): number[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const sign = direction === "ascending" ? 1 : -1;
  const keys = rows.map((row) => {
    const text = row[column]?.trim() ?? "";
    return { text, number: sortNumber(text) };
  });
  return rows
    .map((_, i) => i)
    .sort((a, b) => {
      const x = keys[a];
      const y = keys[b];
      if (!x.text || !y.text) return Number(!x.text) - Number(!y.text);
      if (x.number !== null && y.number !== null) return sign * (x.number - y.number);
      if (x.number !== null || y.number !== null) return x.number !== null ? -1 : 1;
      return sign * collator.compare(x.text, y.text);
    });
}

const tabCell = (text: string) => text.replace(/[\t\r\n]+/g, " ");

const htmlCell = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// As text, columns parted by tabs: a spreadsheet pasted into puts each value in its cell
export const tableTsv = ({ header, rows }: TableData) =>
  [header, ...rows].map((row) => row.map(tabCell).join("\t")).join("\n");

// As HTML, for apps that paste a table as a table
export function tableHtml({ header, rows }: TableData) {
  const row = (cells: string[], tag: "th" | "td") =>
    `<tr>${cells.map((cell) => `<${tag}>${htmlCell(cell)}</${tag}>`).join("")}</tr>`;
  return `<table><thead>${row(header, "th")}</thead><tbody>${rows.map((r) => row(r, "td")).join("")}</tbody></table>`;
}

export const tableCells = ({ header, rows }: TableData): TableCell[][] => [
  header.map((text) => ({ text, number: null })),
  ...rows.map((row) => row.map((text) => ({ text, number: cellNumber(text) }))),
];
