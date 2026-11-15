import { describe, expect, it } from "vitest";
import type { Conversation } from "@/shared/types";
import { buildTree, foldersHolding, marksOf, onlyMarked, rowsInView, sameMarks, visibleRows } from "./fileTree";

describe("fileTree", () => {
  it("puts folders before files, each in alphabetical order", () => {
    const tree = buildTree(["src/b.ts", "README.md", "src/lib/a.ts", "src/a.ts"]);
    expect(tree.map((n) => n.name)).toEqual(["src", "README.md"]);
    expect(tree[0].children?.map((n) => n.path)).toEqual(["src/lib", "src/a.ts", "src/b.ts"]);
  });

  it("marks what the conversation read, proposed and applied, and keeps only those when filtering", () => {
    const conversation: Conversation = {
      id: "c",
      title: "t",
      messages: [
        {
          role: "assistant",
          content: "",
          workspaceConsult: {
            folder: "p",
            root: "/p",
            read: [{ path: "src/a.ts", size: 1, modified: 1 }],
            searches: [],
            listed: [],
            skipped: [],
            tokens: 0,
            budget: 0,
          },
          workspaceChanges: [{ id: "x", root: "/p", path: "src/b.ts", kind: "edit", blocks: [], status: "pending" }],
        },
      ],
    };
    const marks = marksOf(conversation);
    expect(marks.get("src/a.ts")).toEqual({ read: true, proposed: false, applied: false });
    expect(marks.get("src/b.ts")?.proposed).toBe(true);
    const tree = buildTree(["src/a.ts", "src/b.ts", "src/c.ts", "docs/x.md"]);
    expect([...foldersHolding(marks)]).toEqual(["src"]);
    expect(sameMarks(marks, marksOf(conversation))).toBe(true);
    expect(sameMarks(marks, new Map())).toBe(false);
    expect(onlyMarked(tree, marks)[0].children?.map((n) => n.name)).toEqual(["a.ts", "b.ts"]);
    expect(marksOf(null).size).toBe(0);
  });
});

describe("drawing a long tree", () => {
  it("lists the rows on screen, with the children of the open folders only", () => {
    const tree = buildTree(["src/a.ts", "src/lib/b.ts", "README.md"]);
    const rows = visibleRows(tree, (path) => path === "src");
    expect(rows.map((r) => [r.node.path, r.level])).toEqual([
      ["src", 1],
      ["src/lib", 2],
      ["src/a.ts", 2],
      ["README.md", 1],
    ]);
  });

  it("draws only the rows in view and a few around them", () => {
    expect(rowsInView(0, 280, 20_000, 28, 5)).toEqual({ first: 0, last: 15 });
    expect(rowsInView(28_000, 280, 20_000, 28, 5)).toEqual({ first: 995, last: 1015 });
    expect(rowsInView(0, 280, 3, 28, 5)).toEqual({ first: 0, last: 3 });
  });
});
