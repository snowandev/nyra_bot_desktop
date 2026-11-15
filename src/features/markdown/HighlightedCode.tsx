import { useMemo } from "react";
import { highlightCode } from "./codeHighlight";

type Props = {
  code: string;
  language: string;
};

export function HighlightedCode({ code, language }: Props) {
  const lines = code.split("\n");
  const highlighted = useMemo(() => highlightCode(code, language), [code, language]);

  return (
    <div className="highlighted-code">
      <div className="line-numbers" aria-hidden="true">
        {lines.map((_, i) => (
          <span key={i}>{i + 1}</span>
        ))}
      </div>
      <pre>
        <code className="hljs">{highlighted}</code>
      </pre>
    </div>
  );
}
