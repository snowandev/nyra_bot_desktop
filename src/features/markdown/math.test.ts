import { describe, expect, it } from "vitest";
import { normalizeMath } from "./math";

describe("normalizeMath", () => {
  it("reads every way of writing a formula as math", () => {
    expect(normalizeMath("La energía es $E = mc^2$.")).toBe("La energía es $$E = mc^2$$.");
    expect(normalizeMath("Energy is \\(E = mc^2\\).")).toBe("Energy is $$E = mc^2$$.");
    expect(normalizeMath("Soit \\[x^2 + 1\\] ici")).toBe("Soit $$x^2 + 1$$ ici");
    expect(normalizeMath("\\[\n\\int_0^1 x\\,dx\n\\]")).toBe("$$\n\\int_0^1 x\\,dx\n$$");
    expect(normalizeMath("Y $$a^2 + b^2 = c^2$$ también")).toBe("Y $$a^2 + b^2 = c^2$$ también");
  });

  it("draws a formula alone on its line as a block", () => {
    expect(normalizeMath("$$a^2 + b^2 = c^2$$")).toBe("$$\na^2 + b^2 = c^2\n$$");
    expect(normalizeMath("\\[ x^2 \\]")).toBe("$$\nx^2\n$$");
    expect(normalizeMath("- $$x$$")).toBe("- $$x$$");
  });

  it("leaves prices and escaped dollars as text", () => {
    expect(normalizeMath("Cuesta $5 y el otro $10.")).toBe("Cuesta $5 y el otro $10.");
    expect(normalizeMath("From $5-$10 a month")).toBe("From $5-$10 a month");
    expect(normalizeMath("Pagué \\$20 y \\$30")).toBe("Pagué \\$20 y \\$30");
    // Prices written inside a formula are part of it
    expect(normalizeMath("Total: $\\$3 + \\$2 = \\$5$.")).toBe("Total: $$\\$3 + \\$2 = \\$5$$.");
  });

  it("never touches code", () => {
    const block = "```bash\necho $HOME $PATH\n```";
    expect(normalizeMath(block)).toBe(block);
    expect(normalizeMath("Usa `$x$` en la plantilla y $y$ aquí")).toBe("Usa `$x$` en la plantilla y $$y$$ aquí");
  });
});
