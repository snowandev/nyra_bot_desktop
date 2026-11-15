import { describe, expect, it } from "vitest";
import type { Attachment, Message } from "@/shared/types";
import { contextParts, dominantPart, scaledParts } from "./contextBreakdown";
import type { Skill } from "@/features/skills/skills";

const skill = (name: string, body: string): Skill =>
  ({ name, description: `Descripción de ${name}`, body, files: [] }) as unknown as Skill;

const pdf: Attachment = { id: "p", kind: "pdf", name: "informe.pdf", mimeType: "application/pdf", data: "x".repeat(30_000) };

const base = { skills: [], allSkills: [], memories: [], rules: null, webSearch: false };

describe("contextParts", () => {
  it("counts each part the conversation has, and leaves out the ones it doesn't", () => {
    const messages: Message[] = [
      { role: "user", content: "Resume esto", attachments: [pdf] },
      { role: "assistant", content: "Resumen…", skillsUsed: ["summarize"] },
    ];
    const summarize = skill("summarize", "y".repeat(3000));
    const parts = contextParts({
      ...base,
      messages,
      skills: [summarize],
      allSkills: [summarize],
      memories: ["Es diseñadora"],
      webSearch: true,
      folder: { name: "portaln4", indexTokens: 1200 },
    });
    expect(parts.map((p) => p.kind)).toEqual(["conversation", "files", "folder", "skills", "memories", "instructions"]);
    const files = parts.find((p) => p.kind === "files");
    expect(files).toMatchObject({ biggest: "informe.pdf" });
    expect(files?.tokens).toBeGreaterThan(9000);
    expect(parts.find((p) => p.kind === "folder")).toMatchObject({ name: "portaln4" });
    // The list of skills plus the instructions the reply loaded
    expect(parts.find((p) => p.kind === "skills")?.tokens).toBeGreaterThan(1000);
  });

  it("is only the conversation and the date in a plain chat", () => {
    const parts = contextParts({ ...base, messages: [{ role: "user", content: "hola" }] });
    expect(parts.map((p) => p.kind)).toEqual(["conversation", "instructions"]);
  });
});

describe("scaledParts", () => {
  it("scales the estimate to the real total, adding up exactly", () => {
    const scaled = scaledParts(
      [
        { kind: "conversation", tokens: 3000 },
        { kind: "files", tokens: 1000 },
        { kind: "instructions", tokens: 333 },
      ],
      2000,
    );
    expect(scaled.reduce((sum, p) => sum + p.tokens, 0)).toBe(2000);
    expect(scaled[0].tokens).toBeGreaterThan(scaled[1].tokens);
  });
});

describe("dominantPart", () => {
  const parts = [
    { kind: "conversation" as const, tokens: 18_000 },
    { kind: "files" as const, tokens: 31_000 },
    { kind: "instructions" as const, tokens: 1000 },
  ];

  it("points at the largest part when the context is filling up", () => {
    expect(dominantPart(parts, 0.8)?.kind).toBe("files");
    expect(dominantPart(parts, 0.4)).toBeNull();
  });

  it("points at one part that takes almost everything, but not at the conversation of a plain chat", () => {
    expect(dominantPart([{ kind: "files", tokens: 9000 }, { kind: "conversation", tokens: 1000 }], 0.1)?.kind).toBe("files");
    expect(dominantPart([{ kind: "conversation", tokens: 9000 }, { kind: "instructions", tokens: 100 }], 0.1)).toBeNull();
  });
});
