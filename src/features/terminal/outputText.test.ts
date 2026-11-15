import { describe, expect, it } from "vitest";
import {
  appendOutput,
  endingOf,
  keepWithin,
  lineCount,
  MAX_KEPT_LINES,
  outputRange,
  outputTail,
  searchOutput,
  totalLines,
} from "./outputText";

describe("appendOutput", () => {
  it("joins chunks cut anywhere, also between \\r and \\n", () => {
    let output = "";
    for (const chunk of ["> vitest run\r", "\n ✓ uno", " (2 tests)\r\n", "fin"]) output = appendOutput(output, chunk);
    expect(output).toBe("> vitest run\n ✓ uno (2 tests)\nfin");
  });

  it("keeps only the last drawing of a progress line", () => {
    let output = "Descargando\n";
    for (const chunk of ["10%\r", "55%\r", "100%\n"]) output = appendOutput(output, chunk);
    expect(output).toBe("Descargando\n100%\n");
  });
});

it("counts lines with or without a final line break", () => {
  expect(lineCount("")).toBe(0);
  expect(lineCount("a\nb")).toBe(2);
  expect(lineCount("a\nb\n")).toBe(2);
});

it("keeps the start and the end of an output past the limit", () => {
  const output = Array.from({ length: MAX_KEPT_LINES + 500 }, (_, i) => `línea ${i + 1}`).join("\n");
  const kept = keepWithin(output).output.split("\n");
  expect(kept).toHaveLength(MAX_KEPT_LINES);
  expect(kept[0]).toBe("línea 1");
  expect(kept[1000]).toMatch(/líneas omitidas/);
  expect(kept.at(-1)).toBe(`línea ${MAX_KEPT_LINES + 500}`);
});

it("counts every line that went when it trims again while the command runs", () => {
  const lines = (from: number, count: number) => Array.from({ length: count }, (_, i) => `línea ${from + i}`);
  const first = keepWithin(lines(1, MAX_KEPT_LINES + 500).join("\n"));
  expect(first.dropped).toBe(501);
  const more = keepWithin([first.output, ...lines(MAX_KEPT_LINES + 501, 300)].join("\n"), first.dropped);
  const kept = more.output.split("\n");
  expect(kept).toHaveLength(MAX_KEPT_LINES);
  expect(more.dropped).toBe(801);
  expect(kept.filter((line) => /líneas omitidas/.test(line))).toHaveLength(1);
  expect(kept.at(-1)).toBe(`línea ${MAX_KEPT_LINES + 800}`);
  expect(totalLines(more.output, more.dropped)).toBe(MAX_KEPT_LINES + 800);
});

describe("what the model reads", () => {
  const output = Array.from({ length: 400 }, (_, i) => (i === 349 ? "warning: unused variable" : `ok ${i + 1}`)).join("\n");

  it("gets the last lines numbered, and how many there are", () => {
    const tail = outputTail(output);
    expect(tail.total).toBe(400);
    expect(tail.text.split("\n").at(-1)).toBe("400 | ok 400");
    expect(tail.from).toBeGreaterThan(1);
  });

  it("reads a range within the output", () => {
    const range = outputRange(output, 349, 351);
    expect(range.text).toBe("349 | ok 349\n350 | warning: unused variable\n351 | ok 351");
    expect(outputRange(output, 390, 900).to).toBe(400);
  });

  it("finds lines in any case", () => {
    expect(searchOutput(output, "WARNING")).toEqual({ text: "350: warning: unused variable", total: 1, shown: 1 });
  });
});

it("tells a command that never ran from one that ended with a result other than 0", () => {
  expect(endingOf(0)).toBe("ok");
  expect(endingOf(127)).toBe("notFound");
  expect(endingOf(126)).toBe("notRunnable");
  expect(endingOf(1)).toBe("nonZero");
  expect(endingOf(undefined)).toBe("noStart");
});
