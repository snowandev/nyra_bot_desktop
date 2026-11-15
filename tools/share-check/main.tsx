import "@/shared/i18n/i18n";
import "@/app/fonts";
import "@/shared/styles/index.css";
import { createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { replyAsMarkdown } from "@/features/documents/documents";
import { markdownToPdf } from "@/features/documents/pdfExport";
import { ConversationImagesContext, imagesByName } from "@/features/markdown/conversationImages";
import { replyImage } from "@/features/share/replyImage";
import { ShareCard } from "@/features/share/ShareCard";
import { QUALITY_SCALE } from "@/features/share/share";
import { applyLanguage } from "@/shared/i18n/i18n";
import { ANSWER, QUESTION } from "./sample";

// The share card as the chat renders it while sharing, with what run.mjs asks of it. The page's address says the
// theme (?theme=dark) and the language (?lang=en).

declare const PDF_FONTS_URL: string;

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";
applyLanguage(params.get("lang") === "en" ? "en" : "es");

// The screenshot the sample's document names, as a page drawn here: a sidebar, three figures and a table
function panelCapture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const draw = canvas.getContext("2d") as CanvasRenderingContext2D;
  draw.fillStyle = "#fbfaff";
  draw.fillRect(0, 0, 1280, 720);
  draw.fillStyle = "#ece8f6";
  draw.fillRect(0, 0, 260, 720);
  draw.fillStyle = "#1f1b2e";
  draw.font = "bold 34px sans-serif";
  draw.fillText("Panel de la tienda", 300, 70);
  for (const [i, x] of [300, 620, 940].entries()) {
    draw.strokeStyle = "#d6d0e6";
    draw.strokeRect(x, 110, 290, 130);
    draw.fillStyle = i === 0 ? "#7c4dd8" : "#1f1b2e";
    draw.fillText(["1.284", "48.230 €", "37,6 €"][i], x + 24, 190);
  }
  draw.fillStyle = "#e6e2f0";
  for (let y = 290; y < 690; y += 50) draw.fillRect(300, y, 930, 2);
  return {
    id: "panel",
    kind: "image" as const,
    name: "panel-tienda.png",
    mimeType: "image/png",
    data: canvas.toDataURL("image/png").split(",")[1],
  };
}
const images = imagesByName([panelCapture()]);

const stage = document.createElement("div");
stage.className = "share-stage";
document.body.append(stage);
const card = createRef<HTMLDivElement>();
flushSync(() =>
  createRoot(stage).render(
    <ConversationImagesContext value={images}>
      <ShareCard ref={card} question={QUESTION} answer={ANSWER} />
    </ConversationImagesContext>,
  ),
);

function base64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Each page of the PDF drawn as a PNG, to look at it as it prints
async function pdfPages(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const pdf = await pdfjs.getDocument({ data: bytes, standardFontDataUrl: PDF_FONTS_URL }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, viewport }).promise;
    pages.push(canvas.toDataURL("image/png").split(",")[1]);
  }
  return pages;
}

const check = {
  image: async () => base64(await replyImage(card.current as HTMLDivElement, QUALITY_SCALE.normal)),
  pdf: async () => pdfPages(await markdownToPdf(replyAsMarkdown(ANSWER.content), "Share check", images)),
  markdown: () => replyAsMarkdown(ANSWER.content),
};

Object.assign(window, { shareCheck: check });
