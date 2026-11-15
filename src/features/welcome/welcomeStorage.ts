import { invoke } from "@tauri-apps/api/core";

// The computer's memory in bytes, to recommend a model that runs well on it; null when the system won't say
export const systemMemory = () => invoke<number | null>("system_memory");

// A system permission: denied means only the system's settings can grant it now
export type Access = "granted" | "denied" | "notAsked";
export type SystemAccessKind = "microphone" | "screen" | "accessibility";

// null for each one this system doesn't ask for
export const systemAccess = () => invoke<Record<SystemAccessKind, Access | null>>("system_access");
export const requestSystemAccess = (kind: SystemAccessKind) => invoke<Access | null>("request_system_access", { kind });
export const openAccessSettings = (kind: SystemAccessKind) => invoke<void>("open_access_settings", { kind });
