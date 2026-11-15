import { describe, expect, it } from "vitest";
import { cleanTitle, titleRequest } from "./conversationTitle";

describe("cleanTitle", () => {
  it("keeps a clean title as it is", () => {
    expect(cleanTitle("Instalar Python en macOS")).toBe("Instalar Python en macOS");
  });

  it("removes quotes, labels, markdown and the final period", () => {
    expect(cleanTitle('"Instalar Python en macOS."')).toBe("Instalar Python en macOS");
    expect(cleanTitle("Título: «Recetas con garbanzos»")).toBe("Recetas con garbanzos");
    expect(cleanTitle("**Errores de Rust**\n\nEspero que te sirva")).toBe("Errores de Rust");
  });

  it("ignores reasoning written inside the reply", () => {
    expect(cleanTitle("<think>The user asks about…</think>\nConfigurar Docker")).toBe("Configurar Docker");
  });

  it("cuts a title that is too long", () => {
    const title = cleanTitle("palabra ".repeat(20));
    expect(Array.from(title ?? "").length).toBeLessThanOrEqual(61);
    expect(title?.endsWith("…")).toBe(true);
  });

  it("gives null when nothing usable is left", () => {
    expect(cleanTitle('  ""  ')).toBeNull();
    expect(cleanTitle("")).toBeNull();
  });
});

describe("titleRequest", () => {
  it("sends only an excerpt of long messages", () => {
    const [request] = titleRequest("a".repeat(10_000), "respuesta");
    expect(request.content.length).toBeLessThan(3_000);
  });
});
