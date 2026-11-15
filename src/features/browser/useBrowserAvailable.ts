import { useEffect, useState } from "react";
import { browserAvailable } from "./browserStorage";

// Whether the user can open the browser themselves: the feature is on and a browser Nyra can drive is installed
export function useBrowserAvailable(enabled: boolean) {
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void browserAvailable()
      .then((name) => current && setInstalled(!!name))
      .catch(() => current && setInstalled(false));
    return () => {
      current = false;
    };
  }, [enabled]);
  return enabled && installed;
}
