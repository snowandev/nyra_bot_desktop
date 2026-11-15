import { useCallback, useEffect, useMemo, useState } from "react";
import { errorMessage } from "@/shared/lib/errors";
import {
  addMemory,
  deleteAllMemories,
  deleteMemory,
  listMemories,
  type Memory,
  restoreMemory,
  updateMemory,
} from "./memoryStorage";

const byCreation = (a: Memory, b: Memory) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);

// The saved memories, kept in step with the database. The actions throw so each screen can say what failed where it
// happened.
export function useMemories() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Read again whenever the window gets the focus: the other window (the quick bar, the main one) may have saved or
  // deleted some, and a deleted memory must never go on being sent
  useEffect(() => {
    const read = () =>
      void listMemories()
        .then((list) => {
          setMemories(list);
          setLoadError(null);
        })
        .catch((e) => setLoadError(errorMessage(e)));
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, []);

  // The facts a reply asked to save; those saved before a failure stay saved
  const saveFromReply = useCallback(async (facts: string[], conversationId: string) => {
    const saved: Memory[] = [];
    try {
      for (const fact of facts) saved.push(await addMemory(crypto.randomUUID(), fact, conversationId, "model"));
    } finally {
      if (saved.length > 0) setMemories((list) => [...list, ...saved]);
    }
    return saved.map(({ id, text }) => ({ id, text }));
  }, []);

  const add = useCallback(async (text: string) => {
    const memory = await addMemory(crypto.randomUUID(), text, null, "user");
    setMemories((list) => [...list, memory]);
  }, []);

  const update = useCallback(async (id: string, text: string) => {
    const stored = await updateMemory(id, text);
    setMemories((list) => list.map((m) => (m.id === id ? { ...m, text: stored, updatedAt: Date.now() } : m)));
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteMemory(id);
    setMemories((list) => list.filter((m) => m.id !== id));
  }, []);

  const restore = useCallback(async (memory: Memory) => {
    await restoreMemory(memory);
    setMemories((list) => [...list, memory].sort(byCreation));
  }, []);

  const removeAll = useCallback(async () => {
    await deleteAllMemories();
    setMemories([]);
  }, []);

  return useMemo(
    () => ({ memories, loadError, saveFromReply, add, update, remove, restore, removeAll }),
    [memories, loadError, saveFromReply, add, update, remove, restore, removeAll],
  );
}
