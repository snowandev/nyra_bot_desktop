import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { common, createLowlight } from "lowlight";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

const lowlight = createLowlight(common);

// Code colored as the replies color it, for code Nyra shows itself rather than from the model's Markdown
export function highlightCode(code: string, language: string) {
  if (!lowlight.registered(language)) return code;
  return toJsxRuntime(lowlight.highlight(language, code), { Fragment, jsx, jsxs });
}
