import { useEffect } from "react";
import { useStableCallback } from "./useStableCallback";

type Stop = () => void;

// Stops a listener once it started; one that never did (no window, as in tests) has nothing to stop
export const stopListening = (listening: Promise<Stop>) => void listening.then((stop) => stop()).catch(() => {});

// Listens to one of the app's events (from Rust or another window) while the component is there and `enabled`. The
// handler can change on every render: the latest one is called, without listening again.
export function useAppEvent<Args extends unknown[]>(
  subscribe: (handler: (...args: Args) => void) => Promise<Stop>,
  handler: (...args: Args) => void,
  enabled = true,
) {
  const latest = useStableCallback(handler);
  useEffect(() => {
    if (!enabled) return;
    const listening = subscribe(latest);
    return () => stopListening(listening);
  }, [subscribe, latest, enabled]);
}
