import { getCurrentWindow } from "@tauri-apps/api/window";

// When the user comes back to Nyra's window, e.g. from the editor where they changed files. Tauri's event works the
// same in the three WebViews, unlike the page's own focus events. Returns how to stop listening.
export function onWindowFocused(callback: () => void) {
  return getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (focused) callback();
  });
}
