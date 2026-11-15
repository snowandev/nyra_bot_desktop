import { i18n } from "@/shared/i18n/i18n";

// A reply the user stopped ends where it is
export function throwIfStopped(signal: AbortSignal) {
  if (signal.aborted) throw stoppedError();
}

const stoppedError = () => new DOMException(i18n.t("reply.stopped"), "AbortError");

// For work that can't be cancelled itself (a call to Rust): the reply stops waiting for it at once
export function untilStopped<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(stoppedError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(stoppedError());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
