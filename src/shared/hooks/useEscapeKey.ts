import { useEffect } from "react";
import { useStableCallback } from "./useStableCallback";

// What closes with Escape, the last one opened on top: only that one closes, so a dialog over a review, or a menu
// over a panel, goes alone and the rest stays
const layers: (() => void)[] = [];

function closeTopLayer(e: KeyboardEvent) {
  if (e.key === "Escape") layers[layers.length - 1]?.();
}

export function useEscapeKey(onEscape: () => void, enabled = true) {
  const handleEscape = useStableCallback(onEscape);

  useEffect(() => {
    if (!enabled) return;
    const layer = () => handleEscape();
    layers.push(layer);
    if (layers.length === 1) document.addEventListener("keydown", closeTopLayer);
    return () => {
      layers.splice(layers.indexOf(layer), 1);
      if (layers.length === 0) document.removeEventListener("keydown", closeTopLayer);
    };
  }, [handleEscape, enabled]);
}
