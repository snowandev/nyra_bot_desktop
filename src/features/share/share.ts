import { i18n } from "@/shared/i18n/i18n";
import { canvasPng as pngOf } from "@/shared/lib/pictures";
import type { ImageQuality } from "@/shared/storage/settings";
import { withRetries } from "@/shared/lib/loadOnDemand";
import { fontFacesFor } from "./fontFaces";

// Copy or save the reply as an image, or save its text as a Markdown file
export type ShareAction = "copy" | "save" | "markdown" | "pdf";

// The resolution each quality asks for: high to zoom in or print, normal sharp on any screen, low light to send.
// A long reply gets less whatever the choice (scaleFor).
export const QUALITY_SCALE: Record<ImageQuality, number> = { high: 4, normal: 3, low: 2 };
// Canvas limits differ by WebView; staying under these keeps a very long reply from coming out blank
const MAX_SIDE = 16_384;
const MAX_PIXELS = 60_000_000;

// As sharp as asked, lowered only when the image would exceed the canvas limits
export function scaleFor(width: number, height: number, preferred = QUALITY_SCALE.high) {
  const fit = Math.min(MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_PIXELS / (width * height)));
  return Math.max(1, Math.min(preferred, fit));
}

// Diagrams are drawn a moment after the card appears; the capture waits for them, but never for one that hangs
const DIAGRAMS_WAIT_MS = 6000;
const DIAGRAMS_CHECK_MS = 100;

export async function whenDiagramsDrawn(node: HTMLElement) {
  const giveUpAt = Date.now() + DIAGRAMS_WAIT_MS;
  while (node.querySelector(".diagram-loading") && Date.now() < giveUpAt) {
    await new Promise((resolve) => setTimeout(resolve, DIAGRAMS_CHECK_MS));
  }
}

// WebKit turns an SVG image into pixels at its size on the page and then stretches it, so a diagram came out blurry
// next to sharp text: each one is swapped for a PNG drawn at the final size before the capture. Gives back what frees
// those PNGs once the capture is done.
export async function sharpenDiagrams(node: HTMLElement, preferred: number): Promise<() => void> {
  const pictures = [...node.querySelectorAll<HTMLImageElement>(".diagram-picture img")];
  const urls: string[] = [];
  const release = () => urls.forEach((url) => URL.revokeObjectURL(url));
  if (pictures.length === 0) return release;
  const { diagramPng } = await withRetries(() => import("@/features/markdown/svgImage"));
  try {
    await drawEach(pictures, urls, diagramPng, node, preferred);
  } catch (e) {
    // The PNGs made before the failure go too
    release();
    throw e;
  }
  return release;
}

async function drawEach(
  pictures: HTMLImageElement[],
  urls: string[],
  diagramPng: typeof import("@/features/markdown/svgImage").diagramPng,
  node: HTMLElement,
  preferred: number,
) {
  for (const picture of pictures) {
    const svg = decodeURIComponent(picture.src.slice(picture.src.indexOf(",") + 1));
    // The drawing's own size (its attributes); the PNG gets as many pixels as the image will give the room it takes in
    // the card, not more: a wide diagram at four times its own size was too big for WebKit to paint
    const width = Number(picture.getAttribute("width"));
    const height = Number(picture.getAttribute("height"));
    const shown = picture.getBoundingClientRect().width;
    const scale = shown > 0 && width > 0 ? (shown * preferred) / width : preferred;
    const background = getComputedStyle(picture.closest(".diagram-picture") ?? node).backgroundColor;
    const png = await diagramPng({ src: picture.src, width, height, svg }, background, scale);
    const url = URL.createObjectURL(new Blob([new Uint8Array(png)], { type: "image/png" }));
    urls.push(url);
    picture.src = url;
    await picture.decode();
  }
}

// Drawn from the page itself, so the image looks exactly like the chat in the current theme
// The page is drawn as an image that carries its fonts. WebKit may not have read them yet when it first paints it, and
// then the text comes out in another font, wider, breaking lines it didn't break on screen: the image is painted again
// a few times over a second, the last paint with the fonts in place.
const REDRAWS = 4;
const REDRAW_EVERY_MS = 250;

export async function captureImage(node: HTMLElement, preferred: number): Promise<Uint8Array> {
  const { width, height } = node.getBoundingClientRect();
  const canvas = await drawCanvas(node, {
    width,
    height,
    scale: scaleFor(width, height, preferred),
    backgroundColor: getComputedStyle(node).backgroundColor,
  });
  return new Uint8Array(await (await canvasPng(canvas)).arrayBuffer());
}

type DrawOptions = {
  width: number;
  height: number;
  scale: number;
  // Transparent without it
  backgroundColor?: string;
  // Applied to the drawn copy of the node only
  style?: Partial<CSSStyleDeclaration>;
};

export async function drawCanvas(node: HTMLElement, { width, height, scale, backgroundColor, style }: DrawOptions) {
  // Loaded the first time a reply is shared, so starting Nyra doesn't wait for it
  const { createContext, domToCanvas } = await withRetries(() => import("modern-screenshot"));
  await document.fonts.ready;
  const fontFaces = await fontFacesFor(node);
  const context = await createContext(node, {
    width,
    height,
    scale,
    style,
    backgroundColor,
    font: fontFaces ? { cssText: fontFaces } : false,
    drawImageInterval: REDRAW_EVERY_MS,
    autoDestruct: true,
    // WebKit rasterizes an SVG image at its own size before the canvas stretches it, which blurs the text.
    // Declaring the final size (the viewBox keeps the layout) makes it paint the text at full resolution.
    onCreateForeignObjectSvg: (svg) => {
      svg.setAttribute("width", String(Math.floor(width * scale)));
      svg.setAttribute("height", String(Math.floor(height * scale)));
      // The library repaints once per image, which made a reply with many formulas take seconds, and not at all
      // without images, while the fonts need their time: a fixed number of repaints covers both
      context.drawImageCount = REDRAWS;
    },
  });
  return domToCanvas(context);
}

export const canvasPng = (canvas: HTMLCanvasElement) => pngOf(canvas, i18n.t("share.imageFailed"));
