import { createRequire } from "node:module";
import { dirname } from "node:path";
import pdfmake from "pdfmake";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import {
  CODE_FONT,
  type DiagramPicture,
  displayFormulas,
  imageSources,
  keepHeadingWithNext,
  MATH_FONT,
  mermaidCodes,
  pdfDefinition,
  TEXT_FONT,
} from "./pdfDefinition";

const report = [
  "# Informe de ventas",
  "",
  "Resumen del **año** con _cursiva_, `código` y un [enlace](https://ejemplo.com) → siguiente paso 🚀.",
  "",
  "- Primer punto",
  "- [x] Tarea hecha",
  "",
  "1. Uno",
  "2. Dos",
  "",
  "| Mes | Total |",
  "|---|--:|",
  "| Enero | 120 |",
  "",
  "```ts",
  "const año = 1; // ñandú → λ",
  "```",
  "",
  "```mermaid",
  "graph TD; A-->B",
  "```",
  "",
  "> Una cita",
  "",
  "![Gráfico](https://ejemplo.com/grafico.png)",
  "",
  "[malo](javascript:alert(1))",
].join("\n");

const flat = (value: unknown): string => JSON.stringify(value);

// A 2×1 PNG, standing in for a diagram drawn by Mermaid
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP8//8/AwMDAA7/Av+4xZ6ZAAAAAElFTkSuQmCC";
const drawn = (width: number, height: number) =>
  new Map<string, DiagramPicture>([["graph TD; A-->B", { dataUrl: PIXEL, width, height }]]);

describe("pdfDefinition", () => {
  const definition = pdfDefinition(report, "Informe de ventas");
  const content = flat(definition.content);

  it("lays out headings, lists, tables, code and quotes", () => {
    expect(content).toContain('"style":"h1"');
    expect(content).toContain('"ul"');
    expect(content).toContain('"ol"');
    expect(content).toContain('"headerRows":1');
    expect(content).toContain(`"font":"${CODE_FONT}"`);
    expect(content).toContain("Diagrama (Mermaid)");
    expect(content).toContain("Una cita");
    expect(content).toContain("[x] ");
    expect(definition.info?.title).toBe("Informe de ventas");
  });

  it("numbers footnotes as they are cited and gathers them at the end", () => {
    const text = "Llegó tarde[^b] y caro[^a].\n\n[^a]: Subió el precio.\n\n[^b]: Por la huelga.\n\nFin.";
    const notes = flat(pdfDefinition(text, "").content);
    expect(notes).toContain('{"sup":true,"color"');
    expect(notes.indexOf('"text":"1."')).toBeLessThan(notes.indexOf('"text":"2."'));
    expect(notes.indexOf("Fin.")).toBeLessThan(notes.indexOf("Por la huelga."));
    expect(notes.indexOf("Por la huelga.")).toBeLessThan(notes.indexOf("Subió el precio."));
  });

  it("gives every run of text its whole style, which pdfmake doesn't pass on to nested runs", () => {
    expect(content).toContain('{"bold":true,"text":"año"}');
    expect(content).toContain('{"italics":true,"text":"cursiva"}');
  });

  it("keeps safe links only and never fetches images", () => {
    expect(content).toContain('"link":"https://ejemplo.com"');
    expect(content).not.toContain("javascript:");
    expect(content).toContain("[Imagen: Gráfico]");
    expect(content).not.toContain("grafico.png");
  });

  it("puts a drawn diagram as its picture, at screen size and never wider than the page", () => {
    const small = flat(pdfDefinition(report, "Informe", drawn(400, 200)).content);
    expect(small).toContain(`"image":"${PIXEL}"`);
    expect(small).toContain('"fit":[300,150]');
    expect(small).not.toContain("graph TD; A-->B");
    // 2000 px wide is past the page: it shrinks to the writing area, keeping its shape
    expect(flat(pdfDefinition(report, "Informe", drawn(2000, 200)).content)).toMatch(/"fit":\[483\.\d+,150\]/);
  });

  it("finds every diagram to draw, also inside lists and quotes", () => {
    const nested = "- Paso\n\n  ```mermaid\n  flowchart LR; X-->Y\n  ```\n\n> ```mermaid\n> pie; \"A\": 1\n> ```";
    expect(mermaidCodes(`${report}\n\n${nested}`)).toEqual(["graph TD; A-->B", "flowchart LR; X-->Y", 'pie; "A": 1']);
  });

  it("writes a formula inside a sentence in the math font and keeps prices as text", () => {
    const math = flat(pdfDefinition("La raíz de $x^2$ cuesta $5 y $a \\neq 0$.", "Fórmulas").content);
    expect(math).toContain(`{"italics":true,"text":"x","font":"${MATH_FONT}"}`);
    expect(math).toContain(`{"sup":true,"text":"2","font":"${MATH_FONT}"}`);
    expect(math).toContain("cuesta $5 y ");
    // ≠ is a / drawn over the =
    expect(math).toMatch(/"text":"=\/","font":"KaTeX","characterSpacing":-6\.7/);
  });

  it("puts a formula on its own line as its picture, or as centered text without one", () => {
    const markdown = "Fórmula:\n\n$$x = \\frac{1}{2}$$\n\n- y \\[ a^2 \\]";
    expect(displayFormulas(markdown)).toEqual(["x = \\frac{1}{2}"]);
    const pictures = new Map([["x = \\frac{1}{2}", { dataUrl: PIXEL, width: 100, height: 40 }]]);
    expect(flat(pdfDefinition(markdown, "F", new Map(), pictures).content)).toContain('"fit":[75,30]');
    expect(flat(pdfDefinition(markdown, "F").content)).toContain('"text":" = 1/2"');
  });

  it("joins the lines of a paragraph, as the chat does", () => {
    const joined = flat(pdfDefinition("Sobre todo por la\nlínea nueva.", "Párrafo").content);
    expect(joined).toContain("Sobre todo por la línea nueva.");
  });

  it("draws a callout as a box with its title, and its marker left out", () => {
    const boxed = flat(pdfDefinition("> [!WARNING]\n> Haz una copia antes.\n\n> [!TIP] Un atajo\n> Pulsa dos veces.", "A").content);
    expect(boxed).toContain('"text":"Atención","bold":true,"color":"#9a4e06"');
    expect(boxed).toContain('"text":"Un atajo"');
    expect(boxed).toContain("Haz una copia antes.");
    expect(boxed).not.toContain("[!");
    // Also when the reply leaves out the quote
    expect(flat(pdfDefinition("[!CAUTION] Borra todo.", "A").content)).toContain('"text":"Peligro","bold":true');
  });

  it("leaves out what the fonts can't draw", () => {
    expect(content).not.toContain("🚀");
    expect(content).toContain("-> siguiente paso");
    // Code is in a standard PDF font: letters outside it become "?"
    expect(content).toContain("const año = 1; // ñandú -> ?");
  });
});

describe("keepHeadingWithNext", () => {
  const at = (top: number, style?: string) => ({ startPosition: { top }, style });
  const node = (headlineLevel?: number) =>
    ({ headlineLevel, ...at(700) }) as unknown as Parameters<typeof keepHeadingWithNext>[0];
  // The heading's own text is a node after it at its same height, and the page number is one more; the rest start lower
  const queries = (following: number, next: number) =>
    ({
      getFollowingNodesOnPage: () => [at(700), ...Array(following).fill(at(740)), at(790, "pageNumber")],
      getNodesOnNextPage: () => Array(next).fill({}),
      getPreviousNodesOnPage: () => [],
    }) as unknown as Parameters<typeof keepHeadingWithNext>[1];

  it("moves a heading left alone at the foot of a page to the next one, with what it heads", () => {
    expect(keepHeadingWithNext(node(2), queries(0, 3))).toBe(true);
  });

  it("leaves a heading with something after it on its page, the last one of the document, and anything else", () => {
    expect(keepHeadingWithNext(node(2), queries(1, 3))).toBe(false);
    expect(keepHeadingWithNext(node(2), queries(0, 0))).toBe(false);
    expect(keepHeadingWithNext(node(), queries(0, 3))).toBe(false);
  });

  it("marks headings so the rule finds them", () => {
    expect(flat(pdfDefinition("# Título\n\nTexto", "T").content)).toContain('"headlineLevel":1');
  });
});

describe("the PDF it makes", () => {
  it("is a real PDF whose text reads back with its accents", async () => {
    const fonts = createRequire(import.meta.url).resolve("@fontsource/inter/files/inter-latin-400-normal.woff");
    const file = (weight: string, style: string) => fonts.replace("400-normal", `${weight}-${style}`);
    const math = (name: string) =>
      createRequire(import.meta.url).resolve(`katex/dist/fonts/KaTeX_${name}.woff`);
    pdfmake.setUrlAccessPolicy(() => false);
    pdfmake.addFonts({
      [TEXT_FONT]: {
        normal: file("400", "normal"),
        bold: file("700", "normal"),
        italics: file("400", "italic"),
        bolditalics: file("700", "italic"),
      },
      [CODE_FONT]: { normal: "Courier", bold: "Courier-Bold", italics: "Courier-Oblique", bolditalics: "Courier-BoldOblique" },
      [MATH_FONT]: {
        normal: math("Main-Regular"),
        bold: math("Main-Bold"),
        italics: math("Math-Italic"),
        bolditalics: math("Math-BoldItalic"),
      },
    });
    const withMath = `${report}\n\nLa energía es $E = mc^2$ con $\\Delta > 0$.`;
    const bytes = new Uint8Array(await pdfmake.createPdf(pdfDefinition(withMath, "Informe", drawn(400, 200))).getBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    // The diagram is embedded as an image; checked first, as pdf.js takes over the bytes it reads
    expect(Buffer.from(bytes).toString("latin1")).toContain("/Subtype /Image");

    // Where pdf.js finds Courier to read the code back
    const standardFontDataUrl = `${dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"))}/standard_fonts/`;
    const pdf = await getDocument({ data: bytes, standardFontDataUrl }).promise;
    const page = await pdf.getPage(1);
    const text = (await page.getTextContent()).items.map((item) => ("str" in item ? item.str : "")).join("");
    expect(text).toContain("Informe de ventas");
    expect(text).toContain("año");
    expect(text).toContain("ñandú");
    expect(text).toContain("1 / 1");
    expect(text).toContain("mc");
    expect(text).toContain("Δ");
    const links = (await page.getAnnotations()).map((annotation) => annotation.url);
    expect(links).toContain("https://ejemplo.com/");
    // The diagram's code is no longer printed
    expect(text).not.toContain("graph TD");
  }, 30_000);
});

describe("the conversation's images in a document", () => {
  const capture: DiagramPicture = { dataUrl: "data:image/png;base64,AAAA", width: 2560, height: 1600 };

  it("draws the ones it names on their own line, and keeps any other as its description", () => {
    const markdown = "![Ofertas en Steam](captura-steam.png)\n\nTexto con ![otra](foto.png) dentro.";
    expect(imageSources(markdown)).toEqual(["captura-steam.png", "foto.png"]);
    const definition = pdfDefinition(markdown, "Ofertas", new Map(), new Map(), new Map([["captura-steam.png", capture]]));
    const [picture, paragraph] = definition.content as object[];
    expect(picture).toMatchObject({ image: capture.dataUrl });
    expect(JSON.stringify(paragraph)).toContain("otra");
    expect(JSON.stringify(paragraph)).not.toContain("data:image");
  });
});
