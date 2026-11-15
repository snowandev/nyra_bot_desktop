import { homeDir } from "@tauri-apps/api/path";
import { useEffect, useState } from "react";

// It never changes while Nyra is open, so it is asked once
let asked: Promise<string | null> | null = null;

// The user's folder, to show paths inside it with ~; null until known or if it can't be known
export function useHomeDir() {
  const [home, setHome] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    asked ??= homeDir().catch(() => null);
    void asked.then((path) => {
      if (!cancelled) setHome(path);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return home;
}
