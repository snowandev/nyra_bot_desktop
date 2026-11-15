import { beforeEach, describe, expect, it, vi } from "vitest";
import { inspectWorkspaceFile } from "./workspaceStorage";
import type { Message, ProposedChange } from "@/shared/types";
import { fixChange, fixRequest } from "./workspaceChanges";

vi.mock("./workspaceStorage", () => ({ inspectWorkspaceFile: vi.fn() }));

const file = "const a = 1;\nconst b = 2;\n";
const change: ProposedChange = {
  id: "c1",
  root: "/r",
  path: "src/a.ts",
  kind: "edit",
  blocks: [{ search: "const b = 3;", replace: "const b = 4;" }],
  status: "noMatch",
  failedBlock: 0,
  baseModified: 1,
};
const edit = (search: string) =>
  `<nyra-edit path="src/a.ts">\n<<<<<<< SEARCH\n${search}\n=======\nconst b = 4;\n>>>>>>> REPLACE\n</nyra-edit>`;

describe("fixRequest", () => {
  it("never sends a secret of the file to the model", () => {
    const content = 'const host = "db.example";\nDB_PASSWORD=Tr0ub4dor-3xample-Pw\n';
    const change = { kind: "edit", root: "/p", path: ".env.example", blocks: [], status: "noMatch" } as unknown as Parameters<typeof fixRequest>[0];
    const request = fixRequest(change, content);
    expect(request.content).toContain("DB_PASSWORD=");
    expect(request.content).not.toContain("Tr0ub4dor-3xample-Pw");
  });
});

describe("fixChange", () => {
  beforeEach(() => {
    vi.mocked(inspectWorkspaceFile).mockResolvedValue({ kind: "file", content: file, modified: 7, crlf: false, encoding: "utf8" });
  });

  it("keeps the redone change when it fits the file, to be reviewed again", async () => {
    const ask = vi.fn(async (_request: Message) => `Aquí está:\n${edit("const b = 2;")}`);
    const fixed = await fixChange(change, 32_768, ask);
    expect(fixed).toMatchObject({ status: "pending", reviewed: false, corrected: true, baseModified: 7 });
    expect(fixed.blocks).toEqual([{ search: "const b = 2;", replace: "const b = 4;" }]);
    expect(fixed.failedBlock).toBeUndefined();
    // The model gets the file as it is now and its change
    const request = ask.mock.calls[0]?.[0].content;
    expect(request).toContain("const b = 2;");
    expect(request).toContain("const b = 3;");
  });

  it("explains it when the model misses again, and leaves the change as it was", async () => {
    await expect(fixChange(change, 32_768, async () => edit("const b = 9;"))).rejects.toThrow("tampoco acertó");
    await expect(fixChange(change, 32_768, async () => "No sé.")).rejects.toThrow("tampoco acertó");
  });

  it("doesn't ask when the file is too large for the model", async () => {
    const ask = vi.fn(async () => "");
    await expect(fixChange(change, 20, ask)).rejects.toThrow("demasiado grande");
    expect(ask).not.toHaveBeenCalled();
  });

  it("says so when the file is gone", async () => {
    vi.mocked(inspectWorkspaceFile).mockResolvedValue({ kind: "missing" });
    await expect(fixChange(change, 32_768, async () => "")).rejects.toThrow("ya no está");
  });
});
