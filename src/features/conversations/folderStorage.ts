import { invoke } from "@tauri-apps/api/core";

// Folders are stored by the Rust side, next to the conversations; it validates names again

export type Folder = {
  id: string;
  name: string;
};

export const listFolders = () => invoke<Folder[]>("list_folders");
export const createFolder = (id: string, name: string) => invoke<Folder>("create_folder", { id, name });
// Resolves to the name as stored (trimmed)
export const renameFolder = (id: string, name: string) => invoke<string>("rename_folder", { id, name });
// Its conversations go back to the general list
export const deleteFolder = (id: string) => invoke<void>("delete_folder", { id });
