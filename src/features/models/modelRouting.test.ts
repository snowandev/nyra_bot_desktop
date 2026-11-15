import { describe, expect, it } from "vitest";
import type { Message, Model } from "@/shared/types";
import { backgroundModel, routeReply } from "./modelRouting";

const model = (id: string, providerId: string, extra: Partial<Model> = {}): Model => ({
  id,
  name: id,
  description: "",
  providerId,
  ...extra,
});
const small = model("qwen3:4b", "ollama", { contextWindow: 8_000, supportsImages: false });
const gemini = model("gemini-2.5-pro", "gemini", { contextWindow: 1_000_000, supportsImages: true });
const bigLocal = model("qwen3:32b", "ollama", { contextWindow: 32_000, supportsImages: true });
const isCloud = (m: Model) => m.providerId === "gemini" || m.providerId === "anthropic";
const text: Message = { role: "user", content: "Hola" };
const photo: Message = {
  role: "user",
  content: "¿Qué hay?",
  attachments: [{ id: "f", kind: "image", name: "foto.png", mimeType: "image/png", data: "AAAA" }],
};

const route = (over: Partial<Parameters<typeof routeReply>[0]> = {}) =>
  routeReply({
    main: small,
    demanding: gemini,
    conversation: null,
    message: text,
    tokens: 500,
    askBeforeCloud: true,
    isCloud,
    ...over,
  });

describe("routeReply", () => {
  it("answers with the main model when nothing calls for the other", () => {
    expect(route()).toEqual({ model: small, reason: "main", needsConsent: false });
  });

  it("moves for images the main model can't see, a conversation too long for it, or a folder", () => {
    expect(route({ message: photo })).toMatchObject({ model: gemini, reason: "images" });
    expect(route({ tokens: 20_000 })).toMatchObject({ model: gemini, reason: "context" });
    expect(route({ conversation: { workspace: { path: "/p", name: "p" } } })).toMatchObject({ reason: "folder" });
    expect(route({ asked: true })).toMatchObject({ model: gemini, reason: "asked" });
  });

  it("asks before sending the conversation to a cloud, unless told not to or both models are there", () => {
    expect(route({ message: photo }).needsConsent).toBe(true);
    expect(route({ message: photo, askBeforeCloud: false }).needsConsent).toBe(false);
    expect(route({ message: photo, demanding: bigLocal }).needsConsent).toBe(false);
    const flash = model("gemini-2.5-flash", "gemini", { contextWindow: 1_000_000, supportsImages: false });
    expect(route({ main: flash, message: photo }).needsConsent).toBe(false);
  });

  it("stays where the user left it: moved for good, or kept on the main model", () => {
    expect(route({ conversation: { modelChoice: "demanding" } })).toMatchObject({ model: gemini, reason: "continues" });
    expect(route({ conversation: { modelChoice: "main" }, message: photo })).toMatchObject({ model: small });
  });

  it("never sends a private conversation to a cloud on its own", () => {
    expect(route({ conversation: { isPrivate: true }, message: photo })).toMatchObject({ model: small });
    expect(route({ conversation: { isPrivate: true }, message: photo, demanding: bigLocal })).toMatchObject({
      model: bigLocal,
    });
  });
});

describe("backgroundModel", () => {
  it("uses the main model unless that would send a local conversation to a cloud", () => {
    expect(backgroundModel(small, gemini, isCloud)).toBe(small);
    expect(backgroundModel(gemini, small, isCloud)).toBe(small);
    expect(backgroundModel(gemini, model("gemini-2.5-flash", "gemini"), isCloud)).toBe(gemini);
    expect(backgroundModel(undefined, small, isCloud)).toBe(small);
  });
});
