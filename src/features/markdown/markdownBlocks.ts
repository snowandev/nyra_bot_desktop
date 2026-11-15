// A reply is drawn in blocks, each parsed on its own, so while it streams only the last one, the one growing, is
// parsed again. A block ends at a blank line followed by a line that starts a new paragraph, heading, table, quote or
// fence; never inside a fence or a $$ formula, and never before a list item, so a list keeps its numbering and spacing.

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^([-*+]|\d{1,9}[.)])(\s|$)/;
// Footnotes and link references are defined in one place and used in another: such a text stays whole
const DEFINITION = /^ {0,3}\[[^\]\n]+\]:/m;

const closesFence = (line: string, fence: string) => {
  const trimmed = line.trim();
  return trimmed.length >= fence.length && [...trimmed].every((char) => char === fence[0]);
};

// $$ alone opens a block formula; $$x$$ on one line is complete
const opensMath = (line: string) => {
  const trimmed = line.trim();
  return trimmed.startsWith("$$") && !(trimmed.length > 2 && trimmed.endsWith("$$"));
};

export function markdownBlocks(markdown: string): string[] {
  if (DEFINITION.test(markdown)) return [markdown];
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  let inMath = false;
  let afterBlank = false;
  for (const line of markdown.split("\n")) {
    if (fence) {
      current.push(line);
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    if (inMath) {
      current.push(line);
      if (line.trim().endsWith("$$")) inMath = false;
      continue;
    }
    if (!line.trim()) {
      afterBlank = true;
      current.push(line);
      continue;
    }
    // Indented lines continue what came before: a list item's paragraph, indented code
    if (afterBlank && /^\S/.test(line) && !LIST_ITEM.test(line) && current.some((l) => l.trim())) {
      blocks.push(current.join("\n"));
      current = [];
    }
    afterBlank = false;
    const opening = line.match(FENCE);
    if (opening) fence = opening[1];
    else if (opensMath(line)) inMath = true;
    current.push(line);
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}
