import { type RefObject, useEffect, useState } from "react";
import { useStableCallback } from "@/shared/hooks/useStableCallback";

type DragState = {
  isDragging: boolean;
  // Where to show the drop overlay; kept in state because a ref can't be read while rendering
  zone: HTMLElement | null;
  // Unknown while dragging in some WebViews, which only reveal the files on drop
  fileCount: number | null;
};

function draggingFiles(e: DragEvent) {
  return e.dataTransfer?.types.includes("Files") ?? false;
}

// A file dropped outside a drop zone would make the WebView navigate to it and leave the app
export function blockStrayFileDrops() {
  function block(e: DragEvent) {
    if (!draggingFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
  }
  window.addEventListener("dragover", block);
  window.addEventListener("drop", block);
}

function fileCountOf(e: DragEvent) {
  const items = Array.from(e.dataTransfer?.items ?? []).filter((item) => item.kind === "file");
  return items.length > 0 ? items.length : null;
}

// The DataTransfer is only readable during the drop, e.g. to reach the folders inside it
export function useFileDrop(
  zoneRef: RefObject<HTMLElement | null>,
  onDrop: (files: File[], dataTransfer: DataTransfer | null) => void,
): DragState {
  const [state, setState] = useState<DragState>({ isDragging: false, zone: null, fileCount: null });
  const handleDrop = useStableCallback(onDrop);

  useEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return;
    // Entering a child fires dragenter before the parent's dragleave, so count instead of toggling
    let depth = 0;

    function onDragEnter(e: DragEvent) {
      if (!draggingFiles(e)) return;
      depth++;
      if (depth === 1) setState({ isDragging: true, zone, fileCount: fileCountOf(e) });
    }
    function onDragOver(e: DragEvent) {
      if (!draggingFiles(e) || !e.dataTransfer) return;
      // Without preventDefault the WebView refuses the drop
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
    function onDragLeave(e: DragEvent) {
      if (!draggingFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setState({ isDragging: false, zone: null, fileCount: null });
    }
    function onDropEvent(e: DragEvent) {
      if (!draggingFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setState({ isDragging: false, zone: null, fileCount: null });
      handleDrop(Array.from(e.dataTransfer?.files ?? []), e.dataTransfer);
    }

    zone.addEventListener("dragenter", onDragEnter);
    zone.addEventListener("dragover", onDragOver);
    zone.addEventListener("dragleave", onDragLeave);
    zone.addEventListener("drop", onDropEvent);
    return () => {
      zone.removeEventListener("dragenter", onDragEnter);
      zone.removeEventListener("dragover", onDragOver);
      zone.removeEventListener("dragleave", onDragLeave);
      zone.removeEventListener("drop", onDropEvent);
    };
  }, [zoneRef, handleDrop]);

  return state;
}
