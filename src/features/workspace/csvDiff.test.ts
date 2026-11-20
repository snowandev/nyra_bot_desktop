import { describe, expect, it } from "vitest";
import { csvDiffRows, isCsvPath, looksLikeHeader, separatorOf, splitCsvLine } from "./csvDiff";
import { applyBlocks } from "./fileChanges";

const file = ["fecha;cliente;importe", "2026-09-01;Lumen;80,00", "2026-09-02;Notus;45,50", "2026-09-03;Marea;12,00", ""].join("\n");

describe("reading a CSV", () => {
  it("finds the separator that splits every line the same way", () => {
    expect(separatorOf(file)).toBe(";");
    expect(separatorOf("a,b\n1,2\n")).toBe(",");
    expect(separatorOf("a\tb\n1\t2\n")).toBe("\t");
  });

  it("splits quoted fields with separators and quotes inside", () => {
    expect(splitCsvLine('"Taller 9, S.L.",12,"dice ""hola"""', ",")).toEqual(["Taller 9, S.L.", "12", 'dice "hola"']);
    expect(splitCsvLine('"empieza aquí', ",")).toBeNull();
  });

  it("knows a CSV file by its extension, whatever its case", () => {
    expect(isCsvPath("datos/Ventas.CSV")).toBe(true);
  });
});

describe("csvDiffRows", () => {
  it("shows changed, added and removed rows in their place", () => {
    const result = applyBlocks(file, [
      { search: "2026-09-01;Lumen;80,00", replace: "2026-09-01;Lumen;85,00" },
      { search: "2026-09-03;Marea;12,00", replace: "2026-09-04;Kora;20,00\n2026-09-05;Ateneo;7,00" },
    ]);
    if ("failedBlock" in result) throw new Error("no encaja");
    const rows = csvDiffRows(file, result.ranges, ";");
    expect(rows).toEqual([
      { kind: "same", number: 1, cells: ["fecha", "cliente", "importe"] },
      { kind: "modified", number: 2, cells: ["2026-09-01", "Lumen", "85,00"], before: ["2026-09-01", "Lumen", "80,00"], block: 0 },
      { kind: "same", number: 3, cells: ["2026-09-02", "Notus", "45,50"] },
      { kind: "modified", number: 4, cells: ["2026-09-04", "Kora", "20,00"], before: ["2026-09-03", "Marea", "12,00"], block: 1 },
      { kind: "added", number: 5, cells: ["2026-09-05", "Ateneo", "7,00"], block: 1 },
    ]);
    expect(looksLikeHeader(rows ?? [])).toBe(true);
  });

  it("numbers a removed row where it was, and the rows after it where they end up", () => {
    const result = applyBlocks(file, [{ search: "2026-09-02;Notus;45,50", replace: "" }]);
    if ("failedBlock" in result) throw new Error("no encaja");
    const rows = csvDiffRows(file, result.ranges, ";");
    expect(rows?.map((r) => [r.kind, r.number])).toEqual([
      ["same", 1],
      ["same", 2],
      ["removed", 3],
      ["same", 3],
    ]);
  });

  it("gives up on a field that goes on to the next line", () => {
    expect(csvDiffRows('a,b\n"uno\ndos",3\n', [], ",")).toBeNull();
  });
});
