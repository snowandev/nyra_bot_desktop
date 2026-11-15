import { describe, expect, it } from "vitest";
import type { Attachment, Message } from "@/shared/types";
import { codeInputsOf, safeFileName } from "./codeSetup";

describe("safeFileName", () => {
  it("gives every system a name it accepts, the same on all three", () => {
    expect(safeFileName("Tauri: Docs | Guía", true)).toBe("Tauri Docs Guía.txt");
    expect(safeFileName("A/B testing?", true)).toBe("A B testing.txt");
    expect(safeFileName("informe.", false)).toBe("informe");
    expect(safeFileName("con.csv", false)).toBe("_con.csv");
    expect(safeFileName("   ", false)).toBe("file");
  });

  it("keeps names that are already fine, and the extension of a text that has one", () => {
    expect(safeFileName("ventas 2026.csv", true)).toBe("ventas 2026.csv");
    expect(safeFileName("foto.png", false)).toBe("foto.png");
  });
});

describe("codeInputsOf", () => {
  const text = (name: string, data: string): Attachment => ({ id: name, kind: "text", name, mimeType: "text/plain", data });
  const message = (...attachments: Attachment[]): Message => ({ role: "user", content: "", attachments });

  it("gives the newest of two files with the same name, and the text as it is", () => {
    const inputs = codeInputsOf([message(text("notas.txt", "vieja")), message(text("notas.txt", "nueva"))]);
    expect(inputs).toEqual([{ name: "notas.txt", data: btoa("nueva") }]);
  });

  it("leaves out an old PDF kept without its original", () => {
    const pdf: Attachment = { id: "p", kind: "pdf", name: "acta.pdf", mimeType: "application/pdf", data: "texto" };
    expect(codeInputsOf([message(pdf)])).toEqual([]);
  });
});
