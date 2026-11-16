import { memo } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";

type Props = {
  text: string;
  remarkPlugins: Options["remarkPlugins"];
  rehypePlugins: Options["rehypePlugins"];
  rehypeOptions: Options["remarkRehypeOptions"];
  components: Components;
};

// One block of a reply; drawn again only when its own text or the plugins change
export const MarkdownBlock = memo(function MarkdownBlock(props: Props) {
  const { text, remarkPlugins, rehypePlugins, rehypeOptions, components } = props;
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      remarkRehypeOptions={rehypeOptions}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
});
