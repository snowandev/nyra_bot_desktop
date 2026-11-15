import { loadImage } from "@/shared/lib/pictures";
import interBoldItalic from "@fontsource/inter/files/inter-latin-700-italic.woff?url";
import interBold from "@fontsource/inter/files/inter-latin-700-normal.woff?url";
import interItalic from "@fontsource/inter/files/inter-latin-400-italic.woff?url";
import interRegular from "@fontsource/inter/files/inter-latin-400-normal.woff?url";
import katex from "katex";
import mathRegular from "katex/dist/fonts/KaTeX_Main-Regular.woff?url";
import mathBold from "katex/dist/fonts/KaTeX_Main-Bold.woff?url";
import mathItalic from "katex/dist/fonts/KaTeX_Math-Italic.woff?url";
import mathBoldItalic from "katex/dist/fonts/KaTeX_Math-BoldItalic.woff?url";
import type { TFontContainer } from "pdfmake/interfaces";
import { renderChart } from "@/features/charts/chartImage";
import { type ConversationImages, imageNamed } from "@/features/markdown/conversationImages";
import { renderMermaid } from "@/features/markdown/mermaid";
import { diagramPng } from "@/features/markdown/svgImage";
import { drawFormulas } from "@/features/share/formulaPictures";
import { QUALITY_SCALE } from "@/features/share/share";
import { i18n } from "@/shared/i18n/i18n";
import { base64Of } from "@/shared/lib/base64";
import {
  chartCodes,
  type DiagramPicture,
  displayFormulas,
  imageSources,
  MATH_FONT,
  mermaidCodes,
  pdfDefinition,
  TEXT_COLOR,
  TEXT_FONT,
} from "./pdfDefinition";

// The app's own font, embedded in every PDF, so accents and ñ look the same on any computer; code goes in Courier,
// a font every PDF reader has
const TEXT_FILES = {
  normal: ["Inter-Regular.woff", interRegular],
  bold: ["Inter-Bold.woff", interBold],
  italics: ["Inter-Italic.woff", interItalic],
  bolditalics: ["Inter-BoldItalic.woff", interBoldItalic],
} as const;

// Formulas inside a sentence are written with the chat's math fonts: italics are the letters of variables
const MATH_FILES = {
  normal: ["KaTeX-Main-Regular.woff", mathRegular],
  bold: ["KaTeX-Main-Bold.woff", mathBold],
  italics: ["KaTeX-Math-Italic.woff", mathItalic],
  bolditalics: ["KaTeX-Math-BoldItalic.woff", mathBoldItalic],
} as const;

const fontNames = (files: typeof TEXT_FILES | typeof MATH_FILES) =>
  Object.fromEntries(Object.entries(files).map(([style, [name]]) => [style, name]));

type Pdfmake = typeof import("pdfmake/build/pdfmake");

// Loaded the first time a PDF is saved, so starting Nyra doesn't wait for it
let library: Promise<Pdfmake> | null = null;

function loadPdfmake() {
  library ??= (async () => {
    const [pdfmakeModule, courierModule, texts] = await Promise.all([
      import("pdfmake/build/pdfmake"),
      import("pdfmake/build/standard-fonts/Courier"),
      Promise.all(
        [...Object.values(TEXT_FILES), ...Object.values(MATH_FILES)].map(async ([name, url]) => {
          const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
          return [name, base64Of(bytes)] as const;
        }),
      ),
    ]);
    // Built as a script for pages, so the library is the module's default export
    const pdfMake = ((pdfmakeModule as { default?: Pdfmake }).default ?? pdfmakeModule) as Pdfmake;
    const courier = ((courierModule as { default?: TFontContainer }).default ?? courierModule) as TFontContainer;
    // The document is written by a model: nothing in it may make the app download anything
    pdfMake.setUrlAccessPolicy(() => false);
    pdfMake.addFontContainer(courier);
    pdfMake.addVirtualFileSystem(Object.fromEntries(texts));
    pdfMake.addFonts({ [TEXT_FONT]: fontNames(TEXT_FILES), [MATH_FONT]: fontNames(MATH_FILES) });
    return pdfMake;
  })().catch((e: unknown) => {
    library = null;
    throw e;
  });
  return library;
}

// The page is white, so diagrams are drawn in the light theme whatever the app's
const DIAGRAM_BACKGROUND = "#ffffff";

// Each Mermaid diagram and chart drawn as in the chat, as a sharp PNG; one with errors is left out and goes as its code
async function diagramPictures(markdown: string) {
  const pictures = new Map<string, DiagramPicture>();
  const drawings = [
    ...mermaidCodes(markdown).map((code) => ({ code, draw: renderMermaid })),
    ...chartCodes(markdown).map((code) => ({ code, draw: renderChart })),
  ];
  for (const { code, draw } of drawings) {
    try {
      const image = await draw(code, "light");
      const png = await diagramPng(image, DIAGRAM_BACKGROUND);
      const dataUrl = `data:image/png;base64,${base64Of(png)}`;
      pictures.set(code, { dataUrl, width: image.width, height: image.height });
    } catch {
      // A diagram with errors: its code is still in the PDF, which is better than failing the whole document
    }
  }
  return pictures;
}

// The size of the PDF's text in pixels (10.5 points), so a formula prints at the size it has next to the text in the chat
const FORMULA_TEXT_PX = 14;

// Each formula on its own line drawn as in the chat, dark on the white page, through the same sheet as shared images.
// One KaTeX can't draw is left out and goes as text.
async function formulaPictures(markdown: string) {
  const pictures = new Map<string, DiagramPicture>();
  const formulas = displayFormulas(markdown);
  if (formulas.length === 0) return pictures;
  const host = document.createElement("div");
  Object.assign(host.style, { position: "fixed", left: "-100000px", top: "0", color: TEXT_COLOR });
  host.style.fontSize = `${FORMULA_TEXT_PX}px`;
  document.body.append(host);
  try {
    const drawable = formulas.flatMap((latex) => {
      const holder = document.createElement("div");
      katex.render(latex, holder, { displayMode: true, throwOnError: false, strict: "ignore" });
      host.append(holder);
      const drawn = holder.querySelector<HTMLElement>(".katex");
      return drawn && !holder.querySelector(".katex-error") ? [{ latex, drawn }] : [];
    });
    const drawn = await drawFormulas(
      host,
      drawable.map(({ drawn }) => drawn),
      QUALITY_SCALE.high,
    );
    for (const [i, { latex }] of drawable.entries()) {
      const { png, width, height } = drawn[i];
      const dataUrl = `data:image/png;base64,${base64Of(new Uint8Array(await png.arrayBuffer()))}`;
      pictures.set(latex, { dataUrl, width, height });
    }
  } catch {
    // Without pictures the formulas still go in the PDF, as text, which is better than failing the whole document
  } finally {
    host.remove();
  }
  return pictures;
}

// The PDF library only takes these
const PDF_IMAGE_TYPES = new Set(["image/png", "image/jpeg"]);

// The conversation's images the Markdown names, with their size in pixels, so each fits the page as it is
async function imagePictures(markdown: string, images: ConversationImages) {
  const pictures = new Map<string, DiagramPicture>();
  for (const src of imageSources(markdown)) {
    const image = imageNamed(images, src);
    if (!image?.data || !PDF_IMAGE_TYPES.has(image.mimeType)) continue;
    const dataUrl = `data:${image.mimeType};base64,${image.data}`;
    try {
      const { width, height } = await sizeOf(dataUrl);
      pictures.set(src, { dataUrl, width, height });
    } catch {
      // A damaged image goes in as its description, which is better than failing the whole document
    }
  }
  return pictures;
}

const sizeOf = (dataUrl: string) =>
  loadImage(dataUrl).then((picture) => ({ width: picture.naturalWidth, height: picture.naturalHeight }));

// The Markdown of a document or a reply as a PDF file. images: the conversation's, which it may name.
export async function markdownToPdf(
  markdown: string,
  title: string,
  images: ConversationImages = new Map(),
): Promise<Uint8Array> {
  const [pdfMake, diagrams, formulas, pictures] = await Promise.all([
    loadPdfmake(),
    diagramPictures(markdown),
    formulaPictures(markdown),
    imagePictures(markdown, images),
  ]);
  try {
    const definition = pdfDefinition(markdown, title, diagrams, formulas, pictures);
    return new Uint8Array(await pdfMake.createPdf(definition).getBuffer());
  } catch (e) {
    // The library's errors are technical and in English
    throw new Error(i18n.t("documents.pdfFailed"), { cause: e });
  }
}
