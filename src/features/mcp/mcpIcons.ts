import { useEffect, useSyncExternalStore } from "react";
import { mcpIcons, onMcpIcon, type ServerIcon } from "./mcpStorage";

// The servers' icons for Settings and the chat's cards: read once, and again when Rust says one arrived

let icons: Record<string, ServerIcon> = {};
let loaded = false;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

async function reload() {
  // Only pictures: without them, each server shows its initial
  icons = await mcpIcons().catch(() => icons);
  listeners.forEach((listener) => listener());
}

let listening: Promise<() => void> | null = null;

export function useMcpIcons() {
  useEffect(() => {
    if (!loaded) {
      loaded = true;
      void reload();
    }
    listening ??= onMcpIcon(() => void reload());
  }, []);
  return useSyncExternalStore(subscribe, () => icons);
}
