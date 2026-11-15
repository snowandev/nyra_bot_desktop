import { useEffect, useState } from "react";
import { errorMessage } from "@/shared/lib/errors";
import { useWindowFocusRefresh } from "@/shared/hooks/useWindowFocusRefresh";
import { type GitChange, projectGitChanges } from "./projectStorage";

// What changed in the project's repository since the last commit. Read when shown, when the user comes back to the
// window, when Nyra applies or undoes a change (applied changes as a number) and when asked, since files change
// outside Nyra too.
export function useGitChanges(root: string, enabled: boolean, applied: number) {
  const [changes, setChanges] = useState<GitChange[] | null>(null);
  // All the changed files, also those past the list
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Asking again is a new read
  const [reads, setReads] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const read = () =>
      projectGitChanges(root)
        .then((found) => {
          if (cancelled) return;
          setChanges(found.files);
          setTotal(found.total);
          setError(null);
        })
        .catch((e) => {
          if (!cancelled) setError(errorMessage(e));
        });
    void read();
    return () => {
      cancelled = true;
    };
  }, [enabled, root, reads, applied]);
  useWindowFocusRefresh(() => setReads((n) => n + 1), enabled);

  return { changes, total, error, refresh: () => setReads((n) => n + 1) };
}
