import { createContext } from "react";
import { useRequiredContext } from "@/shared/hooks/useRequiredContext";
import type { useModelDownloads } from "./useModelDownloads";

// App owns the state; the screens that need it read it from here instead of receiving it through every level
export const ModelDownloadsContext = createContext<ReturnType<typeof useModelDownloads> | null>(null);

export const useModelDownloadsContext = () => useRequiredContext(ModelDownloadsContext, "useModelDownloadsContext");
