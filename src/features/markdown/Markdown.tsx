import { memo, useContext, useMemo } from "react";
import type { Components, Options } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { CitationsContext } from "./citationsContext";
import { CITATION_LINK_PREFIX, remarkCitations } from "./citations";
import { remarkCallouts } from "./callouts";
import { Citation } from "./Citation";
import { CodeBlock } from "./CodeBlock";
import { useKatexPlugin } from "./katexPlugin";
import { markdownBlocks } from "./markdownBlocks";
import { MarkdownBlock } from "./MarkdownBlock";
import { normalizeMath } from "./math";
import { QuoteBlock } from "./QuoteBlock";
import { TableBlock } from "./TableBlock";
import { ExternalImage } from "./ExternalImage";
import { ExternalLink } from "@/shared/ui/ExternalLink";

const MARKDOWN_COMPONENTS: Components = {
  pre: CodeBlock,
  a: ({ href, children }) =>
    href?.startsWith(CITATION_LINK_PREFIX) ? (
      <Citation href={href} />
    ) : (
      <ExternalLink href={href}>{children}</ExternalLink>
    ),
  blockquote: QuoteBlock,
  img: ({ src, alt }) => <ExternalImage src={typeof src === "string" ? src : undefined} alt={alt} />,
  // Wide tables scroll horizontally instead of stretching the chat column
  table: TableBlock,
};

type Props = {
  children: string;
};

type Plugin = NonNullable<Options["rehypePlugins"]>[number];

// A lone $ never opens a formula here: normalizeMath decides which ones are, so prices stay text
const MATH: Plugin = [remarkMath, { singleDollarTextMath: false }];
const HIGHLIGHT_ONLY = [rehypeHighlight];

// The text in blocks inside one container, so the page is the same as one parse of the whole text, and only a block
// that changed is parsed again; while a reply streams, that is its last one
export const Markdown = memo(function Markdown({ children }: Props) {
  const order = useContext(CitationsContext)?.citations.order;
  // The citations are worked out again as the reply grows: the same numbering mustn't parse every block again
  const orderKey = order ? [...order].join(";") : null;
  const remarkPlugins = useMemo(
    () => (order ? [remarkGfm, MATH, remarkCallouts, remarkCitations(order)] : [remarkGfm, MATH, remarkCallouts]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orderKey],
  );
  const blocks = useMemo(() => markdownBlocks(normalizeMath(children)), [children]);
  // Every formula is written as $$ by now
  const katex = useKatexPlugin(blocks.some((block) => block.includes("$$")));
  // Formulas before highlighting: a formula is not code
  const rehypePlugins = useMemo(() => (katex ? [katex, rehypeHighlight] : HIGHLIGHT_ONLY), [katex]);
  return (
    <div className="markdown">
      {blocks.map((block, i) => (
        // Blocks only grow at the end, so their position identifies them
        <MarkdownBlock
          key={i}
          text={block}
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={MARKDOWN_COMPONENTS}
        />
      ))}
    </div>
  );
});
