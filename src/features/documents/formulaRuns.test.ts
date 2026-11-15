import { describe, expect, it } from "vitest";
import { formulaRuns } from "./formulaRuns";

const text = (latex: string) => formulaRuns(latex).map((run) => run.text).join("");

describe("formulaRuns", () => {
  it("writes variables in italics and operators with space around them", () => {
    expect(text("a \\neq 0")).toBe("a ≠ 0");
    expect(formulaRuns("a = 1")).toEqual([{ text: "a", italics: true }, { text: " = 1" }]);
  });

  it("raises and lowers what goes after ^ and _", () => {
    expect(formulaRuns("ax^2")).toEqual([{ text: "ax", italics: true }, { text: "2", sup: true }]);
    expect(formulaRuns("x_{1}")).toEqual([{ text: "x", italics: true }, { text: "1", sub: true }]);
    expect(text("ax^2 + bx + c = 0")).toBe("ax2 + bx + c = 0");
  });

  it("keeps a sign apart from a subtraction", () => {
    expect(text("\\Delta = (-5)^2 - 4(1)(6)")).toBe("Δ = (−5)2 − 4(1)(6)");
    expect(text("-b")).toBe("−b");
  });

  it("writes fractions and roots on one line", () => {
    expect(text("\\frac{5 + 1}{2}")).toBe("(5 + 1)/2");
    expect(text("\\frac{1}{2}")).toBe("1/2");
    expect(text("\\frac{5}{14}")).toBe("5/14");
    expect(text("\\frac{1}{2a}")).toBe("1/(2a)");
    expect(text("\\sqrt{b^2 - 4ac}")).toBe("√(b2 − 4ac)");
    expect(text("\\sqrt{2}")).toBe("√2");
  });

  it("knows Greek letters, named functions and words", () => {
    expect(formulaRuns("\\pi")).toEqual([{ text: "π", italics: true }]);
    expect(formulaRuns("\\Delta")).toEqual([{ text: "Δ" }]);
    expect(text("\\sin x + \\log y")).toBe("sin x + log y");
    expect(formulaRuns("\\text{si } x")[0]).toEqual({ text: "si ", isText: true });
  });

  it("drops sizing commands and keeps what an unknown one applies to", () => {
    expect(text("\\left( x \\right)")).toBe("(x)");
    expect(text("\\unknown{x}")).toBe("unknownx");
  });
});
