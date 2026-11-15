import { invoke } from "@tauri-apps/api/core";

// The selection window lives in Rust: it holds the frozen screen and waits for the area the user drags

// Where the drag ended up, in this window's CSS pixels; Rust scales it to the screen's real pixels with the view size
type CaptureSelection = {
  x: number;
  y: number;
  width: number;
  height: number;
  viewWidth: number;
  viewHeight: number;
};

export const capturePreview = () => invoke<ArrayBuffer>("capture_preview");
export const showCapture = () => invoke<void>("show_capture");
// null cancels
export const finishCapture = (selection: CaptureSelection | null) => invoke<void>("finish_capture", { selection });
