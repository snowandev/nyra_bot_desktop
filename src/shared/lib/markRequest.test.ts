import { describe, expect, it } from "vitest";
import { markParts } from "./markRequest";

describe("markParts", () => {
  it("reads what to mark, where an arrow starts and the note", () => {
    expect(markParts("clear", 50)).toEqual({ clear: true });
    expect(markParts("Guardar | pulsa aquí", 50)).toEqual({ targets: ["Guardar "], note: "pulsa aquí" });
    expect(markParts("3 → \"Pagar\" | luego\n aquí", 50)).toEqual({ targets: ["3 ", " \"Pagar\" "], note: "luego aquí" });
    expect(markParts("x | una nota larga", 4)).toEqual({ targets: ["x "], note: "una " });
  });
});
