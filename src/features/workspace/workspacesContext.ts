import { createContext } from "react";
import { useRequiredContext } from "@/shared/hooks/useRequiredContext";
import type { useWorkspaces } from "./useWorkspaces";

// App owns the state; the screens that need it read it from here instead of receiving it through every level
export const WorkspacesContext = createContext<ReturnType<typeof useWorkspaces> | null>(null);

export const useWorkspacesContext = () => useRequiredContext(WorkspacesContext, "useWorkspacesContext");
