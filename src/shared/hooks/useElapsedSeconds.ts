import { useEffect, useState } from "react";

// Whole seconds since since (a Date.now() time) or, without it, since the component appeared; counting while active
export function useElapsedSeconds(active: boolean, since?: number) {
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(mountedAt);
  const startedAt = since ?? mountedAt;

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  // After a pause the last tick is older than a new start until the next one: it never counts below zero
  return Math.floor(Math.max(0, now - startedAt) / 1000);
}
