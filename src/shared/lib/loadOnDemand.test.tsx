// @vitest-environment happy-dom
import { act, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { LoadErrorBoundary } from "@/shared/ui/LoadErrorBoundary";
import { loadOnce, retryingLazy, withRetries } from "./loadOnDemand";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Fails the first times it's called, then gives what it loads
function flaky<T>(failures: number, value: T) {
  let calls = 0;
  return vi.fn(async () => {
    calls++;
    if (calls <= failures) throw new Error("not there yet");
    return value;
  });
}

describe("withRetries", () => {
  it("tries again after a failure, and gives up after three tries", async () => {
    expect(await withRetries(flaky(2, "ok"))).toBe("ok");
    const never = flaky(5, "ok");
    await expect(withRetries(never)).rejects.toThrow("not there yet");
    expect(never).toHaveBeenCalledTimes(3);
  }, 10_000);
});

describe("loadOnce", () => {
  it("keeps what loaded, and forgets a failure so the next call loads again", async () => {
    const load = flaky(3, "ok");
    const once = loadOnce(load);
    await expect(once()).rejects.toThrow();
    expect(await once()).toBe("ok");
    expect(await once()).toBe("ok");
    expect(load).toHaveBeenCalledTimes(4);
  }, 10_000);
});

describe("a part that loads on demand", () => {
  it("shows a notice when it can't load, and loads on Retry", async () => {
    const Part = retryingLazy(flaky(3, () => <p>Cargado</p>));
    const onLeave = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    // React logs the error it caught; the notice is what matters here
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      root.render(
        <LoadErrorBoundary leave={{ label: "Volver al chat", onLeave }}>
          <Suspense fallback={null}>
            <Part />
          </Suspense>
        </LoadErrorBoundary>,
      );
    });
    // The two retries wait 0.4 s and 0.8 s before it gives up
    for (let step = 0; step < 30 && !container.textContent; step++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
    }
    expect(container.textContent).toContain("No se pudo cargar esta parte de Nyra.");
    const [leave, retry] = [...container.querySelectorAll("button")];
    leave.click();
    expect(onLeave).toHaveBeenCalled();
    await act(async () => {
      retry.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(container.textContent).toBe("Cargado");
    quiet.mockRestore();
    act(() => root.unmount());
    container.remove();
  }, 10_000);
});
