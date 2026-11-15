// Models write formulas in several ways: $x$, $$x$$, \(x\) and \[x\]. Everything becomes the $$ the Markdown parser
// reads as math (inline within a line, a block on lines of their own), and a lone $ is only math by its shape, so
// prices stay text: "$5 and $10" is not a formula, "$E = mc^2$" is. Code, fenced or inline, is never touched.

const FENCE = /^(\s*)(`{3,}|~{3,})/;
// A formula alone on its line, which the parser would otherwise draw inline, small and to the left
const LONE_FORMULA = /^(\s*)\$\$((?:(?!\$\$).)+)\$\$\s*$/;

// A $ opens a formula when the next character isn't a space, and closes it when the one before isn't a space and the
// one after isn't a digit; the formula stays on one line. An escaped dollar (\$) is text outside a formula and part
// of it inside one ($\$3 + \$2$).
const SINGLE_DOLLAR = /(?<![\\$])\$(?=[^\s$])((?:[^\n$\\]|\\.)*?(?:[^\s\\$]|\\.))\$(?![\d$])/g;

function inlineMath(text: string) {
  return text
    .replace(/\\\((.+?)\\\)/g, (_, formula: string) => `$$${formula.trim()}$$`)
    .replace(/\\\[(.+?)\\\]/g, (_, formula: string) => `$$${formula.trim()}$$`)
    .replace(SINGLE_DOLLAR, (_, formula: string) => `$$${formula}$$`);
}

// Outside inline code: `…` spans keep their dollars and backslashes
function outsideCode(line: string) {
  return line
    .split(/(`+[^`]*`+)/)
    .map((part, i) => (i % 2 === 1 ? part : inlineMath(part)))
    .join("");
}

export function normalizeMath(markdown: string) {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const opening = line.match(FENCE);
    if (fence) {
      out.push(line);
      if (opening && opening[2][0] === fence[0] && opening[2].length >= fence.length) fence = null;
      continue;
    }
    if (opening) {
      fence = opening[2];
      out.push(line);
      continue;
    }
    // \[ and \] alone on their lines open and close a block; anything else is read line by line
    const trimmed = line.trim();
    if (trimmed === "\\[" || trimmed === "\\]") {
      out.push(line.replace(trimmed, () => "$$"));
      continue;
    }
    const normalized = outsideCode(line);
    const lone = normalized.match(LONE_FORMULA);
    out.push(lone ? `${lone[1]}$$\n${lone[1]}${lone[2].trim()}\n${lone[1]}$$` : normalized);
  }
  return out.join("\n");
}
