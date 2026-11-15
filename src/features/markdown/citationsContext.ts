import { createContext } from "react";
import type { Citations } from "./citations";

// Citations are rendered deep inside the Markdown tree; the reply provides them here instead of through every level
export const CitationsContext = createContext<{ citations: Citations; isForImage: boolean } | null>(null);
