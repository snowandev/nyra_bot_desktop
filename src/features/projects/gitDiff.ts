import type { DiffRow } from "@/features/workspace/fileChanges";

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// git's unified diff of one file, as the rows the change review draws: a header for each part that changed, the
// lines around it, and each removed line paired with the added one in its place
export function gitDiffRows(diff: string): DiffRow[] {
  const lines = diff.replace(/\n$/, "").split("\n");
  const total = lines.filter((l) => HUNK.test(l)).length;
  const rows: DiffRow[] = [];
  let block = -1;
  let a = 0;
  let b = 0;
  let removed: { n: number; text: string }[] = [];
  let added: { n: number; text: string }[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      rows.push({ kind: "change", block, removed: removed[i], added: added[i] });
    }
    removed = [];
    added = [];
  };
  for (const line of lines) {
    const hunk = HUNK.exec(line);
    if (hunk) {
      flush();
      block++;
      a = Number(hunk[1]);
      b = Number(hunk[2]);
      rows.push({ kind: "header", block, total, line: b });
    } else if (block < 0 || line.startsWith("\\")) {
      // The file's header (diff --git, index, ---, +++) and "\ No newline at end of file"
      continue;
    } else if (line.startsWith("-")) {
      removed.push({ n: a++, text: line.slice(1) });
    } else if (line.startsWith("+")) {
      added.push({ n: b++, text: line.slice(1) });
    } else {
      flush();
      rows.push({ kind: "context", a: a++, b: b++, text: line.slice(1) });
    }
  }
  flush();
  return rows;
}

// A file git doesn't track yet: all of it is new
export function newFileRows(text: string): DiffRow[] {
  const lines = text.replace(/\n$/, "").split("\n");
  return [
    { kind: "header", block: 0, total: 1, line: 1 },
    ...lines.map((line, i): DiffRow => ({ kind: "change", block: 0, added: { n: i + 1, text: line } })),
  ];
}
