import { useCallback, useEffect, useRef, useState } from "react";

// How long "Copiado", "Guardado"… stay before the control goes back to rest
const SHOW_RESULT_MS = 2000;

// A state that goes back to `rest` on its own: `flash` shows a result for a moment, `set` keeps a value
export function useTransientState<T>(rest: T) {
  const [state, setState] = useState<T>(rest);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const set = useCallback((value: T) => {
    window.clearTimeout(timer.current);
    setState(value);
  }, []);

  const flash = useCallback(
    (value: T) => {
      window.clearTimeout(timer.current);
      setState(value);
      timer.current = window.setTimeout(() => setState(rest), SHOW_RESULT_MS);
    },
    [rest],
  );

  return [state, set, flash] as const;
}
