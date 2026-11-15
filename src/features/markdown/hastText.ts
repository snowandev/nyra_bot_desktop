import type { ElementContent } from "hast";

const isFormula = (node: ElementContent) =>
  node.type === "element" &&
  Array.isArray(node.properties.className) &&
  node.properties.className.includes("katex");

// The text of a piece of the rendered Markdown. Highlighted code is split into many spans, so it is rebuilt from the
// tree; a formula drawn by KaTeX holds its text twice (for reading and for screen readers), so it gives its LaTeX.
export function textOf(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return "";
  if (isFormula(node)) return latexOf(node) ?? node.children.map(textOf).join("");
  return node.children.map(textOf).join("");
}

function latexOf(node: ElementContent): string | null {
  if (node.type !== "element") return null;
  if (node.tagName === "annotation") return node.children.map(textOf).join("");
  for (const child of node.children) {
    const latex = latexOf(child);
    if (latex !== null) return latex;
  }
  return null;
}
