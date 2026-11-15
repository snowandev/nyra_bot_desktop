// Between what the user answers (a card, a strip) and the reply waiting on it: the reply asks and awaits, the
// interface answers. Out of React state, since the reply awaits a promise and the interface only settles it; what
// shows whether a question is still open subscribes, so it changes as soon as the reply stops.
export function decisionStore<T>() {
  const waiting = new Map<string, (decision: T) => void>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  return {
    // Settles with the user's decision, or with `fallback` if the reply stops first
    wait(id: string, signal: AbortSignal, fallback: T): Promise<T> {
      if (signal.aborted) return Promise.resolve(fallback);
      return new Promise<T>((resolve) => {
        const settle = (decision: T) => {
          waiting.delete(id);
          signal.removeEventListener("abort", onAbort);
          notify();
          resolve(decision);
        };
        const onAbort = () => settle(fallback);
        waiting.set(id, settle);
        signal.addEventListener("abort", onAbort);
        notify();
      });
    },
    isWaiting: (id: string) => waiting.has(id),
    decide: (id: string, decision: T) => waiting.get(id)?.(decision),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
