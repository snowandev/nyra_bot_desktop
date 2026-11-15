import { describe, expect, it } from "vitest";
import { insertDictation } from "./dictationText";

describe("insertDictation", () => {
  it("fills an empty box", () => {
    expect(insertDictation("", " Hola, Marta ", 0, 0)).toEqual({ text: "Hola, Marta", caret: 11 });
  });

  it("keeps words apart where the cursor is", () => {
    expect(insertDictation("Escribe un correo", "breve", 10, 10)).toEqual({
      text: "Escribe un breve correo",
      caret: 16,
    });
    expect(insertDictation("Resume esto: ", "the meeting notes", 13, 13).text).toBe("Resume esto: the meeting notes");
  });

  it("replaces what is selected", () => {
    expect(insertDictation("Traduce hola al japonés", "buenos días", 8, 12).text).toBe(
      "Traduce buenos días al japonés",
    );
  });

  it("adds no space next to scripts written without them", () => {
    expect(insertDictation("会議の", "要約を書いて", 3, 3).text).toBe("会議の要約を書いて");
    expect(insertDictation("Resume: ", "会議の要約", 8, 8).text).toBe("Resume: 会議の要約");
  });
});
