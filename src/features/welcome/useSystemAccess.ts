import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { useEffect, useState } from "react";
import { useWindowFocusRefresh } from "@/shared/hooks/useWindowFocusRefresh";
import { type Access, requestSystemAccess, systemAccess, type SystemAccessKind } from "./welcomeStorage";

export type AccessKind = SystemAccessKind | "notifications";
// null for each one this system doesn't ask for
export type AccessState = Record<AccessKind, Access | null>;

async function readAccess(): Promise<AccessState> {
  const [system, notifications] = await Promise.all([systemAccess(), isPermissionGranted()]);
  return { ...system, notifications: notifications ? "granted" : "notAsked" };
}

// Whether the welcome has something to ask
export const asksSomething = (state: AccessState) => Object.values(state).some((a) => a !== null && a !== "granted");

// What the system lets Nyra use, read again when the user comes back from the system's settings
export function useSystemAccess() {
  const [state, setState] = useState<AccessState | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => void readAccess().then(setState).catch(setError), []);
  // Granted in the system's settings, it shows as soon as the user is back
  useWindowFocusRefresh(() => void readAccess().then(setState).catch(setError), state !== null);

  async function request(kind: AccessKind) {
    setError(null);
    try {
      const answer =
        kind === "notifications"
          ? (await requestPermission()) === "granted"
            ? "granted"
            : "denied"
          : await requestSystemAccess(kind);
      setState((s) => (s ? { ...s, [kind]: answer } : s));
    } catch (e) {
      setError(e);
    }
  }

  return { state, error, request };
}
