import { useEffect, useState } from "react";
import { errorMessage } from "@/shared/lib/errors";
import { sortFolders } from "./folders";
import { createFolder, deleteFolder, type Folder, listFolders, renameFolder } from "./folderStorage";

// The folders of the sidebar. Actions reject with the reason (in Spanish) so the editor can show it in place.
export function useFolders() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listFolders()
      .then((list) => {
        if (!cancelled) setFolders(sortFolders(list));
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function create(name: string) {
    const folder = await createFolder(crypto.randomUUID(), name);
    setFolders((list) => sortFolders([...list, folder]));
    return folder;
  }

  async function rename(id: string, name: string) {
    const stored = await renameFolder(id, name);
    setFolders((list) => sortFolders(list.map((f) => (f.id === id ? { ...f, name: stored } : f))));
  }

  async function remove(id: string) {
    await deleteFolder(id);
    setFolders((list) => list.filter((f) => f.id !== id));
  }

  return { folders, error, create, rename, remove };
}
