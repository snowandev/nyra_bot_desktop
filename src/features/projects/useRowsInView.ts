import { type RefObject, useEffect, useState } from "react";
import { rowsInView } from "./fileTree";

// The rows of a long list inside a scrolling panel that are worth drawing: a folder with thousands of files would
// otherwise put thousands of buttons on the page at once
export function useRowsInView(listRef: RefObject<HTMLElement | null>, count: number, rowHeight: number) {
  const [view, setView] = useState({ top: 0, height: 800 });

  useEffect(() => {
    const list = listRef.current;
    const scroller = list?.closest<HTMLElement>(".project-panel-body");
    if (!list || !scroller) return;
    const measure = () => {
      const top =
        scroller.scrollTop -
        (list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop);
      setView({ top, height: scroller.clientHeight });
    };
    measure();
    scroller.addEventListener("scroll", measure, { passive: true });
    const resized = new ResizeObserver(measure);
    resized.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", measure);
      resized.disconnect();
    };
  }, [listRef, count]);

  return rowsInView(view.top, view.height, count, rowHeight);
}

// Scrolls the panel just enough to show a row, before focusing it
export function scrollRowIntoView(listRef: RefObject<HTMLElement | null>, index: number, rowHeight: number) {
  const list = listRef.current;
  const scroller = list?.closest<HTMLElement>(".project-panel-body");
  if (!list || !scroller) return;
  const listTop = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  const rowTop = listTop + index * rowHeight;
  if (rowTop < scroller.scrollTop) scroller.scrollTop = rowTop;
  else if (rowTop + rowHeight > scroller.scrollTop + scroller.clientHeight) {
    scroller.scrollTop = rowTop + rowHeight - scroller.clientHeight;
  }
}
