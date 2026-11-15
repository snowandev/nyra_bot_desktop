import type { Link, Root } from "mdast";
import { findAndReplace } from "mdast-util-find-and-replace";
import type { WebSearchRecord, WebSource } from "@/shared/types";

// The model cites pages by the number they were given ([3]); readers see them numbered in order of appearance,
// so the first citation in the text is 1. Pages the reply never cites get no number.

// "[1]", "[2][3]", "[2, 3]"
const CITATION = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

const numbersIn = (group: string) => group.split(",").map((n) => Number(n.trim()));

// Code is left out: there "[1]" is an index, not a citation
const withoutCode = (markdown: string) => markdown.replace(/```[\s\S]*?(?:```|$)/g, "").replace(/`[^`\n]*`/g, "");

// Original number → number shown, for the numbers that are real sources
export function citationOrder(markdown: string, sources: ReadonlySet<number>): Map<number, number> {
  const order = new Map<number, number>();
  for (const match of withoutCode(markdown).matchAll(CITATION)) {
    for (const n of numbersIn(match[1])) {
      if (sources.has(n) && !order.has(n)) order.set(n, order.size + 1);
    }
  }
  return order;
}

export const CITATION_LINK_PREFIX = "#nyra-cite-";

// A remark plugin: citations become links Markdown.tsx renders as citation pills. Not inside a link, which would nest
// links; code has no text nodes, so it is never touched.
export function remarkCitations(order: ReadonlyMap<number, number>) {
  const citation = (_whole: string, group: string) => {
    const numbers = numbersIn(group);
    // "[2]" that isn't a source (a footnote, an index) stays as written
    if (!numbers.every((n) => order.has(n))) return false;
    return numbers.map(
      (n): Link => ({
        type: "link",
        url: `${CITATION_LINK_PREFIX}${n}`,
        children: [{ type: "text", value: String(order.get(n)) }],
      }),
    );
  };
  return () => (tree: Root) => {
    if (order.size > 0) findAndReplace(tree, [CITATION, citation], { ignore: ["link", "linkReference"] });
  };
}

// What a reply needs to show its citations: the number each source is shown with, and the sources by their own number
export type Citations = { order: ReadonlyMap<number, number>; sources: ReadonlyMap<number, WebSource> };

export function citationsOf(markdown: string, record: WebSearchRecord): Citations {
  const sources = new Map(record.steps.flatMap((step) => step.sources.map((source) => [source.n, source] as const)));
  return { order: citationOrder(markdown, new Set(sources.keys())), sources };
}

// The cited sources in the order they are shown
export function citedSources({ order, sources }: Citations) {
  return [...order].flatMap(([n, shown]) => {
    const source = sources.get(n);
    return source ? [{ shown, source }] : [];
  });
}
