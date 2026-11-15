import { describe, expect, it } from "vitest";
import { modelChangesOf } from "./modelChanges";

describe("modelChangesOf", () => {
  it("marks the question whose reply came from another model", () => {
    const messages = [
      { role: "user" as const },
      { role: "assistant" as const, model: "Qwen" },
      { role: "user" as const },
      { role: "assistant" as const, model: "Qwen" },
      { role: "user" as const },
      { role: "assistant" as const, model: "Claude Sonnet" },
    ];
    expect([...modelChangesOf(messages)]).toEqual([[4, "Claude Sonnet"]]);
  });

  it("says nothing for the first reply or replies without a model", () => {
    expect(modelChangesOf([{ role: "user" }, { role: "assistant", model: "Qwen" }, { role: "assistant" }]).size).toBe(0);
  });
});
