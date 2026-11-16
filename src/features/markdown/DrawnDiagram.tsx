import { CircleAlert, LoaderCircle } from "lucide-react";
import { type ReactNode, Suspense, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useDocumentTheme } from "./useDocumentTheme";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import { retryingLazy } from "@/shared/lib/loadOnDemand";
import { LoadErrorBoundary } from "@/shared/ui/LoadErrorBoundary";
import { renderChart } from "@/features/charts/chartImage";
import { drawnDiagram, keepDrawn } from "./diagramCache";
import { renderMermaid } from "./mermaid";
import type { DiagramImage } from "./svgImage";

// What a code block can draw: a Mermaid diagram or a chart of data
export type DiagramKind = "mermaid" | "chart";

// Loaded the first time a diagram is enlarged, with its zoom
const DiagramViewer = retryingLazy(() => import("./DiagramViewer").then((m) => m.DiagramViewer));

const DRAW = { mermaid: renderMermaid, chart: renderChart };

const TEXTS = {
  mermaid: { error: "markdown.diagramError", drawing: "markdown.drawing", alt: "markdown.diagramAlt" },
  chart: { error: "markdown.chartError", drawing: "markdown.drawingChart", alt: "markdown.chartAlt" },
} as const;

type Props = {
  kind: DiagramKind;
  code: string;
  // Shown under the error when the code can't be drawn: the code itself
  fallback: ReactNode;
  // The drawn diagram, or null when the code can't be drawn; the block's copy button uses it
  onDrawn: (image: DiagramImage | null) => void;
};

type Result = { key: string; image?: DiagramImage; error?: string };

// While a reply streams the code changes with every token and is incomplete; drawing waits for a pause
const SETTLE_MS = 500;

export function DrawnDiagram({ kind, code, fallback, onDrawn }: Props) {
  const { t } = useTranslation();
  const theme = useDocumentTheme();
  const key = `${kind}\n${theme}\n${code}`;
  const [result, setResult] = useState<Result | null>(null);
  // Kept on screen while a newer version is being drawn, so the diagram doesn't flicker
  const [lastImage, setLastImage] = useState<DiagramImage | null>(null);
  const [isEnlarged, setIsEnlarged] = useState(false);
  const drawn = useStableCallback(onDrawn);
  // A diagram drawn before (the conversation opened again) is shown at once
  const cached = drawnDiagram(key);

  useEffect(() => {
    let cancelled = false;
    const before = drawnDiagram(key);
    if (before) {
      keepDrawn(key, before);
      drawn("image" in before ? before.image : null);
      return;
    }
    const timer = window.setTimeout(() => {
      DRAW[kind](code, theme).then(
        (image) => {
          keepDrawn(key, { image });
          if (cancelled) return;
          setResult({ key, image });
          setLastImage(image);
          drawn(image);
        },
        (e: unknown) => {
          const error = e instanceof Error ? e.message : String(e);
          keepDrawn(key, { error });
          if (cancelled) return;
          setResult({ key, error });
          drawn(null);
        },
      );
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [kind, code, theme, key, drawn]);

  const current = result?.key === key ? result : cached ? { key, ...cached } : null;

  if (current?.error) {
    return (
      <>
        <div className="diagram-error" role="status">
          <CircleAlert size={15} strokeWidth={2} />
          <span>
            <Trans i18nKey={TEXTS[kind].error} components={{ strong: <strong /> }} />
            <span className="diagram-error-detail">{current.error}</span>
          </span>
        </div>
        {fallback}
      </>
    );
  }

  const image = current?.image ?? lastImage;
  if (!image) {
    return (
      <div className="diagram-loading" role="status">
        <LoaderCircle size={16} strokeWidth={2.2} className="spin" />
        {t(TEXTS[kind].drawing)}
      </div>
    );
  }

  const alt = t(TEXTS[kind].alt);
  const close = () => setIsEnlarged(false);
  return (
    <div className={`diagram-picture ${current ? "" : "updating"}`}>
      <button
        type="button"
        className="diagram-enlarge"
        title={t("markdown.viewer.open")}
        onClick={() => setIsEnlarged(true)}
      >
        <img src={image.src} width={image.width} height={image.height} alt={alt} />
      </button>
      {isEnlarged && (
        <LoadErrorBoundary leave={{ label: t("markdown.viewer.close"), onLeave: close }}>
          <Suspense fallback={null}>
            <DiagramViewer image={image} alt={alt} onClose={close} />
          </Suspense>
        </LoadErrorBoundary>
      )}
    </div>
  );
}
