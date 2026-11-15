import { describe, expect, it } from "vitest";
import { cellChanges, cellPosition, columnName, gridLayout, kindOf, visibleCells } from "./cellGrid";

const none = { rows: new Set<number>(), columns: new Set<number>() };

describe("cell names", () => {
  it("reads and writes positions as a spreadsheet does", () => {
    expect(columnName(0)).toBe("A");
    expect(columnName(27)).toBe("AB");
    expect(cellPosition("$c$14")).toEqual({ row: 14, column: 2 });
    expect(cellPosition("14C")).toBeNull();
  });
});

describe("kindOf", () => {
  it("tells changed, new and emptied cells apart", () => {
    expect(kindOf({ cell: "C3", value: "100" }, "120")).toBe("modified");
    expect(kindOf({ cell: "C7", value: "" }, "45")).toBe("added");
    expect(kindOf(undefined, "45")).toBe("added");
    expect(kindOf({ cell: "J9", value: "Revisar" }, "")).toBe("emptied");
    expect(kindOf({ cell: "C14", value: "", formula: "=SUM(C2:C12)" }, "=SUM(C2:C13)")).toBe("modified");
  });
});

describe("gridLayout", () => {
  it("keeps the headers and one row and column around each change, and folds the rest", () => {
    const layout = gridLayout([{ row: 9, column: 6 }], { rows: 14, columns: 12 }, none);
    expect(layout.rows).toEqual([
      { row: 1 },
      { fold: true, from: 2, to: 7 },
      { row: 8 },
      { row: 9 },
      { row: 10 },
      { fold: true, from: 11, to: 14 },
    ]);
    expect(layout.columns).toEqual([
      { column: 0 },
      { fold: true, from: 1, to: 4 },
      { column: 5 },
      { column: 6 },
      { column: 7 },
      { fold: true, from: 8, to: 11 },
    ]);
  });

  it("shows a single hidden row instead of folding it, and opens what the user expanded", () => {
    const layout = gridLayout([{ row: 4, column: 0 }], { rows: 6, columns: 1 }, { rows: new Set([6]), columns: new Set() });
    expect(layout.rows).toEqual([{ row: 1 }, { row: 2 }, { row: 3 }, { row: 4 }, { row: 5 }, { row: 6 }]);
  });

  it("reaches cells added past the end of the sheet", () => {
    const layout = gridLayout([{ row: 20, column: 3 }], { rows: 4, columns: 2 }, none);
    // The context stops at the last row and column with data or a change
    expect(layout.rows.at(-1)).toEqual({ row: 20 });
    expect(layout.columns.at(-1)).toEqual({ column: 3 });
    expect(visibleCells(gridLayout([{ row: 2, column: 1 }], { rows: 3, columns: 2 }, none))).toEqual([
      "A1",
      "B1",
      "A2",
      "B2",
      "A3",
      "B3",
    ]);
  });
});

describe("cellChanges", () => {
  it("pairs each change with what the cell holds now", () => {
    const changes = cellChanges(
      [
        { sheet: "Enero", cell: "C3", value: "120" },
        { sheet: "Enero", cell: "nope", value: "1" },
      ],
      (sheet, cell) => (sheet === "Enero" && cell === "C3" ? { cell, value: "100" } : undefined),
    );
    expect(changes).toEqual([
      { sheet: "Enero", cell: "C3", value: "120", row: 3, column: 2, before: { cell: "C3", value: "100" }, after: "120", kind: "modified" },
    ]);
  });
});
