import { describe, expect, it } from "vitest";
import { toolChoicePrompt } from "./toolChoice";

describe("the tool choice instructions", () => {
  it("only come when there are tools to choose between", () => {
    expect(toolChoicePrompt({ search: true, browser: false, screen: false })).toBeNull();
    expect(toolChoicePrompt({ search: false, browser: false, screen: false })).toBeNull();
    expect(toolChoicePrompt({ search: true, browser: true, screen: false })).toContain("<tool-choice>");
  });

  it("send a named browser or site to Nyra's browser, without searching first", () => {
    const prompt = toolChoicePrompt({ search: true, browser: true, screen: true }) ?? "";
    expect(prompt).toContain("asking for Chrome");
    expect(prompt).toContain("Don't search the web first");
    expect(prompt).toContain("the tab I have open");
  });

  it("only speak of the tools the reply has", () => {
    const prompt = toolChoicePrompt({ search: true, browser: false, screen: true }) ?? "";
    expect(prompt).not.toContain("your web browser");
    expect(prompt).toContain("their screen");
  });
});
