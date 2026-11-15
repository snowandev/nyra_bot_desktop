import { invoke } from "@tauri-apps/api/core";

// Saved memories live on the Rust side, next to the conversations; it validates them again

type MemorySource = "model" | "user";

export type Memory = {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  // The conversation it came from; null when it was added in Settings
  conversationId: string | null;
  source: MemorySource;
};

export const listMemories = () => invoke<Memory[]>("list_memories");
export const addMemory = (id: string, text: string, conversationId: string | null, source: MemorySource) =>
  invoke<Memory>("add_memory", { id, text, conversationId, source });
// Resolves to the text as stored (spaces tidied)
export const updateMemory = (id: string, text: string) => invoke<string>("update_memory", { id, text });
// Puts back a memory deleted moments ago, keeping its dates and place in the list
export const restoreMemory = (memory: Memory) => invoke<void>("restore_memory", { memory });
export const deleteMemory = (id: string) => invoke<void>("delete_memory", { id });
export const deleteAllMemories = () => invoke<void>("delete_all_memories");
