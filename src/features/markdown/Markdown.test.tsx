// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { loadKatex } from "./katexPlugin";
import { Markdown } from "./Markdown";

const html = (text: string) => renderToStaticMarkup(<Markdown>{text}</Markdown>);

describe("formulas in Markdown", () => {
  beforeAll(loadKatex);

  it("draws formulas inside a sentence and on their own lines", () => {
    expect(html("La energía es $E = mc^2$.")).toContain('class="katex"');
    expect(html("$$\n\\int_0^1 x\\,dx\n$$")).toContain('class="katex-display"');
  });

  it("leaves prices as text", () => {
    const out = html("Cuesta $5 y el otro $10.");
    expect(out).not.toContain("katex");
    expect(out).toContain("$5");
  });

  it("shows a formula that can't be drawn as written instead of failing", () => {
    const out = html("$$\\frac{1}$$");
    expect(out).toContain("katex-error");
    expect(out).toContain("\\frac{1}");
  });
});
