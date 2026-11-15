import type { Blockquote, BlockContent, DefinitionContent, Paragraph, PhrasingContent, Root } from "mdast";

// A callout is a quote whose first line is a marker like [!WARNING]: the reply sets one point apart (a note, a tip,
// something important, a warning or a danger). Told by that shape, so it works in any language; a paragraph that starts
// with the marker counts too, since models sometimes leave out the quote. Text after the marker on its line is the
// callout's own title.

export const CALLOUT_KINDS = ["note", "tip", "important", "warning", "caution"] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

export type Callout = {
  kind: CalloutKind;
  title: string | null;
  body: (BlockContent | DefinitionContent)[];
};

const MARKER = /^\[!(note|tip|important|warning|caution)\][ \t]*([^\n]*)(\n?)/i;

// The marker's paragraph without the marker; null when nothing else was in it
function restOf(paragraph: Paragraph, children: PhrasingContent[]): Paragraph | null {
  const kept = children[0]?.type === "break" ? children.slice(1) : children;
  return kept.length > 0 ? { ...paragraph, children: kept } : null;
}

// What callout a quote or a paragraph is, with its body without the marker; null for anything else
export function calloutOf(node: Blockquote | Paragraph): Callout | null {
  const [first, ...rest] = node.type === "paragraph" ? [node] : node.children;
  if (first?.type !== "paragraph") return null;
  const [lead, ...inline] = first.children;
  if (lead?.type !== "text") return null;
  const match = MARKER.exec(lead.value);
  if (!match) return null;
  const kind = match[1].toLowerCase() as CalloutKind;
  // The rest of the marker's line is a title when it is plain text and more follows; otherwise it is the body
  const endsLine = match[3] === "\n" || inline.length === 0 || inline[0].type === "break";
  const afterLine = lead.value.slice(match[0].length);
  const hasMore = (endsLine && (afterLine.trim() !== "" || inline.length > 0)) || rest.length > 0;
  const title = endsLine && hasMore && match[2].trim() ? match[2].trim() : null;
  const remaining = title ? afterLine : lead.value.slice(match[0].length - match[2].length - match[3].length);
  const children: PhrasingContent[] = remaining ? [{ ...lead, value: remaining }, ...inline] : inline;
  const paragraph = restOf(first, children);
  return { kind, title, body: paragraph ? [paragraph, ...rest] : rest };
}

type Node = Root | Root["children"][number];

// A quote drawn by the Markdown's blockquote component as a callout
function calloutQuote(node: Node): Blockquote | null {
  if (node.type !== "blockquote" && node.type !== "paragraph") return null;
  const callout = calloutOf(node);
  if (!callout) return null;
  return {
    type: "blockquote",
    children: callout.body,
    position: node.position,
    data: { hProperties: { dataCallout: callout.kind, ...(callout.title ? { dataCalloutTitle: callout.title } : {}) } },
  };
}

// Remark plugin: each callout takes its quote's or paragraph's place
export function remarkCallouts() {
  const visit = (node: Node) => {
    if (!("children" in node)) return;
    const children = node.children as Node[];
    children.forEach((child, i) => {
      const quote = calloutQuote(child);
      if (quote) children[i] = quote;
      visit(children[i]);
    });
  };
  return (tree: Root) => visit(tree);
}
