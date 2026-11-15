import { type ComponentType, createElement, lazy } from "react";

// Code loaded the first time it's used can fail to arrive for a moment (the development server reloading, a busy
// disk). It is tried again a few times, and a failure is never kept: the next use loads again. WebKit and Chromium
// both fetch a module again after a failed import.

const ATTEMPTS = 3;
const WAIT_MS = 400;

export async function withRetries<T>(load: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await load();
    } catch (error) {
      if (attempt >= ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, WAIT_MS * attempt));
    }
  }
}

// Loaded once and kept; a failure is forgotten, so the next call tries again
export function loadOnce<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | null = null;
  return () =>
    (loading ??= withRetries(load).catch((error: unknown) => {
      loading = null;
      throw error;
    }));
}

// Components whose load failed, each with what gives it a new start
const failedLoads = new Set<() => void>();

// LoadErrorBoundary's "Retry": the failed components load again the next time they're shown
export function retryFailedLoads() {
  failedLoads.forEach((restart) => restart());
  failedLoads.clear();
}

// A component loaded the first time it's shown. React keeps a failed load for good, so a new one takes its place on
// "Retry"; not before, or the render that follows the failure would start loading again instead of showing it.
export function retryingLazy<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  const make = () =>
    lazy(() =>
      withRetries(load).then(
        (component) => ({ default: component }),
        (error: unknown) => {
          failedLoads.add(() => (current = make()));
          throw error;
        },
      ),
    );
  let current = make();
  return function OnDemand(props: P) {
    return createElement(current, props);
  };
}
