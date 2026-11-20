import { describe, expect, it } from "vitest";
import { putById } from "./byId";

describe("putById", () => {
  it("replaces the item with the same id in its place, or adds it at the end", () => {
    const list = [
      { id: "a", n: 1 },
      { id: "b", n: 2 },
    ];
    expect(putById(list, { id: "a", n: 9 })).toEqual([
      { id: "a", n: 9 },
      { id: "b", n: 2 },
    ]);
    expect(putById(list, { id: "c", n: 3 }).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(list[0].n).toBe(1);
  });
});
