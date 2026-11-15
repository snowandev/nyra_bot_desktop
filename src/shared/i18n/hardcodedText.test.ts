import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Every text a person reads comes from the catalogs. This finds text written straight into a component: words in
// JSX, and words in the attributes people see or hear. It looks at the shape, not at a language.
const SOURCE = join(process.cwd(), "src");
const VISIBLE_ATTRIBUTES = new Set(["aria-label", "aria-description", "title", "placeholder", "alt", "label"]);

// Names, formats and syntax that read the same in every language
const NAMES = new Set([
  "Nyra",
  "Nyra Bot",
  "Claude Code",
  "Ollama",
  "Git",
  "Mermaid",
  "PDF",
  "Markdown",
  "LM Studio",
  "Markdown (.md)",
  "PDF (.pdf)",
  // A license name and a metadata field, as examples of what goes in a SKILL.md
  "MIT",
  "author",
  // A command, as it is typed
  "/model",
]);

const hasWords = (text: string) => /\p{L}{2,}/u.test(text);

function componentFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return componentFiles(path);
    return name.endsWith(".tsx") && !name.includes(".test.") ? [path] : [];
  });
}

function hardcodedTexts(path: string): string[] {
  const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const report = (node: ts.Node, text: string) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    found.push(`${relative(SOURCE, path)}:${line + 1} ${JSON.stringify(text)}`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const text = node.text.replace(/\s+/g, " ").trim();
      if (hasWords(text) && !NAMES.has(text)) report(node, text);
    } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const text = node.initializer.text;
      if (VISIBLE_ATTRIBUTES.has(node.name.getText(file)) && hasWords(text) && !NAMES.has(text)) report(node, text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("the interface's texts", () => {
  it("are all in the catalogs, none written into a component", () => {
    expect(componentFiles(SOURCE).flatMap(hardcodedTexts)).toEqual([]);
  });
});
