import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { openPdf, pageShapes } from "./pdf";
import { PdfPageCanvas } from "./PdfPageCanvas";

type Props = {
  // The PDF file in base64
  data: string;
};

// The PDF itself, drawn by pdf.js at the screen's resolution as each page comes into view. The WebViews' own PDF
// viewers can't be used: WebKitGTK has none, and the app's security policy blocks embedding documents.
export function PdfDocumentView({ data }: Props) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState<{ pdf: PDFDocumentProxy; shapes: number[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let closed = false;
    let close: (() => Promise<void>) | null = null;
    openPdf(data)
      .then(async (file) => {
        // Closed before it finished opening: nothing else will release it
        if (closed) return file.close();
        close = file.close;
        const shapes = await pageShapes(file.pdf);
        if (!closed) setOpened({ pdf: file.pdf, shapes });
      })
      .catch(() => {
        if (!closed) setFailed(true);
      });
    return () => {
      closed = true;
      void close?.();
    };
  }, [data]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="viewer-pages" ref={scrollRef}>
      {failed ? (
        <p className="viewer-pdf-status">{t("attachments.viewer.pdfFailed")}</p>
      ) : !opened ? (
        <p className="viewer-pdf-status" role="status">
          {t("attachments.viewer.openingPdf")}
        </p>
      ) : (
        width > 0 &&
        opened.shapes.map((shape, i) => (
          <PdfPageCanvas
            key={i}
            pdf={opened.pdf}
            pageNumber={i + 1}
            width={width}
            shape={shape}
            scrollRef={scrollRef}
            label={t("attachments.viewer.page", { page: i + 1, pages: opened.shapes.length })}
          />
        ))
      )}
    </div>
  );
}
