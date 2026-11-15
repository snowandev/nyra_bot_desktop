import { describe, expect, it } from "vitest";
import type { Message } from "@/shared/types";
import { fitToContext } from "./contextFit";

// 300 characters ≈ 100 estimated tokens
const text = (n: number) => "x".repeat(n * 3);
const user = (tokens: number): Message => ({ role: "user", content: text(tokens) });
const reply = (tokens: number): Message => ({ role: "assistant", content: text(tokens) });

describe("fitToContext", () => {
  it("leaves a conversation that fits as it is", () => {
    expect(fitToContext([user(100), reply(100), user(100)], 8192, 500, false)).toEqual({ kind: "fits" });
  });

  it("does nothing when the model's context is unknown", () => {
    expect(fitToContext([user(100_000)], undefined, 0, false)).toEqual({ kind: "fits" });
  });

  it("keeps the latest exchanges that fit, starting at a user message, with a note for the model", () => {
    const history = [user(1000), reply(1000), user(1000), reply(1000), user(500)];
    // 4096 - 0 reserved - 1024 for the reply = 3072 available
    const fit = fitToContext(history, 4096, 0, false);
    expect(fit.kind).toBe("trimmed");
    if (fit.kind !== "trimmed") return;
    expect(fit.omitted).toBe(2);
    expect(fit.messages.slice(1)).toEqual(history.slice(2));
    expect(fit.messages[0].content).toContain("2 earlier messages");
  });

  it("keeps the summary while it fits and drops it only as a last resort", () => {
    const summary: Message = { role: "user", content: text(200) };
    const withSummary = fitToContext([summary, user(1500), reply(1500), user(500)], 4096, 0, true);
    expect(withSummary.kind).toBe("trimmed");
    expect(withSummary.kind === "trimmed" && withSummary.messages[0]).toBe(summary);

    const bigSummary: Message = { role: "user", content: text(2900) };
    const without = fitToContext([bigSummary, user(1000), reply(500), user(500)], 4096, 0, true);
    expect(without.kind).toBe("trimmed");
    expect(without.kind === "trimmed" && without.messages.includes(bigSummary)).toBe(false);
  });

  it("reports when not even the last message fits", () => {
    const fit = fitToContext([user(100), reply(100), user(5000)], 4096, 0, false);
    expect(fit).toMatchObject({ kind: "too-large", budget: 3072 });
    expect(fit.kind === "too-large" && fit.needed).toBe(5000);
  });

  it("leaves room for the rules and skills sent with every request", () => {
    const history = [user(1000), reply(1000), user(500)];
    expect(fitToContext(history, 4096, 0, false).kind).toBe("fits");
    expect(fitToContext(history, 4096, 1000, false).kind).toBe("trimmed");
  });
});
