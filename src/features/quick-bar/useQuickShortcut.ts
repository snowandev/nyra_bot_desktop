import { useEffect } from "react";
import { setQuickShortcut } from "./quickWindow";

// The main window registers the quick chat bar's shortcut on start and whenever Settings changes it; Settings hears
// the result from Rust
export function useQuickShortcut(enabled: boolean, shortcut: string) {
  useEffect(() => {
    // A failure reaches Settings as the shortcut's status, where the user can choose another
    setQuickShortcut(enabled ? shortcut : null).catch(() => {});
  }, [enabled, shortcut]);
}
