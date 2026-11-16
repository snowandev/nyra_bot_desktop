import { openableUrl } from "@/shared/lib/links";
import type { FootnoteDefinition, List, ListItem, PhrasingContent, Root, RootContent, Table } from "mdast";
import type { Content, ContentText, Margins, Node, NodeQueries, TDocumentDefinitions } from "pdfmake/interfaces";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { i18n } from "@/shared/i18n/i18n";
import { type Callout, type CalloutKind, calloutOf } from "@/features/markdown/callouts";
import { normalizeMath } from "@/features/markdown/math";
import { formulaRuns } from "./formulaRuns";

// A Markdown document as a PDF: the same Markdown the chat shows, laid out as a printed document. Nothing is fetched:
// images from the web go in as their description (the conversation's own, named by their file, as pictures), and Mermaid diagrams and formulas on their own lines as pictures
// drawn beforehand by the app.

export const TEXT_FONT = "Inter";
export const CODE_FONT = "Courier";
// The fonts the chat draws formulas with: upright symbols and Greek capitals, and italic letters
export const MATH_FONT = "KaTeX";
const BODY_FONT_SIZE = 10.5;

export const TEXT_COLOR = "#1f2328";
const MUTED_COLOR = "#656d76";
const LINE_COLOR = "#d0d7de";
const CODE_BACKGROUND = "#f3f4f6";
const LINK_COLOR = "#0b5cad";

// The writing area of an A4 page with these margins, in points; a diagram never goes past it
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGINS: Margins = [56, 56, 56, 60];
const CONTENT_WIDTH = PAGE_WIDTH - MARGINS[0] - MARGINS[2];
const DIAGRAM_MAX_HEIGHT = (PAGE_HEIGHT - MARGINS[1] - MARGINS[3]) * 0.85;
// Diagrams are measured in screen pixels; a point is 4/3 of a pixel, so they print at the size they have on screen
const POINTS_PER_PIXEL = 0.75;

// A Mermaid diagram already drawn, by its code: a PNG as a data URL and its size in pixels
export type DiagramPicture = { dataUrl: string; width: number; height: number };
type DiagramPictures = ReadonlyMap<string, DiagramPicture>;
// Formulas on their own lines, already drawn, by their LaTeX; the same shape as a diagram's picture
type FormulaPictures = DiagramPictures;
// The conversation's images a document names, by the address as written; the same shape again
type ImagePictures = DiagramPictures;
type Pictures = { diagrams: DiagramPictures; formulas: FormulaPictures; images: ImagePictures };

// The fonts carry Latin text and the usual punctuation; these common symbols would come out as empty boxes
const SYMBOLS: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "↔": "<->",
  "⇒": "=>",
  "⇐": "<=",
  "≥": ">=",
  "≤": "<=",
  "≠": "!=",
  "≈": "~",
  "✓": "[x]",
  "✔": "[x]",
  "✗": "[ ]",
  "✘": "[ ]",
  "★": "*",
  "☆": "*",
};
const SYMBOL_PATTERN = new RegExp(`[${Object.keys(SYMBOLS).join("")}]`, "g");
// Emoji have no glyph in the fonts; their joiners and variation selectors go with them
const EMOJI = /\p{Extended_Pictographic}|\u{FE0F}|\u{200D}|[\u{1F3FB}-\u{1F3FF}]/gu;

const cleanText = (text: string) => text.replace(EMOJI, "").replace(SYMBOL_PATTERN, (symbol) => SYMBOLS[symbol]);

// Courier, a standard PDF font, has the Latin-1 letters and a few signs; anything else would print as garbage
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const cleanCode = (code: string) =>
  [...cleanText(code)]
    .map((c) => {
      const point = c.codePointAt(0) ?? 0;
      return point === 10 || (point >= 32 && point <= 126) || (point >= 160 && point <= 255) || WIN_ANSI_EXTRA.includes(c)
        ? c
        : "?";
    })
    .join("");

const isSafeLink = (url: string) => openableUrl(url) !== null;

// What a run of text inherits from the marks around it ("**[enlace](…)**" is bold and a link)
type InlineStyle = Omit<ContentText, "text">;

// No font Nyra embeds has ≠, so it is drawn as the chat does: a / over the =. pdfmake only spaces letters within one
// run, so both go in one, pulled together until the / sits on the middle of the =; two spaces pulled together after it
// give back the width that took from the =. In font sizes (em) of the math font.
const EQUALS_WIDTH = 0.778;
const SLASH_WIDTH = 0.5;
const SPACE_WIDTH = 0.25;
const PULL = (EQUALS_WIDTH + SLASH_WIDTH) / 2;
const GIVE_BACK = EQUALS_WIDTH - (EQUALS_WIDTH + SLASH_WIDTH - PULL);

function withNotEqual(run: ContentText, fontSize: number): ContentText[] {
  return run.text
    .toString()
    .split(/(≠)/)
    .filter(Boolean)
    .flatMap((part): ContentText[] =>
      part === "≠"
        ? [
            { ...run, text: "=/", characterSpacing: -PULL * fontSize },
            { ...run, text: "  ", characterSpacing: (GIVE_BACK - 2 * SPACE_WIDTH) * fontSize },
          ]
        : [{ ...run, text: part }],
    );
}

// A formula inside a sentence, as text in the math font; words inside it (\text{…}) in the document's font
function formula(latex: string, style: InlineStyle): ContentText[] {
  const fontSize = style.fontSize ?? BODY_FONT_SIZE;
  return formulaRuns(latex).flatMap(({ text, isText, ...marks }) =>
    withNotEqual({ ...style, ...marks, text, font: isText ? TEXT_FONT : MATH_FONT }, fontSize),
  );
}

// One flat list of runs, each with its full style: pdfmake doesn't apply the style of a run to runs nested inside it
function inline(nodes: PhrasingContent[], style: InlineStyle = {}): ContentText[] {
  const run = (text: string, extra: InlineStyle = {}): ContentText[] =>
    text ? [{ ...style, ...extra, text }] : [];
  return nodes.flatMap((node): ContentText[] => {
    switch (node.type) {
      // A line break inside a paragraph is a space, as in the chat; only a "break" node ends the line
      case "text":
        return run(cleanText(node.value.replace(/\n/g, " ")));
      case "strong":
        return inline(node.children, { ...style, bold: true });
      case "emphasis":
        return inline(node.children, { ...style, italics: true });
      case "delete":
        return inline(node.children, { ...style, decoration: "lineThrough" });
      case "inlineCode":
        return run(cleanCode(node.value), { font: CODE_FONT, background: CODE_BACKGROUND, fontSize: 9.5 });
      case "inlineMath":
        return formula(node.value, style);
      case "break":
        return run("\n");
      case "link":
        return isSafeLink(node.url)
          ? inline(node.children, { ...style, link: node.url, color: LINK_COLOR, decoration: "underline" })
          : inline(node.children, style);
      case "image":
        return run(`[Imagen${node.alt ? `: ${cleanText(node.alt)}` : ""}]`, { color: MUTED_COLOR, italics: true });
      case "footnoteReference":
        return run(node.label ?? node.identifier, { sup: true, color: MUTED_COLOR });
      case "html":
        return run(cleanText(node.value));
      default:
        return "children" in node ? inline(node.children as PhrasingContent[], style) : [];
    }
  });
}

// A shaded box that can continue on the next page
function codeBlock(code: string, label?: string): Content {
  return {
    table: {
      widths: ["*"],
      body: [
        [
          {
            stack: [
              ...(label ? [{ text: label, fontSize: 8, color: MUTED_COLOR, margin: [0, 0, 0, 4] as Margins }] : []),
              { text: cleanCode(code), font: CODE_FONT, fontSize: 9, lineHeight: 1.4, preserveLeadingSpaces: true },
            ],
          },
        ],
      ],
    },
    layout: {
      fillColor: CODE_BACKGROUND,
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: () => 8,
      paddingRight: () => 8,
      paddingTop: () => 7,
      paddingBottom: () => 7,
    },
    margin: [0, 2, 0, 10],
  };
}

// Inside a list a paragraph sits close to the next item; a task's box goes in front of its first paragraph
function listItem(item: ListItem, pictures: Pictures): Content {
  const check = item.checked === true ? "[x] " : item.checked === false ? "[ ] " : "";
  const blocks = item.children.flatMap((child, i): Content[] =>
    child.type === "paragraph"
      ? [{ text: [...(i === 0 && check ? [check] : []), ...inline(child.children)], margin: [0, 0, 0, 3] }]
      : block(child, pictures),
  );
  return { stack: check && item.children[0]?.type !== "paragraph" ? [check, ...blocks] : blocks };
}

function list(node: List, pictures: Pictures): Content {
  const items = node.children.map((item) => listItem(item, pictures));
  const margin: Margins = [0, 0, 0, 8];
  return node.ordered ? { ol: items, start: node.start ?? 1, margin } : { ul: items, margin };
}

function table(node: Table): Content {
  const columns = Math.max(...node.children.map((row) => row.children.length));
  const body = node.children.map((row, r) =>
    Array.from({ length: columns }, (_, c) => ({
      text: inline(row.children[c]?.children ?? []),
      bold: r === 0,
      alignment: node.align?.[c] ?? "left",
    })),
  );
  return {
    table: { headerRows: 1, widths: Array<string>(columns).fill("*"), body },
    layout: {
      fillColor: (row: number) => (row === 0 ? CODE_BACKGROUND : null),
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => LINE_COLOR,
      vLineColor: () => LINE_COLOR,
      paddingLeft: () => 6,
      paddingRight: () => 6,
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
    fontSize: 9.5,
    margin: [0, 2, 0, 10],
  };
}

// Drawn at its screen size, smaller if it doesn't fit the page
const pictureOf = (picture: DiagramPicture): Content => ({
  image: picture.dataUrl,
  fit: [
    Math.min(CONTENT_WIDTH, picture.width * POINTS_PER_PIXEL),
    Math.min(DIAGRAM_MAX_HEIGHT, picture.height * POINTS_PER_PIXEL),
  ],
  alignment: "center",
  margin: [0, 4, 0, 12],
});

// A paragraph of only images of the conversation, as Markdown writes a picture on its own line: each one drawn whole.
// Any other paragraph keeps its images as their description.
function imagesOnly(nodes: PhrasingContent[], images: ImagePictures): Content[] | null {
  const shown = nodes.filter((node) => !(node.type === "text" && !node.value.trim()) && node.type !== "break");
  const drawn = shown.map((node) => (node.type === "image" ? images.get(node.url) : undefined));
  if (shown.length === 0 || drawn.some((picture) => !picture)) return null;
  return drawn.flatMap((picture) => (picture ? [pictureOf(picture)] : []));
}

// Without a picture (a diagram or chart with errors), its code. The label is Nyra's, so it follows the interface's
// language when the PDF is made.
function diagram(code: string, diagrams: DiagramPictures, isChart: boolean): Content {
  const picture = diagrams.get(code);
  if (picture) return pictureOf(picture);
  return codeBlock(code, i18n.t(isChart ? "documents.chartCode" : "documents.diagramCode"));
}

// Without a picture (one the app couldn't draw), written as a formula inside a sentence, on its own centered line
function displayFormula(latex: string, formulas: FormulaPictures): Content {
  const picture = formulas.get(latex);
  return picture ? pictureOf(picture) : { text: formula(latex, {}), alignment: "center", margin: [0, 4, 0, 12] };
}

// The chat's callout colors as they are on a light page, for the bar and the title, and a pale fill
const CALLOUT_COLORS: Record<CalloutKind, { ink: string; fill: string }> = {
  note: { ink: "#0e7490", fill: "#ebf5f8" },
  tip: { ink: "#15803d", fill: "#ebf5ee" },
  important: { ink: "#7c4dd8", fill: "#f3eefc" },
  warning: { ink: "#9a4e06", fill: "#fcf3ea" },
  caution: { ink: "#d4343f", fill: "#fcecec" },
};

// A box with a bar and the title in its kind's color; the title is Nyra's, in the interface's language, unless the
// reply gave its own
function callout({ kind, title, body }: Callout, pictures: Pictures): Content {
  const { ink, fill } = CALLOUT_COLORS[kind];
  return {
    table: {
      widths: ["*"],
      body: [
        [
          {
            stack: [
              { text: title ?? i18n.t(`markdown.callouts.${kind}`), bold: true, color: ink, margin: [0, 0, 0, 4] },
              ...body.flatMap((child) => block(child, pictures)),
            ],
          },
        ],
      ],
    },
    layout: {
      fillColor: () => fill,
      hLineWidth: () => 0,
      vLineWidth: (i: number) => (i === 0 ? 3 : 0),
      vLineColor: () => ink,
      paddingLeft: () => 12,
      paddingRight: () => 12,
      paddingTop: () => 8,
      paddingBottom: () => 2,
    },
    margin: [0, 2, 0, 10],
  };
}

function block(node: RootContent, pictures: Pictures): Content[] {
  switch (node.type) {
    case "heading":
      return [{ text: inline(node.children), style: `h${node.depth}`, headlineLevel: node.depth }];
    case "paragraph": {
      const marked = calloutOf(node);
      if (marked) return [callout(marked, pictures)];
      return imagesOnly(node.children, pictures.images) ?? [{ text: inline(node.children), margin: [0, 0, 0, 8] }];
    }
    case "list":
      return [list(node, pictures)];
    case "code":
      return [
        node.lang === "mermaid" || node.lang === "chart"
          ? diagram(node.value, pictures.diagrams, node.lang === "chart")
          : codeBlock(node.value),
      ];
    case "math":
      return [displayFormula(node.value, pictures.formulas)];
    case "blockquote": {
      const marked = calloutOf(node);
      if (marked) return [callout(marked, pictures)];
      return [
        {
          table: {
            widths: ["*"],
            body: [[{ stack: node.children.flatMap((child) => block(child, pictures)), color: MUTED_COLOR }]],
          },
          layout: {
            hLineWidth: () => 0,
            vLineWidth: (i: number) => (i === 0 ? 2 : 0),
            vLineColor: () => LINE_COLOR,
            paddingLeft: () => 10,
            paddingTop: () => 0,
            paddingBottom: () => 0,
          },
          margin: [0, 0, 0, 8],
        },
      ];
    }
    case "thematicBreak":
      return [
        {
          canvas: [{ type: "line", x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 0.5, lineColor: LINE_COLOR }],
          margin: [0, 6, 0, 12],
        },
      ];
    case "table":
      return [table(node)];
    case "html":
      return [{ text: cleanText(node.value), margin: [0, 0, 0, 8] }];
    case "footnoteDefinition":
      return [
        {
          columns: [
            { text: `${node.label ?? node.identifier}.`, width: 14 },
            { stack: node.children.flatMap((child) => block(child, pictures)), width: "*" },
          ],
          columnGap: 2,
          fontSize: 9,
          color: MUTED_COLOR,
        },
      ];
    default:
      return [];
  }
}

// Formulas are read as the chat reads them (normalizeMath): a lone $ is only math by its shape
const parseMarkdown = (markdown: string): Root =>
  unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath, { singleDollarTextMath: false })
    .parse(normalizeMath(markdown));

// What the app draws before the PDF, also inside lists and quotes, once each
function codesOf(markdown: string, pick: (node: RootContent) => string | null): string[] {
  const codes: string[] = [];
  const visit = (node: Root | RootContent) => {
    const code = node.type === "root" ? null : pick(node);
    if (code !== null) codes.push(code);
    if ("children" in node) (node.children as RootContent[]).forEach(visit);
  };
  visit(parseMarkdown(markdown));
  return [...new Set(codes)];
}

const codeBlocksOf = (markdown: string, language: string) =>
  codesOf(markdown, (node) => (node.type === "code" && node.lang === language ? node.value : null));

// The code of every Mermaid diagram in the document
export const mermaidCodes = (markdown: string) => codeBlocksOf(markdown, "mermaid");

// The data of every chart in the document
export const chartCodes = (markdown: string) => codeBlocksOf(markdown, "chart");

// The address of every image, as written
export const imageSources = (markdown: string) => codesOf(markdown, (node) => (node.type === "image" ? node.url : null));

// The LaTeX of every formula on its own line
export const displayFormulas = (markdown: string) =>
  codesOf(markdown, (node) => (node.type === "math" ? node.value : null));

// The page number at each page's foot, a node like any other for the page break rule below
const PAGE_NUMBER_STYLE = "pageNumber";

// A heading never ends a page: alone at its foot, with what it heads on the next one, it moves there too. One that
// ends the document stays where it is. After it on the page don't count its own text (at its height) nor the page
// number.
export const keepHeadingWithNext = (node: Node, nodes: NodeQueries) =>
  node.headlineLevel !== undefined &&
  !nodes
    .getFollowingNodesOnPage()
    .some((after) => after.style !== PAGE_NUMBER_STYLE && after.startPosition.top > node.startPosition.top) &&
  nodes.getNodesOnNextPage().length > 0;

// A4, as most documents are printed outside the US; the page number goes at the foot of each page
// Footnotes numbered in the order the text cites them and gathered at its end, after a line, as the chat shows them
function withFootnotesAtEnd(root: Root): RootContent[] {
  const numbers = new Map<string, number>();
  const visit = (node: Root | RootContent) => {
    if (node.type === "footnoteReference") {
      if (!numbers.has(node.identifier)) numbers.set(node.identifier, numbers.size + 1);
      node.label = String(numbers.get(node.identifier));
    }
    if ("children" in node) (node.children as RootContent[]).forEach(visit);
  };
  visit(root);
  const notes = root.children
    .filter((node): node is FootnoteDefinition => node.type === "footnoteDefinition" && numbers.has(node.identifier))
    .sort((a, b) => (numbers.get(a.identifier) ?? 0) - (numbers.get(b.identifier) ?? 0));
  notes.forEach((note) => (note.label = String(numbers.get(note.identifier))));
  const text = root.children.filter((node) => node.type !== "footnoteDefinition");
  return notes.length > 0 ? [...text, { type: "thematicBreak" }, ...notes] : text;
}

export function pdfDefinition(
  markdown: string,
  title: string,
  diagrams: DiagramPictures = new Map(),
  formulas: FormulaPictures = new Map(),
  images: ImagePictures = new Map(),
): TDocumentDefinitions {
  return {
    info: { title, creator: "Nyra Bot" },
    pageSize: "A4",
    pageMargins: MARGINS,
    pageBreakBefore: keepHeadingWithNext,
    content: withFootnotesAtEnd(parseMarkdown(markdown)).flatMap((node) => block(node, { diagrams, formulas, images })),
    footer: (page, pages) => ({ text: `${page} / ${pages}`, style: PAGE_NUMBER_STYLE }),
    defaultStyle: { font: TEXT_FONT, fontSize: BODY_FONT_SIZE, lineHeight: 1.3, color: TEXT_COLOR },
    styles: {
      h1: { fontSize: 20, bold: true, margin: [0, 4, 0, 10] },
      h2: { fontSize: 15, bold: true, margin: [0, 10, 0, 6] },
      h3: { fontSize: 12.5, bold: true, margin: [0, 8, 0, 4] },
      h4: { fontSize: 11, bold: true, margin: [0, 6, 0, 4] },
      h5: { fontSize: 10.5, bold: true, margin: [0, 6, 0, 4] },
      h6: { fontSize: 10.5, bold: true, color: MUTED_COLOR, margin: [0, 6, 0, 4] },
      [PAGE_NUMBER_STYLE]: { alignment: "center", fontSize: 8, color: MUTED_COLOR, margin: [0, 24, 0, 0] },
    },
  };
}
