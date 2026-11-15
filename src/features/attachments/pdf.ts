import { base64ToBytes } from "@/shared/lib/base64";
// The legacy build avoids the newest JS features, which older WebKitGTK and WKWebView versions lack
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PdfVisual } from "@/shared/types";
import { type Box, IDENTITY, imageBox, type Matrix, multiply, pageLayout } from "./pdfLayout";
import { loadOnce } from "@/shared/lib/loadOnDemand";

// Wide enough for vision models to read small print without inflating their image tokens
const IMAGE_WIDTH = 1024;
const JPEG_QUALITY = 0.85;
// A figure is drawn sharper than its page would be, but the canvas has to stay within what every WebView allows
const MAX_FIGURE_SCALE = 4;
const MAX_CANVAS_PIXELS = 16_000_000;
// A scanned book attached would be hundreds of page images, kept with it and sent with every message; past these the
// rest goes as text only. A folder's PDF is read by pages, so it has no cap.
export const MAX_ATTACHED_PDF_IMAGES = 20;

export type PdfContent = {
  text: string;
  // The text of each page, so a folder's PDF can be read by page
  pageTexts: string[];
  visuals: PdfVisual[];
  pageCount: number;
  // When maxImages was reached: the last page whose images were looked at
  visualsUpToPage?: number;
};

export type PdfProgress = {
  page: number;
  pages: number;
};

export type ReadPdfOptions = {
  onProgress?: (progress: PdfProgress) => void;
  signal?: AbortSignal;
  // Models without vision only use the text, and finding and drawing what to show them is the slow part
  withVisuals?: boolean;
  maxImages?: number;
};

type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

// Loaded on demand: pdf.js is large and most conversations never attach a PDF
const loadPdfjs = loadOnce<Pdfjs>(() =>
  import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    return pdfjs;
  }),
);

export function isPasswordError(error: unknown) {
  return error instanceof Error && error.name === "PasswordException";
}

export function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}


async function pageText(page: PDFPageProxy) {
  const { items } = await page.getTextContent();
  return items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join("");
}

// Where the page paints images and how many shapes it draws, from its list of drawing operations; nothing is drawn
async function pageDrawing(pdfjs: Pdfjs, page: PDFPageProxy) {
  const { OPS } = pdfjs;
  const imageOps = new Set([
    OPS.paintImageXObject,
    OPS.paintInlineImageXObject,
    OPS.paintImageMaskXObject,
    OPS.paintImageXObjectRepeat,
    OPS.paintInlineImageXObjectGroup,
    OPS.paintImageMaskXObjectGroup,
    OPS.paintImageMaskXObjectRepeat,
  ]);
  const { fnArray, argsArray } = await page.getOperatorList();
  const saved: Matrix[] = [];
  let matrix = IDENTITY;
  const images: Box[] = [];
  let paths = 0;
  for (const [i, op] of fnArray.entries()) {
    const args: unknown = argsArray[i];
    if (op === OPS.save) saved.push(matrix);
    else if (op === OPS.restore) matrix = saved.pop() ?? IDENTITY;
    else if (op === OPS.transform && Array.isArray(args)) matrix = multiply(matrix, args as Matrix);
    else if (op === OPS.paintFormXObjectBegin) {
      saved.push(matrix);
      const form: unknown = Array.isArray(args) ? args[0] : null;
      if (Array.isArray(form) && form.length === 6) matrix = multiply(matrix, form as Matrix);
    } else if (op === OPS.paintFormXObjectEnd) matrix = saved.pop() ?? IDENTITY;
    else if (imageOps.has(op)) images.push(imageBox(matrix));
    else if (op === OPS.constructPath) paths++;
  }
  return { images, paths };
}

function toJpeg(canvas: HTMLCanvasElement) {
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY).split(",")[1] ?? "";
}

async function drawPage(page: PDFPageProxy, canvas: HTMLCanvasElement, scale: number) {
  const viewport = page.getViewport({ scale });
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  // JPEG has no transparency, so pages need an explicit white background
  await page.render({ canvas, viewport, background: "white" }).promise;
  return viewport;
}

// Each figure at up to IMAGE_WIDTH pixels: the page is drawn once, as sharp as the widest figure needs
async function figureImages(page: PDFPageProxy, boxes: Box[], canvas: HTMLCanvasElement) {
  const base = page.getViewport({ scale: 1 });
  const widest = Math.max(...boxes.map(([x0, , x1]) => x1 - x0));
  const scale = Math.min(
    IMAGE_WIDTH / widest,
    MAX_FIGURE_SCALE,
    Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height)),
  );
  const viewport = await drawPage(page, canvas, scale);
  const crop = document.createElement("canvas");
  return boxes.map((box) => {
    const [ax, ay] = viewport.convertToViewportPoint(box[0], box[1]) as [number, number];
    const [bx, by] = viewport.convertToViewportPoint(box[2], box[3]) as [number, number];
    const x = Math.max(0, Math.min(ax, bx));
    const y = Math.max(0, Math.min(ay, by));
    const width = Math.min(canvas.width - x, Math.abs(bx - ax));
    const height = Math.min(canvas.height - y, Math.abs(by - ay));
    const fit = Math.min(1, IMAGE_WIDTH / width);
    crop.width = Math.max(1, Math.round(width * fit));
    crop.height = Math.max(1, Math.round(height * fit));
    crop.getContext("2d")?.drawImage(canvas, x, y, width, height, 0, 0, crop.width, crop.height);
    return toJpeg(crop);
  });
}

async function pageVisuals(pdfjs: Pdfjs, page: PDFPageProxy, text: string, canvas: HTMLCanvasElement) {
  const { images, paths } = await pageDrawing(pdfjs, page);
  const layout = pageLayout({ view: page.view as Box, images, paths, textChars: text.trim().length });
  if (layout.kind === "text") return [];
  if (layout.kind === "page") {
    await drawPage(page, canvas, IMAGE_WIDTH / page.getViewport({ scale: 1 }).width);
    return [{ page: page.pageNumber, kind: "page" as const, data: toJpeg(canvas) }];
  }
  const figures = await figureImages(page, layout.boxes, canvas);
  return figures.map((data) => ({ page: page.pageNumber, kind: "figure" as const, data }));
}

// The text of every page and, for vision models, only the pictures it can't get from the text
export async function readPdf(
  data: ArrayBuffer | Uint8Array,
  { onProgress, signal, withVisuals = true, maxImages = Infinity }: ReadPdfOptions = {},
): Promise<PdfContent> {
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({ data });
  const canvas = document.createElement("canvas");
  try {
    const pdf = await loadingTask.promise;
    const pageTexts: string[] = [];
    const visuals: PdfVisual[] = [];
    let visualsUpToPage: number | undefined;
    for (let n = 1; n <= pdf.numPages; n++) {
      signal?.throwIfAborted();
      onProgress?.({ page: n, pages: pdf.numPages });
      const page = await pdf.getPage(n);
      const text = await pageText(page);
      pageTexts.push(text);
      // Past the cap nothing more is drawn, which is also most of the time a scanned PDF takes
      if (withVisuals && visualsUpToPage === undefined) {
        const found = await pageVisuals(pdfjs, page, text, canvas);
        visuals.push(...found.slice(0, maxImages - visuals.length));
        if (visuals.length >= maxImages && n < pdf.numPages) visualsUpToPage = n;
      }
      page.cleanup();
    }
    return {
      text: pageTexts.join("\n\n").trim(),
      pageTexts,
      visuals,
      pageCount: pdf.numPages,
      ...(visualsUpToPage !== undefined && { visualsUpToPage }),
    };
  } finally {
    await loadingTask.destroy();
  }
}

// For the viewer: the document stays open while it is shown, and each page is drawn when it comes into view
export async function openPdf(base64: string) {
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({ data: base64ToBytes(base64) });
  const pdf = await loadingTask.promise;
  return { pdf, close: () => loadingTask.destroy() };
}

// Width over height of every page, so the viewer keeps each page's place before drawing it
export async function pageShapes(pdf: PDFDocumentProxy) {
  const shapes: number[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const viewport = (await pdf.getPage(n)).getViewport({ scale: 1 });
    shapes.push(viewport.width / viewport.height);
  }
  return shapes;
}

// At the screen's real resolution, so text stays as sharp as in a PDF reader
export function drawPageForScreen(page: PDFPageProxy, canvas: HTMLCanvasElement, cssWidth: number): RenderTask {
  const scale = (cssWidth * window.devicePixelRatio) / page.getViewport({ scale: 1 }).width;
  const viewport = page.getViewport({ scale });
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  return page.render({ canvas, viewport, background: "white" });
}
