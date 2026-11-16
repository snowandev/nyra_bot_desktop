import { Maximize, X, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { Dialog } from "@/shared/ui/Dialog";
import type { DiagramImage } from "./svgImage";

type Props = {
  image: DiagramImage;
  alt: string;
  onClose: () => void;
};

const ZOOM_STEP = 0.4;

// A diagram or chart of a reply, large: the wheel or a pinch zooms where the pointer is, dragging moves it
export function DiagramViewer({ image, alt, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <Dialog onClose={onClose} label={alt} className="viewer diagram" backdropClassName="viewer-overlay">
      <TransformWrapper minScale={0.5} maxScale={8} centerOnInit doubleClick={{ mode: "reset" }}>
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            <div className="viewer-header">
              <div className="viewer-title">
                <span className="viewer-name">{alt}</span>
                <span className="viewer-meta">{t("markdown.viewer.hint")}</span>
              </div>
              <button
                type="button"
                className="icon-button small"
                aria-label={t("markdown.viewer.zoomOut")}
                title={t("markdown.viewer.zoomOut")}
                onClick={() => zoomOut(ZOOM_STEP)}
              >
                <ZoomOut size={18} strokeWidth={2} />
              </button>
              <button
                type="button"
                className="icon-button small"
                aria-label={t("markdown.viewer.fit")}
                title={t("markdown.viewer.fit")}
                onClick={() => resetTransform()}
              >
                <Maximize size={17} strokeWidth={2} />
              </button>
              <button
                type="button"
                className="icon-button small"
                aria-label={t("markdown.viewer.zoomIn")}
                title={t("markdown.viewer.zoomIn")}
                onClick={() => zoomIn(ZOOM_STEP)}
              >
                <ZoomIn size={18} strokeWidth={2} />
              </button>
              <button
                data-autofocus
                type="button"
                className="icon-button large"
                aria-label={t("markdown.viewer.close")}
                onClick={onClose}
              >
                <X size={20} strokeWidth={2} />
              </button>
            </div>
            <TransformComponent wrapperClass="diagram-viewer-stage" contentClass="diagram-viewer-content">
              <img src={image.src} width={image.width} height={image.height} alt={alt} draggable={false} />
            </TransformComponent>
          </>
        )}
      </TransformWrapper>
    </Dialog>
  );
}
