import { describe, expect, it } from "vitest";
import { decodedText } from "./textDecoding";

const utf16 = (text: string, littleEndian: boolean, mark: boolean) => {
  const bytes = new Uint8Array((text.length + (mark ? 1 : 0)) * 2);
  const view = new DataView(bytes.buffer);
  const units = mark ? [0xfeff, ...[...text].map((c) => c.charCodeAt(0))] : [...text].map((c) => c.charCodeAt(0));
  units.forEach((unit, i) => view.setUint16(i * 2, unit, littleEndian));
  return bytes;
};

describe("decodedText", () => {
  it("reads UTF-8, with or without its mark", () => {
    const text = "Canción: «añoranza» 東京";
    expect(decodedText(new TextEncoder().encode(text))).toBe(text);
    expect(decodedText(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]))).toBe(text);
  });

  it("reads UTF-16 as Windows writes it, and without the mark", () => {
    const text = "Informe de ventas: año 2025, café";
    expect(decodedText(utf16(text, true, true))).toBe(text);
    expect(decodedText(utf16(text, false, true))).toBe(text);
    expect(decodedText(utf16(text, true, false))).toBe(text);
  });

  it("reads Windows-1252 instead of showing replacement marks", () => {
    // "Señor José, café" as an old Windows program saves it
    const bytes = new Uint8Array([0x53, 0x65, 0xf1, 0x6f, 0x72, 0x20, 0x4a, 0x6f, 0x73, 0xe9, 0x2c, 0x20, 0x63, 0x61, 0x66, 0xe9]);
    expect(decodedText(bytes)).toBe("Señor José, café");
  });

  it("says a binary file isn't text", () => {
    expect(decodedText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x1a, 0x0a]))).toBeNull();
  });
});
