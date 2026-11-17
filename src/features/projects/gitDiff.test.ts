import { describe, expect, it } from "vitest";
import { gitDiffRows } from "./gitDiff";

const diff = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1a2b3c4..5d6e7f8 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,3 +1,4 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " export { a };",
  "@@ -20,2 +21,1 @@",
  "-old();",
  " end();",
  "\\ No newline at end of file",
  "",
].join("\n");

describe("gitDiffRows", () => {
  it("pairs removed and added lines in each part, with their numbers on both sides", () => {
    expect(gitDiffRows(diff)).toEqual([
      { kind: "header", block: 0, total: 2, line: 1 },
      { kind: "context", a: 1, b: 1, text: "const a = 1;" },
      { kind: "change", block: 0, removed: { n: 2, text: "const b = 2;" }, added: { n: 2, text: "const b = 3;" } },
      { kind: "change", block: 0, removed: undefined, added: { n: 3, text: "const c = 4;" } },
      { kind: "context", a: 3, b: 4, text: "export { a };" },
      { kind: "header", block: 1, total: 2, line: 21 },
      { kind: "change", block: 1, removed: { n: 20, text: "old();" }, added: undefined },
      { kind: "context", a: 21, b: 21, text: "end();" },
    ]);
  });
});
