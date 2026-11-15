import { useCallback, useLayoutEffect, useRef } from "react";

// Same identity on every render but always calls the latest function, so memoized children don't re-render
export function useStableCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const ref = useRef(callback);
  useLayoutEffect(() => {
    ref.current = callback;
  });
  return useCallback((...args: Args) => ref.current(...args), []);
}
