import { describe, expect, it } from "vitest";
import type { Message } from "@/shared/types";
import { appendToLastUserMessage } from "./messageNotes";

describe("appendToLastUserMessage", () => {
  const history: Message[] = [
    { role: "user", content: "Hola" },
    { role: "assistant", content: "¿En qué te ayudo?" },
    { role: "user", content: "Resume esto" },
  ];

  it("adds the note after the latest user message, without touching the rest", () => {
    const result = appendToLastUserMessage(history, "<note>");
    expect(result.at(-1)?.content).toBe("Resume esto\n\n<note>");
    expect(result.slice(0, -1)).toEqual(history.slice(0, -1));
    expect(history.at(-1)?.content).toBe("Resume esto");
  });

  it("can build the note from that message, and adds nothing when it comes out empty", () => {
    expect(appendToLastUserMessage(history, (last) => `(${last.content.length})`).at(-1)?.content).toBe("Resume esto\n\n(11)");
    expect(appendToLastUserMessage(history, () => null)).toBe(history);
  });

  it("leaves the history alone when it doesn't end with a user message", () => {
    const ending = history.slice(0, 2);
    expect(appendToLastUserMessage(ending, "<note>")).toBe(ending);
    expect(appendToLastUserMessage([], "<note>")).toEqual([]);
  });
});
