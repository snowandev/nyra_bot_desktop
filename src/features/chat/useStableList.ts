import { useState } from "react";

const sameItems = <T>(a: T[], b: T[]) => a.length === b.length && a.every((item, i) => item === b[i]);

// Returns the previous list while it holds the same items, so memos and memoized children don't redo their
// work just because a new (but identical) array was built, e.g. on every frame of a streaming reply
export function useStableList<T>(list: T[]): T[] {
  const [stable, setStable] = useState(list);
  const isSame = sameItems(stable, list);
  // Adjusting state while rendering, React's pattern for keeping a value derived from props
  if (!isSame) setStable(list);
  return isSame ? stable : list;
}
