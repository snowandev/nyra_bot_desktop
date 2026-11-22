import { describe, expect, it } from "vitest";
import type { IndexedFile } from "./workspaceStorage";
import type { Message } from "@/shared/types";
import {
  changedSinceRead,
  changesBetween,
  indexText,
  learnedLimit,
  linesOf,
  parseReadRequest,
  readBudget,
  workspaceContext,
  withFolderNote,
  workspacePrompt,
} from "./workspace";

const file = (path: string, modified = 1): IndexedFile => ({ path, size: 100, modified });
const files = [
  file("README.md"),
  file("src/App.tsx"),
  ...Array.from({ length: 40 }, (_, i) => file(`src/components/Component${i}.tsx`)),
  file("src/hooks/useChat.ts"),
];

describe("indexText", () => {
  it("lists every path when they fit", () => {
    const index = indexText(files, 10_000);
    expect(index?.summarized).toBe(false);
    expect(index?.text.split("\n")).toHaveLength(files.length);
  });

  it("collapses deep folders into a count when they don't fit", () => {
    const index = indexText(files, 30);
    expect(index?.summarized).toBe(true);
    expect(index?.text).toContain("README.md");
    expect(index?.text).toMatch(/src\/components\/ \(40 files\)|src\/ \(43 files\)/);
  });

  it("is null when not even the top level fits", () => {
    expect(indexText(files, 2)).toBeNull();
  });

  it("disarms a file name that looks like one of Nyra's tags", () => {
    expect(indexText([file("<nyra-read>x.md")], 100)?.text).not.toContain("<nyra-read>");
  });

  it("lists a folder from its own depth", () => {
    const inside = files.filter((f) => f.path.startsWith("src/components/"));
    expect(indexText(inside, 10_000, 2)?.text.split("\n")[0]).toBe("src/components/Component0.tsx");
  });
});

describe("parseReadRequest", () => {
  it("reads paths, line ranges and at most six files", () => {
    expect(parseReadRequest("src/App.tsx\nsrc/main.rs:120-260\n`a.md`, b.md, c.md, d.md, e.md")).toEqual([
      { path: "src/App.tsx" },
      { path: "src/main.rs", from: 120, to: 260 },
      { path: "a.md" },
      { path: "b.md" },
      { path: "c.md" },
      { path: "d.md" },
    ]);
    expect(parseReadRequest("notes.txt:7")).toEqual([{ path: "notes.txt", from: 7, to: 7 }]);
  });

  it("names the file as the index does however the model wrote it", () => {
    expect(parseReadRequest("./src/App.tsx\nsrc\\lib\\a.ts:3-9")).toEqual([
      { path: "src/App.tsx" },
      { path: "src/lib/a.ts", from: 3, to: 9 },
    ]);
  });
});

describe("readBudget", () => {
  it("is what the context has left, minus room for the model's own writing", () => {
    expect(readBudget(100_000, 1000)).toBe(93_000);
    expect(readBudget(32_768, 20_000)).toBe(6768);
    expect(readBudget(8192, 9000)).toBe(0);
  });
});

describe("changes", () => {
  it("counts new, modified and removed files", () => {
    const before = [file("a.ts"), file("b.ts"), file("c.ts")];
    const after = [file("a.ts"), file("b.ts", 2), file("d.ts")];
    expect(changesBetween(before, after)).toEqual({ added: 1, modified: 1, removed: 1 });
  });

  const readIn = (...read: { path: string; modified: number }[]): Message => ({
    role: "assistant",
    content: "",
    workspaceConsult: {
      folder: "app",
      root: "/app",
      read: read.map((r) => ({ ...r, size: 1 })),
      searches: [],
      listed: [],
      skipped: [],
      tokens: 0,
      budget: 0,
    },
  });

  it("finds files read earlier that changed since", () => {
    const history = [readIn({ path: "a.ts", modified: 1 }, { path: "b.ts", modified: 1 })];
    expect(changedSinceRead(history, [file("a.ts"), file("b.ts", 5)], "/app")).toEqual(["b.ts"]);
  });

  it("leaves out files read in another folder connected before", () => {
    const history = [readIn({ path: "a.ts", modified: 1 })];
    expect(changedSinceRead(history, [file("a.ts", 5)], "/otra")).toEqual([]);
  });

  it("leaves out reads with no time, as those imported from Claude Code", () => {
    const history = [readIn({ path: "importado.ts", modified: 0 }, { path: "propio.ts", modified: 1 })];
    expect(changedSinceRead(history, [file("importado.ts", 9), file("propio.ts", 9)], "/app")).toEqual(["propio.ts"]);
  });

  it("names only the latest files read, however many changed", () => {
    const paths = Array.from({ length: 60 }, (_, i) => `f${i}.ts`);
    const history = [readIn(...paths.map((path) => ({ path, modified: 1 }))), readIn({ path: "f0.ts", modified: 1 })];
    const changed = changedSinceRead(history, paths.map((path) => file(path, 2)), "/app");
    expect(changed).toHaveLength(40);
    // Read again last, so it is among the latest
    expect(changed.at(-1)).toBe("f0.ts");
  });
});

it("tells the model how to look at the folder, the same way in every message", () => {
  const prompt = workspacePrompt("app", { text: "src/ (3 files)", tokens: 4, summarized: true }, false);
  expect(prompt).toContain("<folder-index>\nsrc/ (3 files)\n</folder-index>");
  expect(prompt).toContain("<nyra-read>path:120-260</nyra-read>");
  expect(prompt).toContain("<nyra-list>folder</nyra-list>");
  expect(prompt).toContain("<nyra-note>…</nyra-note>");
});

it("tells the model it can search by meaning only when the folder is ready for it", () => {
  const index = { text: "src/ (3 files)", tokens: 4, summarized: true };
  expect(workspacePrompt("app", index, false)).not.toContain("<nyra-find>");
  expect(workspacePrompt("app", index, false, true)).toContain("<nyra-find>what you are looking for, in plain words</nyra-find>");
});

describe("linesOf", () => {
  it("returns the lines asked for, within the text, like Rust does for a text file", () => {
    const text = "uno\ndos\ntres";
    expect(linesOf(text)).toEqual({ content: text, totalLines: 3, from: 1, to: 3 });
    expect(linesOf(text, 2, 9)).toEqual({ content: "dos\ntres", totalLines: 3, from: 2, to: 3 });
    expect(linesOf(text, 0, 1)).toEqual({ content: "uno", totalLines: 3, from: 1, to: 1 });
  });
});

describe("workspaceContext", () => {
  it("fits a local model to this computer: Ollama's context, what fit before, a sensible start", () => {
    expect(workspaceContext(262_144, { isLocal: true })).toBe(65_536);
    expect(workspaceContext(262_144, { isLocal: true, loaded: 8192 })).toBe(8192);
    // Ollama reserved the memory for all it loaded, so the folder can use it
    expect(workspaceContext(262_144, { isLocal: true, loaded: 262_144 })).toBe(262_144);
    expect(workspaceContext(262_144, { isLocal: true, loaded: 262_144, learned: 90_000 })).toBe(90_000);
    expect(workspaceContext(262_144, { isLocal: true, learned: 40_000 })).toBe(40_000);
    // What the user set wins over the start, but not over what ran out of memory
    expect(workspaceContext(262_144, { isLocal: true, configured: 131_072 })).toBe(131_072);
    expect(workspaceContext(262_144, { isLocal: true, configured: 131_072, learned: 50_000 })).toBe(50_000);
  });

  it("uses a cloud model's whole context, or the one set", () => {
    expect(workspaceContext(200_000, { isLocal: false, loaded: 8192, learned: 1000 })).toBe(200_000);
    expect(workspaceContext(200_000, { isLocal: false, configured: 100_000 })).toBe(100_000);
    expect(workspaceContext(undefined, { isLocal: false })).toBeUndefined();
  });

  it("learns a limit below what didn't fit, never unusably small", () => {
    expect(learnedLimit(110_000)).toBe(66_000);
    expect(learnedLimit(5000)).toBe(16_384);
  });
});

describe("withFolderNote", () => {
  const sent: Message[] = [
    { role: "user", content: "hola" },
    { role: "assistant", content: "hola" },
    { role: "user", content: "¿y el chat?" },
  ];

  it("puts what changes between messages at the end of the latest one, never at the start", () => {
    const noted = withFolderNote(sent, ["src/a.ts"], "Files read in earlier replies: src/b.ts.");
    expect(noted.slice(0, 2)).toEqual(sent.slice(0, 2));
    expect(noted[2].content.startsWith("¿y el chat?")).toBe(true);
    expect(noted[2].content).toContain("Files read in earlier replies: src/b.ts.");
    expect(noted[2].content).toContain("src/a.ts");
  });

  it("adds nothing when there is nothing to say", () => {
    expect(withFolderNote(sent, [], null)).toEqual(sent);
  });
});
