import { createContext } from "react";
import { useRequiredContext } from "@/shared/hooks/useRequiredContext";
import type { useUpdates } from "./useUpdates";

// App owns the update; the sidebar's notice, the notes window and Settings read it from here
export const UpdatesContext = createContext<ReturnType<typeof useUpdates> | null>(null);

export const useUpdatesContext = () => useRequiredContext(UpdatesContext, "useUpdatesContext");
