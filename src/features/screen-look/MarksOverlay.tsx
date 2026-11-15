import { getCurrentWindow } from "@tauri-apps/api/window";
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NyraPointer } from "./NyraPointer";
import {
  onScreenMarks,
  type ScreenArea,
  type ScreenFrame,
  type ScreenMark,
  type ScreenPointer,
  screenCloseMark,
  screenMarksNow,
  screenNoteAreas,
} from "./screenStorage";

type Rect = { x: number; y: number; width: number; height: number };
type Point = [number, number];

// Around what it marks, so the box doesn't cover its edges
const BOX_PAD = 6;
const NOTE_GAP = 10;
// Room a note needs above its box, and to the right of where it starts; otherwise it goes below, or ends at the box's
// right edge
const NOTE_ROOM_ABOVE = 48;
const NOTE_ROOM_RIGHT = 360;

// A place on the screen, in the window's pixels: the screen may not start exactly at the window's corner
const toPixels = (area: ScreenArea, frame: ScreenFrame): Rect => ({
  x: frame.left + area.x * frame.width,
  y: frame.top + area.y * frame.height,
  width: area.width * frame.width,
  height: area.height * frame.height,
});

const grown = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 });

const center = (r: Rect): Point => [r.x + r.width / 2, r.y + r.height / 2];

// Where the line from a point toward a box's center meets its border, so the arrow ends at the edge
function edge(r: Rect, [x, y]: Point): Point {
  const [cx, cy] = center(r);
  const dx = x - cx;
  const dy = y - cy;
  const scale = Math.min(
    Math.abs(dx) > 0 ? r.width / 2 / Math.abs(dx) : Infinity,
    Math.abs(dy) > 0 ? r.height / 2 / Math.abs(dy) : Infinity,
    1,
  );
  return [cx + dx * scale, cy + dy * scale];
}

function arrowPath(from: Rect, to: Rect) {
  const [sx, sy] = edge(grown(from, 3), center(to));
  const [ex, ey] = edge(grown(to, BOX_PAD + 5), [sx, sy]);
  const angle = Math.atan2(ey - sy, ex - sx);
  const head = (side: number): Point => [ex - 16 * Math.cos(angle + side * 0.45), ey - 16 * Math.sin(angle + side * 0.45)];
  const [lx, ly] = head(1);
  const [rx, ry] = head(-1);
  return `M${sx} ${sy} L${ex} ${ey} M${lx} ${ly} L${ex} ${ey} L${rx} ${ry}`;
}

// Above what it marks, or below when there is no room; by its left edge, or its right one near the window's
function notePlace(box: Rect, screen: { width: number; height: number }): CSSProperties {
  const vertical =
    box.y - BOX_PAD >= NOTE_ROOM_ABOVE
      ? { bottom: screen.height - (box.y - BOX_PAD - NOTE_GAP) }
      : { top: box.y + box.height + BOX_PAD + NOTE_GAP };
  const horizontal =
    box.x - BOX_PAD + NOTE_ROOM_RIGHT <= screen.width
      ? { left: Math.max(0, box.x - BOX_PAD) }
      : { right: Math.max(0, screen.width - (box.x + box.width + BOX_PAD)) };
  return { ...vertical, ...horizontal };
}

// The window over the user's screen where Nyra draws its marks, and its pointer while it uses the mouse. Clicks go
// through it, except on a note: a click there closes its mark.
export function MarksOverlay() {
  const { t } = useTranslation();
  const [marks, setMarks] = useState<ScreenMark[]>([]);
  const [pointer, setPointer] = useState<ScreenPointer | null>(null);
  const [screen, setScreen] = useState({ width: window.innerWidth, height: window.innerHeight });
  // Where the marked screen is in this window; until it is known, the whole window
  const [frame, setFrame] = useState<ScreenFrame | null>(null);
  const notes = useRef(new Map<number, HTMLButtonElement>());

  useEffect(() => {
    // Read again whenever the marks change or the window moves or changes size: the system may place it a moment
    // later, or a little apart from where it was asked to go
    const read = () =>
      void screenMarksNow()
        .then((now) => {
          setMarks(now.marks);
          setPointer(now.pointer);
          setFrame(now.frame);
        })
        .catch(() => setMarks([]));
    read();
    const unlisten = onScreenMarks(() => read());
    const moved = getCurrentWindow().onMoved(read);
    const resized = () => {
      setScreen({ width: window.innerWidth, height: window.innerHeight });
      read();
    };
    window.addEventListener("resize", resized);
    return () => {
      void unlisten.then((stop) => stop());
      void moved.then((stop) => stop());
      window.removeEventListener("resize", resized);
    };
  }, []);
  const area = frame ?? { left: 0, top: 0, ...screen };

  // Where the notes are, so clicks on them reach this window
  useLayoutEffect(() => {
    const areas = marks.flatMap((m) => {
      const note = notes.current.get(m.number);
      if (!note) return [];
      const r = note.getBoundingClientRect();
      return [{ number: m.number, x: r.x, y: r.y, width: r.width, height: r.height }];
    });
    void screenNoteAreas(areas).catch(() => {});
  }, [marks, screen, frame]);

  return (
    <div className="marks-layer" data-theme="light">
      {marks.map((mark) => {
        const box = toPixels(mark.area, area);
        const from = mark.from && toPixels(mark.from, area);
        // With an arrow, the note goes by where it starts, so it never covers the head
        const place = notePlace(from ?? box, screen);
        return (
          <div key={mark.number}>
            {from && (
              <svg className="marks-arrow" width={screen.width} height={screen.height} aria-hidden="true">
                <path d={arrowPath(from, box)} />
              </svg>
            )}
            <div
              className="marks-box"
              style={{
                left: box.x - BOX_PAD,
                top: box.y - BOX_PAD,
                width: box.width + BOX_PAD * 2,
                height: box.height + BOX_PAD * 2,
              }}
            />
            <button
              type="button"
              ref={(note) => {
                if (note) notes.current.set(mark.number, note);
                else notes.current.delete(mark.number);
              }}
              className="marks-note"
              style={place}
              title={t("screen.marks.close")}
              onClick={() => void screenCloseMark(mark.number).catch(() => {})}
            >
              <b>{mark.number}</b>
              {mark.note && <span>{mark.note}</span>}
            </button>
          </div>
        );
      })}
      {pointer && (
        <NyraPointer
          to={[area.left + pointer.x * area.width, area.top + pointer.y * area.height]}
          from={pointer.start && [area.left + pointer.start[0] * area.width, area.top + pointer.start[1] * area.height]}
          glideMs={pointer.glideMs}
          clicks={pointer.clicks}
          label={pointer.label}
          thinking={pointer.thinking}
          leaving={pointer.leaving}
        />
      )}
    </div>
  );
}
