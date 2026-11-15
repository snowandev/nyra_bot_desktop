import { useEffect, useMemo, useState } from "react";
import type { Conversation } from "@/shared/types";
import { mergePending } from "./pending";
import { type PendingItem, projectsPending } from "./projectStorage";

// What waits for the user across the projects. Read from disk once per list of projects: a saved conversation only
// changes after it is opened, and then its copy in memory takes over.
export function useProjectsPending(projectsKey: string, conversations: Conversation[]) {
  const [stored, setStored] = useState<PendingItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    projectsPending()
      .then((items) => {
        if (!cancelled) setStored(items);
      })
      // Without it the panel only shows what is pending in the conversations open in Nyra
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectsKey]);

  const merged = useMemo(() => mergePending(stored, conversations), [stored, conversations]);
  // A reply being written replaces its conversation on every frame, rarely what waits in it: the same list is kept
  // while nothing in it changed, so the sidebar and the panel aren't drawn again for nothing
  const key = useMemo(() => JSON.stringify(merged), [merged]);
  const [kept, setKept] = useState({ key, items: merged });
  // Adjusting state while rendering, React's pattern for keeping a value derived from props
  if (kept.key !== key) setKept({ key, items: merged });
  return kept.key === key ? kept.items : merged;
}
