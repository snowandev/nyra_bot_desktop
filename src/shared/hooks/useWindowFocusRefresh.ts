import { useEffect } from "react";
import { onWindowFocused } from "@/shared/lib/windowFocus";
import { stopListening } from "./useAppEvent";
import { useStableCallback } from "./useStableCallback";

// Coming back to the window often (switching between apps) refreshes at most this often
const MIN_INTERVAL_MS = 5000;

// Reads again what may have changed outside Nyra (a folder, a branch) when the user comes back to the window
export function useWindowFocusRefresh(onRefresh: () => void, enabled = true) {
  const refresh = useStableCallback(onRefresh);

  useEffect(() => {
    if (!enabled) return;
    let last = 0;
    const listening = onWindowFocused(() => {
      if (Date.now() - last < MIN_INTERVAL_MS) return;
      last = Date.now();
      refresh();
    });
    return () => stopListening(listening);
  }, [enabled, refresh]);
}
