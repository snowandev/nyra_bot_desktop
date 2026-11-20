import { describe, expect, it } from "vitest";
import { recommendedFor } from "./ollamaCatalog";

const GIB = 1024 ** 3;

describe("recommendedFor", () => {
  const memories = [4, 8, 12, 16, 24, 32, 64, 128].map((gib) => gib * GIB);

  it("recommends a model that fits the computer's memory", () => {
    for (const memory of memories) expect(recommendedFor(memory).size).toBeLessThan(memory);
  });

  it("never recommends a smaller model for more memory, and a bigger one for much more", () => {
    const sizes = memories.map((memory) => recommendedFor(memory).size);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
    expect(sizes.at(-1)).toBeGreaterThan(sizes[0]);
  });

  it("falls back to the balanced one when the memory isn't known", () => {
    expect(recommendedFor(null).why).toBe("balanced");
  });
});
