import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import { type RefObject, useEffect, useRef, useState } from "react";
import { drawPageForScreen } from "./pdf";

type Props = {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  // In CSS pixels; the canvas is drawn at the screen's resolution
  width: number;
  // Width over height, so the page keeps its place before it is drawn
  shape: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  label: string;
};

// Drawn only while it is near the visible part of the viewer: a page far away gives its memory back, which keeps a
// long PDF from filling it with canvases
export function PdfPageCanvas({ pdf, pageNumber, width, shape, scrollRef, label }: Props) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isNear, setIsNear] = useState(false);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    const observer = new IntersectionObserver(([entry]) => setIsNear(entry.isIntersecting), {
      root: scrollRef.current,
      rootMargin: "100% 0px",
    });
    observer.observe(holder);
    return () => observer.disconnect();
  }, [scrollRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isNear || !canvas) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    pdf
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return;
        task = drawPageForScreen(page, canvas, width);
        return task.promise;
      })
      // A drawing cancelled because the page scrolled away rejects; a page that fails to draw stays blank
      .catch(() => {});
    return () => {
      cancelled = true;
      task?.cancel();
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [isNear, pdf, pageNumber, width]);

  return (
    <div ref={holderRef} className="viewer-pdf-page" style={{ width, height: width / shape }} role="img" aria-label={label}>
      <canvas ref={canvasRef} />
    </div>
  );
}
