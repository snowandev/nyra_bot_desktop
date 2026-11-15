import { fromMarkdown } from "mdast-util-from-markdown";
import type { Root } from "mdast";
import { describe, expect, it } from "vitest";
import { CITATION_LINK_PREFIX, citationOrder, remarkCitations } from "./citations";

const sources = new Set([1, 2, 3, 4]);

describe("citationOrder", () => {
  it("numbers citations in the order they first appear", () => {
    const order = citationOrder("Uno [3]. Dos [1][3]. Tres [2, 4].", sources);
    expect([...order]).toEqual([
      [3, 1],
      [1, 2],
      [2, 3],
      [4, 4],
    ]);
  });

  it("ignores numbers that aren't sources and anything inside code", () => {
    const order = citationOrder("Ver [9]. `arr[1]`\n```\nx = [2]\n```\nFin [4].", sources);
    expect([...order]).toEqual([[4, 1]]);
  });
});

function linksIn(markdown: string) {
  const tree: Root = fromMarkdown(markdown);
  const order = citationOrder(markdown, sources);
  remarkCitations(order)()(tree);
  const found: string[] = [];
  const walk = (node: { type: string; url?: string; children?: unknown[] }) => {
    if (node.type === "link" && node.url?.startsWith(CITATION_LINK_PREFIX)) found.push(node.url);
    (node.children as (typeof node)[] | undefined)?.forEach(walk);
  };
  walk(tree as never);
  return found;
}

it("turns citations into links in text, not in code", () => {
  expect(linksIn("Python [2] es *rápido* [1][2].\n\n`a[1]`")).toEqual([
    "#nyra-cite-2",
    "#nyra-cite-1",
    "#nyra-cite-2",
  ]);
});
