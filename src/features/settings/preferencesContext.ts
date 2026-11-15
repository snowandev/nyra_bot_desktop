import { createContext } from "react";
import { useRequiredContext } from "@/shared/hooks/useRequiredContext";
import type { usePreferences } from "./usePreferences";

// App owns the state; the screens that need it read it from here instead of receiving it through every level
export const PreferencesContext = createContext<ReturnType<typeof usePreferences> | null>(null);

export const usePreferencesContext = () => useRequiredContext(PreferencesContext, "usePreferencesContext");
