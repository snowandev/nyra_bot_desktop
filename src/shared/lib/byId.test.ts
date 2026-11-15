import { describe, expect, it } from "vitest";
import { putById } from "./byId";
import { markParts } from "./markRequest";

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

describe("markParts", () => {
  it("reads what to mark, where an arrow starts and the note", () => {
    expect(markParts("clear", 50)).toEqual({ clear: true });
    expect(markParts("Guardar | pulsa aquí", 50)).toEqual({ targets: ["Guardar "], note: "pulsa aquí" });
    expect(markParts("3 → \"Pagar\" | luego\n aquí", 50)).toEqual({ targets: ["3 ", " \"Pagar\" "], note: "luego aquí" });
    expect(markParts("x | una nota larga", 4)).toEqual({ targets: ["x "], note: "una " });
  });
});
