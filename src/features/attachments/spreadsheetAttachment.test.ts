import { describe, expect, it, vi } from "vitest";

const readSpreadsheet = vi.fn();

// Tests run in Node, which has File but no FileReader: just what readAsBase64 uses
class NodeFileReader {
  result: string | null = null;
  error: Error | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(file: File) {
    void file.arrayBuffer().then((buffer) => {
      this.result = `data:${file.type};base64,${btoa(String.fromCharCode(...new Uint8Array(buffer)))}`;
      this.onload?.();
    });
  }
}
vi.stubGlobal("FileReader", NodeFileReader);
vi.mock("./spreadsheetStorage", () => ({ readSpreadsheet: (bytes: Uint8Array) => readSpreadsheet(bytes) }));

const { describeAttachment, readAttachment } = await import("./attachments");

const TABLE = 'Sheet "Gastos" (1 of 1), cells A1:B2\n| | A | B |\n| 1 | Concepto | Importe |\n| 2 | Luz | 40 |';

describe("attached spreadsheets", () => {
  it("are read as tables and keep the file to make a changed copy later", async () => {
    readSpreadsheet.mockResolvedValue(TABLE);
    const file = new File([new Uint8Array([80, 75, 3, 4])], "gastos.xlsx");
    const attachment = await readAttachment(file);
    expect(attachment).toMatchObject({ kind: "text", data: TABLE, workbook: "UEsDBA==" });
    expect(attachment.mimeType).toContain("spreadsheetml");
    expect(describeAttachment(attachment)).toBe("Excel · 4 B");
  });

  it("name the file when it can't be opened", async () => {
    readSpreadsheet.mockRejectedValue(new Error("No se pudo abrir la hoja de cálculo"));
    const file = new File([new Uint8Array([1, 2, 3])], "roto.xls");
    await expect(readAttachment(file)).rejects.toThrow("«roto.xls»");
  });
});
