import { memo } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";

type Props = {
  text: string;
  remarkPlugins: Options["remarkPlugins"];
  rehypePlugins: Options["rehypePlugins"];
  components: Components;
};

// One block of a reply; drawn again only when its own text or the plugins change
export const MarkdownBlock = memo(function MarkdownBlock({ text, remarkPlugins, rehypePlugins, components }: Props) {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
      {text}
    </ReactMarkdown>
  );
});
