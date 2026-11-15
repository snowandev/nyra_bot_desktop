import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment, Message } from "@/shared/types";

// What Rust answers next: a new version, or an error as the plain object Rust sends
let answer: { version?: unknown; error?: unknown } = {};
const calls: unknown[][] = [];
vi.mock("./spreadsheetStorage", () => ({
  editAttachedWorkbook: async (...args: unknown[]) => {
    calls.push(args);
    if (answer.error) throw answer.error;
    return answer.version;
  },
  readSpreadsheet: vi.fn(),
}));

const { latestWorkbook, makeSheetVersions, restoredVersion, versionFileName } = await import("./sheetVersions");
const { withReferencedFiles } = await import("./attachments");

const original: Attachment = {
  id: "a1",
  kind: "text",
  name: "Gastos.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  data: 'Sheet "Gastos"',
  workbook: "BASE",
};
const second: Attachment = { ...original, id: "v2", data: "segunda", workbook: "SECOND", version: { lineage: "a1", number: 2 } };
const conversation: Message[] = [
  { role: "user", content: "Revisa esto", attachments: [original] },
  { role: "assistant", content: "Hecho", attachments: [second] },
];
const edits = [{ sheet: "Gastos", cell: "C3", value: "120" }];

describe("sheet versions", () => {
  beforeEach(() => {
    answer = {};
    calls.length = 0;
  });

  it("start from the latest version of the file, whatever the case of its name", async () => {
    expect(latestWorkbook(conversation, "gastos.XLSX")?.id).toBe("v2");
    answer = { version: { workbook: "THIRD", text: "tercera", before: [{ sheet: "Gastos", cell: "C3", value: "100" }] } };
    const made = await makeSheetVersions(conversation, [{ kind: "cells", path: "", file: "gastos.xlsx", blocks: [], cells: edits }]);
    expect(calls).toEqual([["SECOND", edits]]);
    expect(made.attachments[0]).toMatchObject({ name: "Gastos.xlsx", data: "tercera", workbook: "THIRD", version: { lineage: "a1", number: 3 } });
    expect(made.versions[0]).toMatchObject({ file: "Gastos.xlsx", number: 3, baseId: "v2", cellsBefore: [{ sheet: "Gastos", cell: "C3", value: "100" }] });
    expect(made.versions[0].id).toBe(made.attachments[0].id);
  });

  it("say why a version couldn't be made, and make no file", async () => {
    answer = { error: { kind: "sheetMissing", sheet: "Febrero" } };
    const made = await makeSheetVersions(conversation, [{ kind: "cells", path: "", file: "Gastos.xlsx", blocks: [], cells: edits }]);
    expect(made.attachments).toEqual([]);
    expect(made.versions[0].error).toBe("La hoja «Febrero» no existe en Gastos.xlsx.");
    const unknown = await makeSheetVersions(conversation, [{ kind: "cells", path: "", file: "otro.xlsx", blocks: [], cells: edits }]);
    expect(unknown.versions[0].error).toContain("otro.xlsx");
  });

  it("only send the model the latest version of each file", () => {
    const [user, reply] = withReferencedFiles(conversation);
    expect(user.attachments?.[0].data).toContain("earlier version");
    expect(user.attachments?.[0].workbook).toBeUndefined();
    expect(reply.attachments?.[0].data).toBe("segunda");
  });

  it("turn an .xls into an .xlsx version, which later changes follow even by the old name", async () => {
    const old: Attachment = { ...original, id: "x1", name: "Cuotas.xls", mimeType: "application/vnd.ms-excel", workbook: "XLS" };
    const messages: Message[] = [{ role: "user", content: "", attachments: [old] }];
    answer = { version: { workbook: "NEW", text: "t", before: [], converted: true } };
    const made = await makeSheetVersions(messages, [{ kind: "cells", path: "", file: "Cuotas.xls", blocks: [], cells: edits }]);
    expect(made.attachments[0]).toMatchObject({ name: "Cuotas.xlsx", mimeType: expect.stringContaining("spreadsheetml") });
    expect(made.versions[0].file).toBe("Cuotas.xlsx");
    const later = [...messages, { role: "assistant" as const, content: "", attachments: made.attachments }];
    expect(latestWorkbook(later, "Cuotas.xls")?.id).toBe(made.attachments[0].id);
  });

  it("follow from an earlier version with a copy of it that becomes the latest", () => {
    const restored = restoredVersion(conversation, "a1");
    expect(restored?.index).toBe(1);
    expect(restored?.attachment).toMatchObject({ workbook: "BASE", data: 'Sheet "Gastos"', version: { lineage: "a1", number: 3 } });
    expect(restored?.version).toMatchObject({ number: 3, baseId: "a1", cells: [], restoredFrom: 1 });
    const later = conversation.map((m, i) =>
      i === restored?.index ? { ...m, attachments: [...(m.attachments ?? []), restored.attachment] } : m,
    );
    expect(latestWorkbook(later, "Gastos.xlsx")?.id).toBe(restored?.attachment.id);
    expect(restoredVersion([{ role: "user", content: "", attachments: [original] }], "a1")).toBeNull();
  });

  it("name a saved version after its number", () => {
    expect(versionFileName("Gastos.xlsx", 1)).toBe("Gastos.xlsx");
    expect(versionFileName("Gastos.xlsx", 3)).toBe("Gastos (versión 3).xlsx");
  });
});
