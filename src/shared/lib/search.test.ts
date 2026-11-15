import { describe, expect, it } from "vitest";
import type { Message } from "@/shared/types";
import { foldForSearch, messagesMatching, splitByMatches } from "./search";

describe("foldForSearch", () => {
  it("ignores case and accents", () => {
    expect(foldForSearch("Acción ÑANDÚ")).toBe("accion nandu");
  });

  // Highlighting relies on positions in the folded text matching the original
  it("keeps the text length, emoji included", () => {
    for (const text of ["Acción", "😀 Ünïcödé", "İstanbul"]) {
      expect(foldForSearch(text)).toHaveLength(text.length);
    }
  });
});

describe("messagesMatching", () => {
  const messages: Message[] = [
    { role: "user", content: "¿Qué es una función?" },
    { role: "assistant", content: "Una FUNCION es…" },
    { role: "user", content: "gracias" },
  ];

  it("finds every message containing the text, ignoring case and accents", () => {
    expect(messagesMatching(messages, "funcion")).toEqual([0, 1]);
  });

  it("finds nothing for an empty query", () => {
    expect(messagesMatching(messages, "   ")).toEqual([]);
  });
});

describe("splitByMatches", () => {
  it("marks every match ignoring case and accents, keeping the original text", () => {
    expect(splitByMatches("Configuración de la configuracion", "CONFIGURACION")).toEqual([
      { text: "Configuración", isMatch: true },
      { text: " de la ", isMatch: false },
      { text: "configuracion", isMatch: true },
    ]);
  });

  it("returns the text whole without a query or a match", () => {
    expect(splitByMatches("Hola", "  ")).toEqual([{ text: "Hola", isMatch: false }]);
    expect(splitByMatches("Hola", "adiós")).toEqual([{ text: "Hola", isMatch: false }]);
  });
});
