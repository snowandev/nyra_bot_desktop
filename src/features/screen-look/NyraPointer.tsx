import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { along, type Point } from "./pointerPath";

type Props = {
  // Its tip, in the marks window's pixels
  to: Point;
  // Where it comes out of the first time: the user's own mouse
  from: Point | null;
  glideMs: number;
  // Each new click shows as a ripple
  clicks: number;
  label: string;
  // Waiting for the next step: the label breathes
  thinking: boolean;
  // The task is over: it shrinks and fades away instead of vanishing
  leaving: boolean;
};

const stillWanted = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Nyra's own pointer, in the user's accent with what it is doing beside it. It glides along an arc from one place to
// the next, leaning as it goes and breathing while still, so the user sees what it is about to click and it feels
// like someone moving it.
export function NyraPointer({ to, from, glideMs, clicks, label, thinking, leaving }: Props) {
  const { t } = useTranslation();
  const body = useRef<HTMLDivElement>(null);
  const arrow = useRef<SVGSVGElement>(null);
  // Where it is drawn now, so a new place starts from there even halfway through a glide
  const now = useRef<Point | null>(null);
  const [x, y] = to;

  useLayoutEffect(() => {
    const place = ([px, py]: Point, lean: number) => {
      now.current = [px, py];
      if (body.current) body.current.style.transform = `translate(${px}px, ${py}px)`;
      if (arrow.current) arrow.current.style.transform = `rotate(${lean}deg)`;
    };
    const start = now.current ?? from ?? [x, y];
    if (glideMs <= 0 || stillWanted() || (start[0] === x && start[1] === y)) {
      place([x, y], 0);
      return;
    }
    body.current?.classList.add("moving");
    const began = performance.now();
    let frame = 0;
    const step = (time: number) => {
      const progress = (time - began) / glideMs;
      const { at, lean } = along(start, [x, y], progress);
      place(at, lean);
      if (progress < 1) frame = requestAnimationFrame(step);
      else body.current?.classList.remove("moving");
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // A new place or glide starts it; where it comes from is read once, the first time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, glideMs]);

  return (
    <div
      ref={body}
      className={`nyra-pointer${leaving ? " leaving" : ""}`}
      role="img"
      aria-label={t("screen.pointer.label")}
    >
      <span className="nyra-pointer-body">
        <span className="nyra-pointer-tip">
          {clicks > 0 && <span key={clicks} className="nyra-pointer-ripple" aria-hidden="true" />}
          <svg
            ref={arrow}
            key={`press-${clicks}`}
            className={clicks > 0 ? "pressed" : undefined}
            width="26"
            height="28"
            viewBox="0 0 26 28"
            aria-hidden="true"
          >
            <path d="M3 2.5 L22.5 11.2 L13.4 13.6 L9.6 23.5 Z" />
          </svg>
        </span>
        {label && <span className={`nyra-pointer-label${thinking ? " thinking" : ""}`}>{label}</span>}
      </span>
    </div>
  );
}
