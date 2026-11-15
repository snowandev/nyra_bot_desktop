import { beforeEach, describe, expect, it, vi } from "vitest";
import { readWorkspaceFile } from "./workspaceStorage";
import { readPdf } from "@/features/attachments/pdf";
import { readWorkspaceText } from "./workspaceFiles";

vi.mock("./workspaceStorage", () => ({ readWorkspaceFile: vi.fn() }));
vi.mock("@/features/attachments/pdf", () => ({ base64ToBytes: () => new Uint8Array(), readPdf: vi.fn() }));

const pdf = (modified: number) => ({ kind: "pdf" as const, data: "", size: 100, modified });

describe("readWorkspaceText", () => {
  beforeEach(() => {
    vi.mocked(readPdf).mockReset();
    vi.mocked(readPdf).mockResolvedValue({ text: "Hola", pageTexts: ["Hola"], pageCount: 1, visuals: [] });
  });

  it("reads a PDF again when it changed, even keeping its size", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue(pdf(1));
    await readWorkspaceText("/r", "informe.pdf");
    await readWorkspaceText("/r", "informe.pdf");
    expect(readPdf).toHaveBeenCalledTimes(1);

    vi.mocked(readWorkspaceFile).mockResolvedValue(pdf(2));
    await readWorkspaceText("/r", "informe.pdf");
    expect(readPdf).toHaveBeenCalledTimes(2);
  });

  it("tells Rust the version it kept and reads it from there when unchanged", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue(pdf(5));
    await readWorkspaceText("/r", "otro.pdf");
    vi.mocked(readWorkspaceFile).mockResolvedValue({ kind: "pdfUnchanged" });
    const again = await readWorkspaceText("/r", "otro.pdf", 1, 1);
    expect(vi.mocked(readWorkspaceFile).mock.lastCall?.[4]).toEqual({ size: 100, modified: 5 });
    expect(readPdf).toHaveBeenCalledTimes(1);
    expect(again).toMatchObject({ kind: "read", content: "[Page 1]", size: 100 });
  });
});
