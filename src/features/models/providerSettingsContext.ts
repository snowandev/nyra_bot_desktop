import { createContext } from "react";
import { useRequiredContext } from "@/shared/hooks/useRequiredContext";
import type { useProviderSettings } from "./useProviderSettings";

// App owns the state; the screens that need it read it from here instead of receiving it through every level
export const ProviderSettingsContext = createContext<ReturnType<typeof useProviderSettings> | null>(null);

export const useProviderSettingsContext = () => useRequiredContext(ProviderSettingsContext, "useProviderSettingsContext");
