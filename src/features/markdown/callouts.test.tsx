// @vitest-environment happy-dom
import type { Blockquote, Root } from "mdast";
import { renderToStaticMarkup } from "react-dom/server";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { calloutOf } from "./callouts";
import { Markdown } from "./Markdown";

const quote = (markdown: string) => (unified().use(remarkParse).parse(markdown) as Root).children[0] as Blockquote;
const bodyText = (markdown: string) => JSON.stringify(calloutOf(quote(markdown))?.body);

describe("calloutOf", () => {
  it("reads the kind from the marker, in any case, and leaves the marker out of the body", () => {
    const callout = calloutOf(quote("> [!warning]\n> Haz una copia antes."));
    expect(callout?.kind).toBe("warning");
    expect(callout?.title).toBeNull();
    expect(bodyText("> [!warning]\n> Haz una copia antes.")).not.toContain("[!");
    expect(bodyText("> [!warning]\n> Haz una copia antes.")).toContain("Haz una copia antes.");
  });

  it("takes plain text after the marker as the title when more follows, and as the body when nothing does", () => {
    expect(calloutOf(quote("> [!TIP] Un atajo\n> Pulsa dos veces."))?.title).toBe("Un atajo");
    const single = calloutOf(quote("> [!CAUTION] Borra todo."));
    expect(single?.title).toBeNull();
    expect(JSON.stringify(single?.body)).toContain("Borra todo.");
  });

  it("keeps formatted text after the marker in the body", () => {
    const callout = calloutOf(quote("> [!NOTE] **Ojo** con esto"));
    expect(callout?.title).toBeNull();
    expect(JSON.stringify(callout?.body)).toContain("Ojo");
  });

  it("takes a paragraph that starts with the marker as a callout, as models sometimes leave out the quote", () => {
    const paragraph = (unified().use(remarkParse).parse("[!WARNING] `git reset --hard` borra los cambios.") as Root)
      .children[0];
    const callout = paragraph.type === "paragraph" ? calloutOf(paragraph) : null;
    expect(callout?.kind).toBe("warning");
    expect(JSON.stringify(callout?.body)).toContain("git reset --hard");
    expect(JSON.stringify(callout?.body)).not.toContain("[!");
  });

  it("leaves ordinary quotes and unknown markers alone", () => {
    expect(calloutOf(quote("> Una cita normal"))).toBeNull();
    expect(calloutOf(quote("> [!SUMMARY]\n> Texto"))).toBeNull();
  });
});

describe("callouts in a reply", () => {
  it("draws a callout as a box with its title, and an ordinary quote as a quote", () => {
    const html = renderToStaticMarkup(<Markdown>{"> [!CAUTION]\n> Borra todo.\n\n> Una cita"}</Markdown>);
    expect(html).toContain('class="callout callout-caution"');
    expect(html).toContain("Peligro");
    expect(html).toContain("Borra todo.");
    expect(html).not.toContain("[!CAUTION]");
    expect(html).toContain("<blockquote>");
  });

  it("draws a paragraph that starts with the marker as a callout too, also inside a list", () => {
    const html = renderToStaticMarkup(<Markdown>{"[!WARNING] Haz una copia.\n\n1. Paso\n\n   [!TIP] Atajo"}</Markdown>);
    expect(html).toContain('class="callout callout-warning"');
    expect(html).toContain('class="callout callout-tip"');
    expect(html).not.toContain("[!");
  });
});
