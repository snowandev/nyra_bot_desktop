import { describe, expect, it } from "vitest";
import { decisionStore } from "./decisions";

describe("decisionStore", () => {
  it("settles with the user's decision and tells whoever shows the question", async () => {
    const store = decisionStore<string>();
    let changes = 0;
    const stop = store.subscribe(() => changes++);
    const waiting = store.wait("a", new AbortController().signal, "no");
    expect(store.isWaiting("a")).toBe(true);
    store.decide("a", "sí");
    expect(await waiting).toBe("sí");
    expect(store.isWaiting("a")).toBe(false);
    expect(changes).toBe(2);
    stop();
  });

  it("settles with the fallback when the reply stops, also before asking", async () => {
    const store = decisionStore<string>();
    const controller = new AbortController();
    const waiting = store.wait("a", controller.signal, "no");
    controller.abort();
    expect(await waiting).toBe("no");
    expect(store.isWaiting("a")).toBe(false);
    expect(await store.wait("b", controller.signal, "no")).toBe("no");
    expect(store.isWaiting("b")).toBe(false);
  });

  it("ignores a decision nobody waits for", () => {
    const store = decisionStore<string>();
    expect(() => store.decide("nadie", "sí")).not.toThrow();
  });
});
