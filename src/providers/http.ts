import type { ProviderConfig } from "@/shared/types";

// What the HTTP providers share: where a path lives and how the key goes

export function endpoint(config: ProviderConfig, path: string) {
  return `${config.baseUrl.trim().replace(/\/+$/, "")}${path}`;
}

export function headers(config: ProviderConfig): Record<string, string> {
  const result: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey.trim()) result.Authorization = `Bearer ${config.apiKey.trim()}`;
  return result;
}

// Local servers may refuse origins they don't know with a 403, and the one Tauri uses on Windows
// (http://tauri.localhost) is on no list, unlike macOS's tauri://localhost. An empty Origin makes the HTTP plugin
// leave the header out, as for any app that isn't a web page, so they answer on every system without configuring.
export function withoutOrigin(init: RequestInit): RequestInit {
  const result = new Headers(init.headers);
  result.set("Origin", "");
  return { ...init, headers: result };
}
