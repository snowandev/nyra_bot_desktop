import { describe, expect, it } from "vitest";
import { applyBlocks, changeStats, createdRows, diffRows, differingPart, preparingChanges, takeChanges } from "./fileChanges";

const reply = [
  "Te propongo esto:",
  '<nyra-edit path="src/App.tsx">',
  "<<<<<<< SEARCH",
  "  const a = 1;",
  "=======",
  "  const a = 2;",
  "  const b = 3;",
  ">>>>>>> REPLACE",
  "<<<<<<< SEARCH",
  "export default App;",
  "=======",
  "export { App };",
  ">>>>>>> REPLACE",
  "</nyra-edit>",
  '<nyra-create path="src/hooks/useHistory.ts">',
  "export function useHistory() {}",
  "</nyra-create>",
  "Revísalos antes de aplicarlos.",
].join("\n");

describe("takeChanges", () => {
  it("takes the edits and new files out of the reply", () => {
    const { changes, text } = takeChanges(reply);
    expect(text).toBe("Te propongo esto:\n\nRevísalos antes de aplicarlos.");
    expect(changes).toEqual([
      {
        kind: "edit",
        path: "src/App.tsx",
        blocks: [
          { search: "  const a = 1;", replace: "  const a = 2;\n  const b = 3;" },
          { search: "export default App;", replace: "export { App };" },
        ],
      },
      { kind: "create", path: "src/hooks/useHistory.ts", blocks: [], content: "export function useHistory() {}\n" },
    ]);
  });

  it("reads a path written with Windows separators as the folder's file", () => {
    const { changes } = takeChanges('<nyra-create path=".\\src\\nuevo.ts">x</nyra-create>');
    expect(changes[0].path).toBe("src/nuevo.ts");
  });

  it("drops an unfinished tag and an edit without blocks", () => {
    expect(takeChanges('Hola\n<nyra-edit path="a.ts">\n<<<<<<< SEARCH\nx').changes).toEqual([]);
    expect(takeChanges('<nyra-edit path="a.ts">nada</nyra-edit>Fin').changes).toEqual([]);
  });
});

describe("preparingChanges", () => {
  it("hides the tags while they arrive and says which files are coming", () => {
    expect(preparingChanges('Voy:\n<nyra-edit path="src/App.tsx">\n<<<<<<< SE')).toEqual({ text: "Voy:", paths: ["src/App.tsx"] });
    expect(preparingChanges("Voy:\n<nyra-ed").text).toBe("Voy:");
    expect(preparingChanges('Voy:\n<nyra-create path="x').text).toBe("Voy:");
  });
});

describe("applyBlocks", () => {
  const original = "import x;\nfunction App() {\n  const a = 1;   \n}\nexport default App;\n";

  it("applies the blocks in order, tolerating trailing spaces", () => {
    const { changes } = takeChanges(reply);
    const result = applyBlocks(original, changes[0].blocks);
    expect("content" in result && result.content).toBe(
      "import x;\nfunction App() {\n  const a = 2;\n  const b = 3;\n}\nexport { App };\n",
    );
  });

  it("says which block doesn't match", () => {
    expect(applyBlocks(original, [{ search: "  const a = 1;", replace: "x" }, { search: "nope", replace: "" }])).toEqual({
      failedBlock: 1,
    });
    // Indentation is part of the line: without it the block doesn't match
    expect(applyBlocks(original, [{ search: "const a = 1;", replace: "x" }])).toEqual({ failedBlock: 0 });
  });
});

describe("diffRows", () => {
  it("shows each change under a header, with numbers on both sides, and folds far lines", () => {
    const original = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
    const result = applyBlocks(original, [{ search: "line 20", replace: "line 20a\nline 20b" }]);
    if (!("ranges" in result)) throw new Error("no encaja");
    const rows = diffRows(original, result.ranges, new Set());
    expect(rows[0]).toEqual({ kind: "fold", key: "before-0", count: 16, from: 1 });
    expect(rows.find((r) => r.kind === "header")).toEqual({ kind: "header", block: 0, total: 1, line: 20 });
    expect(rows.filter((r) => r.kind === "change")).toEqual([
      { kind: "change", block: 0, removed: { n: 20, text: "line 20" }, added: { n: 20, text: "line 20a" } },
      { kind: "change", block: 0, added: { n: 21, text: "line 20b" } },
    ]);
    const after = rows.filter((r) => r.kind === "context").at(-1);
    expect(after).toEqual({ kind: "context", a: 23, b: 24, text: "line 23" });
    expect(diffRows(original, result.ranges, new Set(["before-0", "after"])).some((r) => r.kind === "fold")).toBe(false);
  });

  it("shows a new file as added lines", () => {
    expect(createdRows("a\nb\n").filter((r) => r.kind === "change")).toHaveLength(2);
  });
});

it("counts lines and marks the part of a line that changed", () => {
  const { changes } = takeChanges(reply);
  expect(changeStats(changes[0])).toEqual({ added: 3, removed: 2, blocks: 2 });
  expect(changeStats(changes[1])).toEqual({ added: 1, removed: 0, blocks: 1 });
  expect(differingPart("const a = 1;", "const a = 2;")).toEqual({ before: "const a = ", changed: "1", after: ";" });
});

it("accepts the ways local models end a pair", () => {
  const body = (end: string) =>
    `<nyra-edit path="a.ts">\n<<<<<<< SEARCH\nold\n=======\nnew\n${end}</nyra-edit>`;
  for (const end of [">>>>>>> REPLACE\n", "=======\n", ""]) {
    expect(takeChanges(body(end)).changes[0]?.blocks).toEqual([{ search: "old", replace: "new" }]);
  }
  const twoWithoutClosing = '<nyra-edit path="a.ts">\n<<<<<<< SEARCH\na\n=======\nb\n<<<<<<< SEARCH\nc\n=======\nd\n</nyra-edit>';
  expect(takeChanges(twoWithoutClosing).changes[0]?.blocks).toEqual([
    { search: "a", replace: "b" },
    { search: "c", replace: "d" },
  ]);
});

describe("spreadsheet changes", () => {
  it("reads cells by sheet and joins the sheets of one workbook in a single change", () => {
    const reply = [
      "Actualizo la luz y el total.",
      '<nyra-cells path="cuentas/gastos.xlsx" sheet="Enero">',
      "B3: 120",
      "$d$10: =SUM(D2:D9) → 1600",
      "C4:",
      "esto no es una celda",
      "</nyra-cells>",
      '<nyra-cells sheet="Resumen" path="cuentas/gastos.xlsx">',
      "A1: Total anual",
      "</nyra-cells>",
      '<nyra-cells path="cuentas/gastos.xlsx" sheet="Enero">',
      "B3: 130",
      "</nyra-cells>",
    ].join("\n");
    const { changes, text } = takeChanges(reply);
    expect(text).toBe("Actualizo la luz y el total.");
    expect(changes).toEqual([
      {
        kind: "cells",
        path: "cuentas/gastos.xlsx",
        blocks: [],
        cells: [
          { sheet: "Enero", cell: "D10", value: "=SUM(D2:D9) → 1600" },
          { sheet: "Enero", cell: "C4", value: "" },
          { sheet: "Resumen", cell: "A1", value: "Total anual" },
          { sheet: "Enero", cell: "B3", value: "130" },
        ],
      },
    ]);
    expect(changeStats(changes[0])).toEqual({ added: 4, removed: 0, blocks: 4 });
  });

  it("ignores a block without a sheet or without cells", () => {
    const reply = '<nyra-cells path="a.xlsx">\nB3: 1\n</nyra-cells><nyra-cells path="a.xlsx" sheet="H">\n</nyra-cells>';
    expect(takeChanges(reply).changes).toEqual([]);
  });

  it("hides a cells block while it is being written", () => {
    expect(preparingChanges('Listo:\n<nyra-cells path="a.xlsx" sheet="H">\nB3: 1')).toEqual({
      text: "Listo:",
      paths: ["a.xlsx"],
    });
    expect(preparingChanges("Listo:\n<nyra-ce").text).toBe("Listo:");
  });
});

describe("changes to attached spreadsheets", () => {
  it("name the attachment with file instead of a folder path", () => {
    const { changes } = takeChanges('<nyra-cells file="Gastos.xlsx" sheet="Gastos">\nC3: 120\n</nyra-cells>');
    expect(changes).toEqual([
      { kind: "cells", path: "", file: "Gastos.xlsx", blocks: [], cells: [{ sheet: "Gastos", cell: "C3", value: "120" }] },
    ]);
  });
});
