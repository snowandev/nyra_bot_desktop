import { createContext } from "react";
import { useRequiredContext } from "@/shared/hooks/useRequiredContext";
import type { useSkills } from "./useSkills";

// App owns the state; the screens that need it read it from here instead of receiving it through every level
export const SkillsContext = createContext<ReturnType<typeof useSkills> | null>(null);

export const useSkillsContext = () => useRequiredContext(SkillsContext, "useSkillsContext");
