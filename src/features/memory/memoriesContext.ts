import { createContext } from "react";
import { useRequiredContext } from "@/shared/hooks/useRequiredContext";
import type { useMemories } from "./useMemories";

// App owns the state; the screens that need it read it from here instead of receiving it through every level
export const MemoriesContext = createContext<ReturnType<typeof useMemories> | null>(null);

export const useMemoriesContext = () => useRequiredContext(MemoriesContext, "useMemoriesContext");
