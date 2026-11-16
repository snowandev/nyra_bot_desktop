// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/shared/i18n/i18n";
import { loadKatex } from "./katexPlugin";
import { Markdown } from "./Markdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("footnotes and tasks", () => {
  afterEach(() => i18n.changeLanguage("es"));

  it("names the footnotes for screen readers only, and they jump within the reply", async () => {
    const text = "El pedido llegó tarde[^1].\n\n[^1]: Por la huelga de transporte.";
    expect(html(text)).toContain(`class="visually-hidden" id="footnote-label">${i18n.t("markdown.footnotes")}</h2>`);
    expect(html(text)).toContain('href="#user-content-fn-1"');
    expect(html(text)).not.toContain("unsafe-link");
    await i18n.changeLanguage("en");
    expect(html(text)).toContain(">Notes</h2>");
    expect(html(text)).toContain('aria-label="Back to note 1 in the text"');
  });

  it("draws a task's box, ticked or not, instead of the system's checkbox", () => {
    const out = html("- [x] Catálogo listo\n- [ ] Revisar envíos");
    expect(out).not.toContain("<input");
    expect(out).toContain('class="task-box checked" role="checkbox" aria-checked="true"');
    expect(out).toContain('class="task-box " role="checkbox" aria-checked="false"');
  });
});

describe("long code", () => {
  const fence = "```";
  const block = (lines: number, line = "x") =>
    `${fence}\n${Array.from({ length: lines }, () => line).join("\n")}\n${fence}`;

  it("folds a long block until it is unfolded, and leaves a short one whole", () => {
    expect(html(block(10))).not.toContain("folded");
    expect(html(block(10))).not.toContain("code-block-fold");
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<Markdown>{block(40)}</Markdown>));
    const fold = container.querySelector<HTMLButtonElement>(".code-block-fold");
    expect(container.querySelector(".code-block")?.classList.contains("folded")).toBe(true);
    expect(fold?.textContent).toBe(i18n.t("markdown.unfoldCode", { count: 40 }));
    act(() => fold?.click());
    expect(container.querySelector(".code-block")?.classList.contains("folded")).toBe(false);
    act(() => root.unmount());
  });

  it("offers to wrap only lines too long for the column", () => {
    expect(html(block(3, "corto"))).not.toContain("code-block-wrap");
    expect(html(block(3, "y".repeat(120)))).toContain("code-block-wrap");
  });
});
