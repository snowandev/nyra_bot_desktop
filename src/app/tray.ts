import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Nyra's icon in the system bar lives in Rust; the frontend only says whether closing should hide the window there

export const setKeepInTray = (keep: boolean) => invoke<void>("set_keep_in_tray", { keep });

// Closing the window only hid it in the tray
export const onKeptInTray = (handler: () => void) => listen("nyra://kept-in-tray", handler);
// "Nueva conversación" in the icon's menu
export const onNewFromTray = (handler: () => void) => listen("nyra://new-conversation", handler);
// One of "Recientes" in the icon's menu, by its id
export const onOpenFromTray = (handler: (id: string) => void) =>
  listen<string>("nyra://open-conversation", ({ payload }) => handler(payload));
