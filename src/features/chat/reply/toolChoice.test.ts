import { describe, expect, it } from "vitest";
import { toolChoicePrompt } from "./toolChoice";

describe("the tool choice instructions", () => {
  it("only come when there are tools to choose between", () => {
    expect(toolChoicePrompt({ search: true, browser: false, screen: false })).toBeNull();
    expect(toolChoicePrompt({ search: false, browser: false, screen: false })).toBeNull();
    expect(toolChoicePrompt({ search: true, browser: true, screen: false })).toContain("<tool-choice>");
  });

  it("speak of each tool the reply has", () => {
    const prompt = toolChoicePrompt({ search: true, browser: true, screen: true }) ?? "";
    expect(prompt).toContain("your web browser");
    expect(prompt).toContain("answer from what you know");
    expect(prompt).toContain("their screen");
  });

  it("only speak of the tools the reply has", () => {
    const prompt = toolChoicePrompt({ search: true, browser: false, screen: true }) ?? "";
    expect(prompt).not.toContain("your web browser");
    expect(prompt).toContain("their screen");
    expect(toolChoicePrompt({ search: false, browser: true, screen: true })).not.toContain("answer from what you know");
  });
});
