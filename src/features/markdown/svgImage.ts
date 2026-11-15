import { canvasPng } from "@/shared/lib/pictures";
import { i18n } from "@/shared/i18n/i18n";
import { scaleFor } from "@/features/share/share";

// Drawings made as SVG (Mermaid diagrams, charts) shown as images: an SVG through <img> can't run scripts nor load
// anything, and the same image is copied, shared and put in a PDF.

// svg is the markup behind src, kept to redraw it at another size
export type DiagramImage = { src: string; width: number; height: number; svg: string };

const dataUrlOf = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

// Declares the SVG's size; the viewBox keeps the drawing, so a bigger size is just a sharper image
function withSize(svg: string, width: number, height: number) {
  const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  root.removeAttribute("style");
  return new XMLSerializer().serializeToString(root);
}

// The SVG gets its real size from its viewBox, so the <img> isn't stretched to an arbitrary width
export function svgImage(svg: string): DiagramImage {
  const viewBox = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement.getAttribute("viewBox");
  const [, , viewWidth, viewHeight] = (viewBox ?? "").split(/[\s,]+/).map(Number);
  const width = Math.ceil(viewWidth) || 600;
  const height = Math.ceil(viewHeight) || 400;
  const sized = withSize(svg, width, height);
  return { src: dataUrlOf(sized), width, height, svg: sized };
}

// As sharp as the shared images (scaleFor). WebKit rasterizes an SVG at its own size before a canvas stretches
// it, so the SVG is declared at the final size first. The background is painted in: a dark theme's light text
// would vanish on a white page.
export async function diagramPng(image: DiagramImage, background: string, preferred?: number): Promise<Uint8Array> {
  const scale = scaleFor(image.width, image.height, preferred);
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  const picture = new Image();
  picture.src = dataUrlOf(withSize(image.svg, width, height));
  await picture.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(i18n.t("markdown.imageFailed"));
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.drawImage(picture, 0, 0, width, height);
  const blob = await canvasPng(canvas, i18n.t("markdown.imageFailed"));
  return new Uint8Array(await blob.arrayBuffer());
}
