import type { Element } from "hast";
import { describe, expect, it } from "vitest";
import { cellNumber, sortedOrder, tableCells, tableData, tableHtml, tableTsv } from "./tableData";

const cell = (tag: "th" | "td", text: string): Element => ({
  type: "element",
  tagName: tag,
  properties: {},
  children: [{ type: "text", value: text }],
});
const row = (tag: "th" | "td", texts: string[]): Element => ({
  type: "element",
  tagName: "tr",
  properties: {},
  children: texts.map((text) => cell(tag, text)),
});
const section = (tag: string, rows: Element[]): Element => ({ type: "element", tagName: tag, properties: {}, children: rows });

const table: Element = {
  type: "element",
  tagName: "table",
  properties: {},
  children: [
    section("thead", [row("th", ["Mes", "Ingresos"])]),
    section("tbody", [row("td", ["Enero", "168 €"]), row("td", ["Mayo", "1.420 €"]), row("td", ["Junio", ""])]),
  ],
};

describe("tableData", () => {
  it("reads the header and the rows", () => {
    expect(tableData(table)).toEqual({
      header: ["Mes", "Ingresos"],
      rows: [
        ["Enero", "168 €"],
        ["Mayo", "1.420 €"],
        ["Junio", ""],
      ],
    });
  });
});

describe("cellNumber", () => {
  it("reads numbers however they are written", () => {
    expect(cellNumber("1.234,5")).toBe(1234.5);
    expect(cellNumber("1,234.5")).toBe(1234.5);
    expect(cellNumber("1 234,5")).toBe(1234.5);
    expect(cellNumber("12,5")).toBe(12.5);
    expect(cellNumber("1.234.567")).toBe(1234567);
    expect(cellNumber("0.125")).toBe(0.125);
    expect(cellNumber("−12")).toBe(-12);
  });

  it("leaves anything else as text", () => {
    for (const text of ["168 €", "45 %", "S1", "12.5.3", "2025-06", "", "1,"]) expect(cellNumber(text)).toBeNull();
  });
});

describe("sortedOrder", () => {
  const rows = [["Enero", "168 €"], ["Mayo", "1.420 €"], ["Junio", ""], ["abril", "$90"]];

  it("sorts numbers with their units as numbers, and leaves empty cells last", () => {
    expect(sortedOrder(rows, { column: 1, direction: "ascending" }, "es")).toEqual([3, 0, 1, 2]);
    expect(sortedOrder(rows, { column: 1, direction: "descending" }, "es")).toEqual([1, 0, 3, 2]);
  });

  it("sorts text in the language's order, without minding capitals", () => {
    expect(sortedOrder(rows, { column: 0, direction: "ascending" }, "es")).toEqual([3, 0, 2, 1]);
  });
});

describe("copies of the table", () => {
  const data = { header: ["Mes", "Nota"], rows: [["Enero", "a\tb <x>"]] };

  it("parts columns with tabs for spreadsheets, and escapes the HTML", () => {
    expect(tableTsv(data)).toBe("Mes\tNota\nEnero\ta b <x>");
    expect(tableHtml(data)).toBe(
      "<table><thead><tr><th>Mes</th><th>Nota</th></tr></thead><tbody><tr><td>Enero</td><td>a\tb &lt;x&gt;</td></tr></tbody></table>",
    );
  });

  it("marks as numbers only the cells that are a number, never the header", () => {
    expect(tableCells({ header: ["2025"], rows: [["1.234,5"], ["168 €"]] })).toEqual([
      [{ text: "2025", number: null }],
      [{ text: "1.234,5", number: 1234.5 }],
      [{ text: "168 €", number: null }],
    ]);
  });
});
