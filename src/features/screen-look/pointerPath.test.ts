import { describe, expect, it } from "vitest";
import { along, bendOf } from "./pointerPath";

describe("along", () => {
  it("starts where it was and ends on the place, upright", () => {
    expect(along([0, 0], [400, 300], 0).at).toEqual([0, 0]);
    const end = along([0, 0], [400, 300], 1);
    expect(end.at[0]).toBeCloseTo(400);
    expect(end.at[1]).toBeCloseTo(300);
    expect(end.lean).toBeCloseTo(0);
  });

  it("bows toward the top of the screen instead of going straight", () => {
    const [, y] = bendOf([0, 500], [600, 500]);
    expect(y).toBeLessThan(500);
    expect(along([0, 500], [600, 500], 0.5).at[1]).toBeLessThan(500);
    expect(bendOf([0, 500], [600, 500])[1]).toBeGreaterThanOrEqual(500 - 90);
  });

  it("leans the way it goes", () => {
    expect(along([0, 0], [500, 0], 0.5).lean).toBeGreaterThan(0);
    expect(along([500, 0], [0, 0], 0.5).lean).toBeLessThan(0);
    expect(along([0, 0], [0, 500], 0.5).lean).toBe(0);
  });
});
