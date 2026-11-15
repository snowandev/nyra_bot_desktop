// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ANSWER } from "../../../tools/share-check/sample";

// The same text drawn whole, as one parse, to compare with the blocks
let whole = false;
vi.mock("./markdownBlocks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./markdownBlocks")>();
  return { markdownBlocks: (text: string) => (whole ? [text] : actual.markdownBlocks(text)) };
});

const { markdownBlocks } = await vi.importActual<typeof import("./markdownBlocks")>("./markdownBlocks");
const { Markdown } = await import("./Markdown");

// @ts-expect-error React reads it to allow act() outside its own test tools
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function drawn(text: string, asWhole: boolean) {
  whole = asWhole;
  const element = document.createElement("div");
  const root = createRoot(element);
  act(() => root.render(<Markdown>{text}</Markdown>));
  // One parse leaves a line break between its blocks, which the page never shows
  const nodes = [...(element.firstElementChild?.childNodes ?? [])];
  const html = nodes.flatMap((node) => (node instanceof Element ? [node.outerHTML] : node.textContent?.trim() || []));
  // React's own ids differ from one render to another
  const ids = html.map((part) => part.replace(/_r_[a-z0-9]+_/g, "_id_"));
  act(() => root.unmount());
  return ids;
}

const VARIED = [
  "# Título\n\nUn párrafo con **negrita** y `código`.",
  "1. Uno\n\n2. Dos, con hueco\n\n   Párrafo del segundo\n\n3. Tres",
  "- a\n- b\n\n- c suelta",
  "```python\n# no es un título\n\nprint(1)\n\n# tampoco\n```",
  "~~~\nsin lenguaje\n\n~~~",
  "$$\n\\int_0^1 x\\,dx\n\n$$",
  "> Una cita\n\n> Otra cita",
  "| a | b |\n|---|---|\n| 1 | 2 |",
  "    código sangrado\n\n    sigue",
  "Texto\n\n---\n\nTras la línea.",
  "Con nota[^1].\n\n[^1]: La nota.",
  "Enlace [aquí][web].\n\n[web]: https://ejemplo.com",
  "Precio $5 y fórmula $E = mc^2$.",
].join("\n\n");

describe("markdownBlocks", () => {
  it("draws the same as one parse of the whole text", () => {
    for (const text of [...VARIED.split("\n\n\n"), VARIED, ANSWER.content]) {
      expect(drawn(text, false)).toEqual(drawn(text, true));
    }
  });

  it("never splits a fence, a formula or a list", () => {
    expect(markdownBlocks("```\na\n\nb\n```")).toHaveLength(1);
    expect(markdownBlocks("$$\nx\n\ny\n$$")).toHaveLength(1);
    expect(markdownBlocks("1. a\n\n2. b")).toHaveLength(1);
    expect(markdownBlocks("# Uno\n\nTexto\n\n## Dos\n\nMás")).toHaveLength(4);
  });

  it("keeps a text with footnotes or link references whole", () => {
    expect(markdownBlocks("Uno[^1]\n\nDos\n\n[^1]: Nota")).toHaveLength(1);
  });

  it("keeps the earlier blocks as they were while the last one grows", () => {
    const before = markdownBlocks("# Uno\n\nTexto que");
    const after = markdownBlocks("# Uno\n\nTexto que sigue creciendo");
    expect(after[0]).toBe(before[0]);
  });
});
