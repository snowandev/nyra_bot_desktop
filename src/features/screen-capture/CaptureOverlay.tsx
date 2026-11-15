import { type PointerEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { capturePreview, finishCapture, showCapture } from "./captureWindow";

type Point = { x: number; y: number };

// Smaller than this reads as a click, not an area
const MIN_SIZE = 4;

function areaBetween(start: Point, end: Point) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

// The frozen screen, dimmed, where the user drags the area to capture. Esc or a right click cancels.
export function CaptureOverlay() {
  const { t } = useTranslation();
  const [src, setSrc] = useState<string | null>(null);
  const [start, setStart] = useState<Point | null>(null);
  const [end, setEnd] = useState<Point | null>(null);
  const isDone = useRef(false);

  function finish(area: ReturnType<typeof areaBetween> | null) {
    if (isDone.current) return;
    isDone.current = true;
    const selection = area && { ...area, viewWidth: window.innerWidth, viewHeight: window.innerHeight };
    // Rust closes this window either way; if it can't hear back, its wait runs out on its own
    void finishCapture(selection).catch(() => {});
  }

  useEffect(() => {
    let url: string | null = null;
    let gone = false;
    capturePreview()
      // Arrived after the window closed: no image is made, so there is nothing to release
      .then((png) => {
        if (gone) return;
        url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
        setSrc(url);
      })
      .catch(() => finish(null));
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    setStart(point);
    setEnd(point);
  }

  function onPointerUp() {
    if (!start || !end) return;
    const area = areaBetween(start, end);
    if (area.width < MIN_SIZE || area.height < MIN_SIZE) {
      setStart(null);
      setEnd(null);
      return;
    }
    finish(area);
  }

  const area = start && end ? areaBetween(start, end) : null;
  const ratio = window.devicePixelRatio || 1;

  return (
    <div
      className="capture-overlay"
      onPointerDown={onPointerDown}
      onPointerMove={(event) => start && setEnd({ x: event.clientX, y: event.clientY })}
      onPointerUp={onPointerUp}
      onContextMenu={(event) => {
        event.preventDefault();
        finish(null);
      }}
    >
      {src && (
        <img className="capture-shot" src={src} alt="" draggable={false} onLoad={() => void showCapture().catch(() => finish(null))} />
      )}
      {area ? (
        <div className="capture-area" style={{ left: area.x, top: area.y, width: area.width, height: area.height }}>
          <span className="capture-size">
            {Math.round(area.width * ratio)} × {Math.round(area.height * ratio)}
          </span>
        </div>
      ) : (
        <>
          <div className="capture-shade" />
          <p className="capture-hint">{t("capture.hint")}</p>
        </>
      )}
    </div>
  );
}
