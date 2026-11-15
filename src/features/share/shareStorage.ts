import { invoke } from "@tauri-apps/api/core";

// Bytes go as the raw request body; the Rust side writes the clipboard or the file
export const copyImage = (png: Uint8Array) => invoke<void>("copy_image", png);
// false when the save dialog was closed without choosing a place
export const saveImage = (png: Uint8Array) => invoke<boolean>("save_image", png);
