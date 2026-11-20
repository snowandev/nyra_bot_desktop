import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { Message } from "@/shared/types";
import { claudeErrorMessage, toClaudeMessages, toModel } from "./anthropic";

const pdf = {
  id: "p",
  kind: "pdf" as const,
  name: "informe.pdf",
  mimeType: "application/pdf",
  data: "Texto del PDF",
  pages: ["PAGE1", "PAGE2"],
};
const image = { id: "i", kind: "image" as const, name: "foto.png", mimeType: "image/png", data: "IMG" };

describe("toClaudeMessages", () => {
  it("sends images first, then the text with the content of text files and PDFs", () => {
    const [message] = toClaudeMessages([{ role: "user", content: "Resume", attachments: [image, pdf] }]);
    expect(message.role).toBe("user");
    const content = message.content as Anthropic.Beta.BetaContentBlockParam[];
    expect(content.map((b) => b.type)).toEqual(["image", "image", "image", "text"]);
    expect(content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "IMG" } });
    expect(content[1]).toMatchObject({ source: { media_type: "image/jpeg", data: "PAGE1" } });
    expect(content[3]).toMatchObject({ type: "text" });
    expect((content[3] as Anthropic.Beta.BetaTextBlockParam).text).toContain('<file name="informe.pdf">');
  });

  it("leaves out empty messages, which the API rejects", () => {
    const messages: Message[] = [
      { role: "user", content: "Hola" },
      { role: "assistant", content: "   " },
      { role: "user", content: "" },
      { role: "user", content: "¿Sigues ahí?" },
    ];
    expect(toClaudeMessages(messages).map((m) => m.content)).toEqual([
      [{ type: "text", text: "Hola" }],
      [{ type: "text", text: "¿Sigues ahí?" }],
    ]);
  });

  it("drops image types Claude can't read", () => {
    const svg = { ...image, mimeType: "image/svg+xml" };
    const [message] = toClaudeMessages([{ role: "user", content: "Mira", attachments: [svg] }]);
    expect(message.content).toEqual([{ type: "text", text: "Mira" }]);
  });
});

describe("toModel", () => {
  it("keeps the context window, the reply limit and what the model list says it can do", () => {
    const info = {
      id: "claude-opus-5-5",
      display_name: "Claude Opus 5.5",
      max_input_tokens: 1_000_000,
      max_tokens: 128_000,
      capabilities: { image_input: { supported: true }, pdf_input: { supported: true }, thinking: { supported: true } },
    } as unknown as Anthropic.ModelInfo;
    expect(toModel(info)).toEqual({
      id: "claude-opus-5-5",
      name: "Claude Opus 5.5",
      description: "Claude · 1M de contexto",
      providerId: "anthropic",
      supportsImages: true,
      readsFiles: true,
      thinks: true,
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
    });
  });
});

describe("claudeErrorMessage", () => {
  const apiError = (status: number) => Anthropic.APIError.generate(status, { error: {} }, "detalle", new Headers());

  it("explains the common API errors in Spanish", () => {
    expect(claudeErrorMessage(apiError(429), Anthropic)).toContain("límite de uso");
    expect(claudeErrorMessage(apiError(529), Anthropic)).toContain("saturados");
    const offline = new Anthropic.APIConnectionError({ message: "offline" });
    expect(claudeErrorMessage(offline, Anthropic)).toContain("conexión a internet");
  });

  it("keeps the text of other errors", () => {
    expect(claudeErrorMessage(new Error("Algo concreto"), Anthropic)).toBe("Algo concreto");
  });
});
