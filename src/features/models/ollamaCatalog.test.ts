import { describe, expect, it } from "vitest";
import { recommendedFor } from "./ollamaCatalog";

const GIB = 1024 ** 3;

describe("recommendedFor", () => {
  it("recommends a model that fits the computer's memory", () => {
    expect(recommendedFor(8 * GIB).name).toBe("qwen3:4b");
    expect(recommendedFor(16 * GIB).name).toBe("qwen3:8b");
    expect(recommendedFor(32 * GIB).name).toBe("gemma3:12b");
  });

  it("falls back to the balanced one when the memory isn't known", () => {
    expect(recommendedFor(null).why).toBe("balanced");
  });
});
