import { useEffect } from "react";
import { isShortcut } from "@/shared/lib/platform";
import type { Shortcut } from "@/shared/lib/shortcuts";
import { useStableCallback } from "./useStableCallback";

type Options = {
  // Off while another screen covers the part of the app the shortcut belongs to
  enabled?: boolean;
};

// Cmd on macOS, Ctrl on Windows and Linux. The browser's own action for the keys (e.g. Ctrl+N opening a window
// in WebView2) is prevented.
export function useShortcut({ key, withShift = false }: Shortcut, onPress: () => void, { enabled = true }: Options = {}) {
  const handlePress = useStableCallback(onPress);

  useEffect(() => {
    if (!enabled) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (!isShortcut(e, key, withShift)) return;
      e.preventDefault();
      // A key held down fires again and again; the shortcut acts once per press
      if (e.repeat) return;
      handlePress();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [key, withShift, enabled, handlePress]);
}
