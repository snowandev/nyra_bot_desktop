import { describe, expect, it } from "vitest";
import type { Message } from "@/shared/types";
import { dateNote, withCurrentDate } from "./currentDate";

describe("the current date for the model", () => {
  const now = new Date(2026, 9, 9, 14, 32);

  it("says the day, the local time and the time zone", () => {
    const note = dateNote(now);
    expect(note).toContain("Today is Friday, October 9, 2026, 14:32 local time");
    expect(note).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("goes at the end of the latest user message, and nowhere else", () => {
    const messages: Message[] = [
      { role: "user", content: "Hola" },
      { role: "assistant", content: "¡Hola!" },
      { role: "user", content: "¿Qué día es hoy?" },
    ];
    // Which message and leaving the rest untouched is appendToLastUserMessage's, tested with it
    expect(withCurrentDate(messages, now)[2].content.startsWith("¿Qué día es hoy?\n\n<current-date>")).toBe(true);
  });
});
