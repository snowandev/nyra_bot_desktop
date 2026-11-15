import { describe, expect, it } from "vitest";
import { adaptationRequest, parseAdaptation, productMentions } from "./adaptation";
import { DESCRIPTION_MAX } from "./skills";

describe("parseAdaptation", () => {
  it("reads both blocks, ignoring reasoning and surrounding text", () => {
    const reply =
      "<think>planning</think>Aquí está:\n<description>\nRevisa código.\n</description>\n" +
      "<instructions>\n# Revisión\n\nPide al usuario que pegue el diff.\n</instructions>";
    expect(parseAdaptation(reply)).toEqual({
      description: "Revisa código.",
      body: "# Revisión\n\nPide al usuario que pegue el diff.",
    });
  });

  it("keeps instructions that quote either tag", () => {
    const reply =
      "<description>x</description><instructions>Cierra con </description> o </instructions> al final.</instructions>";
    expect(parseAdaptation(reply)).toEqual({
      description: "x",
      body: "Cierra con </description> o </instructions> al final.",
    });
  });

  it("rejects a reply cut before the end", () => {
    expect(() => parseAdaptation("<description>x</description><instructions># A medias")).toThrow(/se cortó/);
  });

  it("rejects empty parts and descriptions over the limit", () => {
    expect(() => parseAdaptation("<description></description><instructions>x</instructions>")).toThrow(/vacías/);
    const long = "a".repeat(DESCRIPTION_MAX + 1);
    expect(() => parseAdaptation(`<description>${long}</description><instructions>x</instructions>`)).toThrow(
      /supera/,
    );
  });
});

describe("productMentions", () => {
  it("finds assistant and company names left in the text", () => {
    const mentions = productMentions({ description: "Para ChatGPT", body: "Usa GPT-4o o Claude." });
    expect(mentions).toEqual(["Claude", "ChatGPT", "GPT"]);
  });

  it("finds nothing in a neutral skill", () => {
    expect(productMentions({ description: "Revisa código", body: "El asistente pide el diff." })).toEqual([]);
  });
});

describe("adaptationRequest", () => {
  it("sends the skill's description and instructions", () => {
    const [message] = adaptationRequest({ name: "review", description: "Revisa", body: "# Pasos\n" });
    expect(message.role).toBe("user");
    expect(message.content).toContain('<skill name="review">');
    expect(message.content).toContain("<instructions>\n# Pasos\n</instructions>");
  });
});
