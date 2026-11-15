import { describe, expect, it } from "vitest";
import { type Shortcut, SHORTCUTS } from "./shortcuts";

describe("SHORTCUTS", () => {
  it("never gives two actions the same keys", () => {
    const keys = Object.values(SHORTCUTS).map((s: Shortcut) => `${s.withShift ? "shift+" : ""}${s.key}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
