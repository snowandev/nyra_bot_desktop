import type { CellChangeSpec, ChangeBlock } from "@/shared/types";
import { TAG_ATTRIBUTES, tagAttributes, withoutPartialTag } from "@/features/chat/reply/appTags";
import { folderPath } from "./workspace";

// Changes the model proposes to the files of the connected folder. Like documents, any model can follow a plain text
// convention: a tag per file, with SEARCH/REPLACE blocks for an edit (a format many models already know), the
// whole content for a new file, or cell by cell for a spreadsheet. Nyra takes the tags out of the reply and shows
// them as cards to review.

// The tag and its attributes, in any order: path, and for a spreadsheet the sheet
const TAG_NAMES = ["nyra-edit", "nyra-create", "nyra-cells"];
const OPEN_TAG = new RegExp(`<nyra-(edit|create|cells)(${TAG_ATTRIBUTES})\\s*>\\n?`);
// "B3: 120", "$D$10: =SUM(D2:D9)", "C4:" (emptied)
const CELL_LINE = /^\s*\$?([A-Za-z]{1,3})\$?(\d{1,7})\s*:(.*)$/;
const SEARCH = /^<{7} ?SEARCH\s*$/;
const DIVIDER = /^={7}\s*$/;
const REPLACE = /^>{7} ?REPLACE\s*$/;

// How cells are written, for a workbook in the folder and for an attached one
export const CELL_RULES =
  "One cell per line, by its column letters and row number. A formula starts with = and is written as the file " +
  "stores it: function names in English and commas between arguments (=SUM(B2:B9), =IF(A2>0,1,0)), whatever the " +
  "user's language. Numbers use a dot for decimals and no thousands separators. Nothing after the colon empties " +
  "the cell; a leading ' keeps digits as text ('00123). Change only the cells that need it: the rest of the " +
  "workbook, its formats and its other sheets stay as they are.";

// In English, which models follow most reliably
export const CHANGES_PROMPT = [
  "You can also propose changes to the files of the folder. The user reviews each one and decides whether to apply " +
    "it, so nothing changes until they accept. Only propose changes when the user asks for them, and read a file " +
    "before changing it. After explaining what you'll change, add one block per file at the end of your reply:",
  '<nyra-edit path="relative/path">',
  "<<<<<<< SEARCH",
  "the exact lines of the file to replace, with their indentation, enough of them to be unique",
  "=======",
  "the new lines",
  ">>>>>>> REPLACE",
  "</nyra-edit>",
  "Always close each pair with >>>>>>> REPLACE. Several pairs can go in one block, in the order they appear in the " +
    "file. For a new file:",
  '<nyra-create path="relative/path">',
  "the whole content",
  "</nyra-create>",
  "A spreadsheet (.xlsx, .xlsm) is changed cell by cell instead, one block per sheet:",
  '<nyra-cells path="relative/path" sheet="Sheet name">',
  "B3: 120",
  "D10: =SUM(D2:D9)",
  "A12: Total",
  "C4:",
  "</nyra-cells>",
  CELL_RULES +
    " Propose cells the same way for an .xls or .ods file: Nyra can't write those formats, so it offers the user to " +
    "save the changes in a new .xlsx next to the original, which stays as it is.",
  "Never delete or rename files, and never change secrets (.env) or files outside the folder. Don't put these " +
    "blocks in a code fence.",
].join("\n");

export type ParsedChange = {
  kind: "edit" | "create" | "cells";
  path: string;
  // An attached spreadsheet, by its name, instead of a file of the folder
  file?: string;
  blocks: ChangeBlock[];
  content?: string;
  cells?: CellChangeSpec[];
};

function attributesOf(text: string) {
  const attributes = tagAttributes(text);
  if (attributes.path) attributes.path = folderPath(attributes.path);
  return attributes;
}

function cellsOf(body: string, sheet: string): CellChangeSpec[] {
  return body.split("\n").flatMap((line) => {
    const match = line.match(CELL_LINE);
    return match ? [{ sheet, cell: `${match[1].toUpperCase()}${match[2]}`, value: match[3].trim() }] : [];
  });
}

// Several blocks for one workbook (one per sheet) make a single change; a cell named twice keeps its last value
function withCells(changes: ParsedChange[], target: { path: string; file?: string }, cells: CellChangeSpec[]) {
  const earlier = changes.find((c) => c.kind === "cells" && c.path === target.path && c.file === target.file);
  if (!earlier) return [...changes, { kind: "cells" as const, ...target, blocks: [], cells }];
  const same = (a: CellChangeSpec, b: CellChangeSpec) => a.sheet === b.sheet && a.cell === b.cell;
  const kept = (earlier.cells ?? []).filter((c) => !cells.some((n) => same(c, n)));
  return changes.map((c) => (c === earlier ? { ...c, cells: [...kept, ...cells] } : c));
}

// One trailing line end belongs to the format, not to the text
const withoutLastLineEnd = (text: string) => text.replace(/\n$/, "");

// Line by line, forgiving with how a pair ends: local models sometimes close it with a second "=======", start the
// next one without closing, or close the tag right after the new lines
function blocksOf(body: string): ChangeBlock[] {
  const blocks: ChangeBlock[] = [];
  let pair: { search: string[]; replace: string[] | null } | null = null;
  const close = () => {
    if (pair?.replace) {
      const blankLine = pair.replace.length === 1 && pair.replace[0] === "";
      blocks.push({ search: pair.search.join("\n"), replace: pair.replace.join("\n"), ...(blankLine && { blankLine }) });
    }
    pair = null;
  };
  for (const line of body.split("\n")) {
    if (SEARCH.test(line)) {
      close();
      pair = { search: [], replace: null };
    } else if (!pair) {
      continue;
    } else if (!pair.replace) {
      if (DIVIDER.test(line)) pair.replace = [];
      else pair.search.push(line);
    } else if (REPLACE.test(line) || DIVIDER.test(line)) {
      close();
    } else {
      pair.replace.push(line);
    }
  }
  // A last pair the tag closed without its marker: the line end before the tag isn't part of the new lines
  const last: { replace: string[] | null } | null = pair;
  if (last?.replace?.at(-1) === "") last.replace.pop();
  close();
  return blocks;
}

function tidy(text: string) {
  return text.replace(/\n{3,}/g, "\n\n").trimEnd();
}

// The changes of a finished reply and its text without them. An unfinished tag (a reply stopped halfway) is
// dropped; an edit without any block is ignored.
export function takeChanges(reply: string): { changes: ParsedChange[]; text: string } {
  let changes: ParsedChange[] = [];
  let text = "";
  let rest = reply;
  for (let open = rest.match(OPEN_TAG); open?.index !== undefined; open = rest.match(OPEN_TAG)) {
    text += rest.slice(0, open.index);
    const kind = open[1] as ParsedChange["kind"];
    const close = `</nyra-${kind}>`;
    const bodyStart = open.index + open[0].length;
    const end = rest.indexOf(close, bodyStart);
    if (end === -1) {
      rest = "";
      break;
    }
    const body = rest.slice(bodyStart, end);
    const { path = "", sheet = "", file = "" } = attributesOf(open[2]);
    rest = rest.slice(end + close.length);
    if (kind === "cells") {
      const cells = cellsOf(body, sheet);
      const target = path ? { path } : { path: "", file };
      if ((path || file) && sheet && cells.length > 0) changes = withCells(changes, target, cells);
      continue;
    }
    if (!path) continue;
    if (kind === "create") {
      changes.push({ kind, path, blocks: [], content: body.endsWith("\n") || !body ? body : `${body}\n` });
    } else {
      const blocks = blocksOf(body);
      if (blocks.length > 0) changes.push({ kind, path, blocks });
    }
  }
  return { changes, text: tidy(text + rest) };
}

// While the reply arrives: its text without the tags, also half written, and the files it is preparing
export function preparingChanges(reply: string): { text: string; paths: string[] } {
  const paths: string[] = [];
  let text = "";
  let rest = reply;
  for (let open = rest.match(OPEN_TAG); open?.index !== undefined; open = rest.match(OPEN_TAG)) {
    text += rest.slice(0, open.index);
    const { path, file } = attributesOf(open[2]);
    const name = path || file;
    if (name && !paths.includes(name)) paths.push(name);
    const close = `</nyra-${open[1]}>`;
    const end = rest.indexOf(close, open.index + open[0].length);
    rest = end === -1 ? "" : rest.slice(end + close.length);
  }
  return { text: tidy(withoutPartialTag(text + rest, TAG_NAMES)), paths };
}

// Where a block replaced lines of the original: start counts from 0
export type ChangedRange = { start: number; removed: string[]; added: string[] };

const sameLine = (a: string, b: string) => a === b || a.trimEnd() === b.trimEnd();

function find(lines: string[], wanted: string[], from: number) {
  const fits = (at: number, same: (a: string, b: string) => boolean) =>
    wanted.every((line, i) => at + i < lines.length && same(lines[at + i], line));
  for (const same of [(a: string, b: string) => a === b, sameLine]) {
    for (let at = from; at + wanted.length <= lines.length; at++) if (fits(at, same)) return at;
  }
  return -1;
}

// The lines a block puts in place of what it finds
export const addedLinesOf = (block: ChangeBlock) => (block.replace || block.blankLine ? block.replace.split("\n") : []);

// The file with the blocks applied in order, or the first block that doesn't match it. A model may get trailing
// spaces wrong; anything else has to be as it is in the file.
export function applyBlocks(
  original: string,
  blocks: ChangeBlock[],
): { content: string; ranges: ChangedRange[] } | { failedBlock: number } {
  const lines = original.split("\n");
  const ranges: ChangedRange[] = [];
  let cursor = 0;
  for (const [i, block] of blocks.entries()) {
    const wanted = block.search.split("\n");
    const at = block.search ? find(lines, wanted, cursor) : -1;
    if (at === -1) return { failedBlock: i };
    ranges.push({ start: at, removed: lines.slice(at, at + wanted.length), added: addedLinesOf(block) });
    cursor = at + wanted.length;
  }
  const out: string[] = [];
  let from = 0;
  for (const range of ranges) {
    out.push(...lines.slice(from, range.start), ...range.added);
    from = range.start + range.removed.length;
  }
  out.push(...lines.slice(from));
  return { content: out.join("\n"), ranges };
}

export type DiffLine = { n: number; text: string };
export type DiffRow =
  | { kind: "header"; block: number; total: number; line: number }
  | { kind: "context"; a: number; b: number; text: string }
  | { kind: "fold"; key: string; count: number; from: number }
  | { kind: "change"; block: number; removed?: DiffLine; added?: DiffLine };

// Unchanged lines show around each change; farther ones fold into "… N líneas sin cambios"
const CONTEXT = 3;

export function diffRows(original: string, ranges: ChangedRange[], expanded: ReadonlySet<string>): DiffRow[] {
  const lines = original.split("\n");
  const rows: DiffRow[] = [];
  let offset = 0;
  const context = (from: number, to: number, key: string, first: boolean, last: boolean) => {
    const count = to - from;
    const push = (i: number) => rows.push({ kind: "context", a: i + 1, b: i + 1 + offset, text: lines[i] });
    if (count <= 2 * CONTEXT + 1 || expanded.has(key)) {
      for (let i = from; i < to; i++) push(i);
      return;
    }
    const head = first ? 0 : CONTEXT;
    const tail = last ? 0 : CONTEXT;
    for (let i = from; i < from + head; i++) push(i);
    rows.push({ kind: "fold", key, count: count - head - tail, from: from + head + 1 });
    for (let i = to - tail; i < to; i++) push(i);
  };
  let from = 0;
  ranges.forEach((range, block) => {
    context(from, range.start, `before-${block}`, block === 0, false);
    rows.push({ kind: "header", block, total: ranges.length, line: range.start + 1 });
    const pairs = Math.max(range.removed.length, range.added.length);
    for (let i = 0; i < pairs; i++) {
      rows.push({
        kind: "change",
        block,
        ...(i < range.removed.length && { removed: { n: range.start + i + 1, text: range.removed[i] } }),
        ...(i < range.added.length && { added: { n: range.start + offset + i + 1, text: range.added[i] } }),
      });
    }
    offset += range.added.length - range.removed.length;
    from = range.start + range.removed.length;
  });
  context(from, lines.length, "after", ranges.length === 0, true);
  return rows;
}

// A new file: every line added, under one header
export function createdRows(content: string): DiffRow[] {
  const lines = withoutLastLineEnd(content).split("\n");
  return [
    { kind: "header", block: 0, total: 1, line: 1 },
    ...lines.map((text, i): DiffRow => ({ kind: "change", block: 0, added: { n: i + 1, text } })),
  ];
}

// Lines added and removed, as the card counts them before the file is opened
type ChangeContent = Pick<ParsedChange, "kind" | "blocks" | "content" | "cells">;

export function changeStats(change: ChangeContent) {
  if (change.kind === "cells") {
    const cells = change.cells?.length ?? 0;
    return { added: cells, removed: 0, blocks: cells };
  }
  if (change.kind === "create") {
    return { added: withoutLastLineEnd(change.content ?? "").split("\n").length, removed: 0, blocks: 1 };
  }
  const count = (text: string) => (text ? text.split("\n").length : 0);
  return {
    added: change.blocks.reduce((sum, b) => sum + addedLinesOf(b).length, 0),
    removed: change.blocks.reduce((sum, b) => sum + count(b.search), 0),
    blocks: change.blocks.length,
  };
}

// The part of a changed line that differs from its pair, to mark it inside the line
export function differingPart(line: string, other: string) {
  let start = 0;
  while (start < line.length && start < other.length && line[start] === other[start]) start++;
  let end = 0;
  while (
    end < line.length - start &&
    end < other.length - start &&
    line[line.length - 1 - end] === other[other.length - 1 - end]
  ) {
    end++;
  }
  return { before: line.slice(0, start), changed: line.slice(start, line.length - end), after: line.slice(line.length - end) };
}

// The proposal as text, for copying a change Nyra can't apply (a protected file) and making it by hand
export function changeAsText(change: ChangeContent & { path: string }) {
  if (change.kind === "create") return `${change.path}\n\n${change.content ?? ""}`;
  if (change.kind === "cells") {
    return [change.path, "", ...(change.cells ?? []).map((c) => `${c.sheet}!${c.cell}: ${c.value}`)].join("\n");
  }
  const blocks = change.blocks.map((b) =>
    ["<<<<<<< SEARCH", b.search, "=======", ...addedLinesOf(b), ">>>>>>> REPLACE"].join("\n"),
  );
  return `${change.path}\n\n${blocks.join("\n\n")}`;
}

// The proposal alone, without the file around it: for a change already applied, undone or that can't be applied,
// where the file no longer is (or never was) what it was written for. Lines count from each block's start.
export function blockRows(blocks: ChangeBlock[]): DiffRow[] {
  return blocks.flatMap((block, i): DiffRow[] => {
    const removed = block.search ? block.search.split("\n") : [];
    const added = addedLinesOf(block);
    const pairs = Math.max(removed.length, added.length);
    return [
      { kind: "header", block: i, total: blocks.length, line: 1 },
      ...Array.from({ length: pairs }, (_, j): DiffRow => ({
        kind: "change",
        block: i,
        ...(j < removed.length && { removed: { n: j + 1, text: removed[j] } }),
        ...(j < added.length && { added: { n: j + 1, text: added[j] } }),
      })),
    ];
  });
}
