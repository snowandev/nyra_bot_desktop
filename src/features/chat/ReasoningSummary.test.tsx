// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Reasoning } from "@/shared/types";
import { ReasoningSummary } from "./ReasoningSummary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const label = (reasoning: Reasoning, isThinking: boolean) => {
  act(() => root.render(<ReasoningSummary reasoning={reasoning} isThinking={isThinking} />));
  return container.querySelector(".reply-summary span")?.textContent;
};

describe("the reasoning line", () => {
  it("counts on from what the reply thought before when it thinks again, after a command", () => {
    const reasoning = { text: "…", durationMs: 5000, thinkingSince: Date.now() - 3000 };
    expect(label(reasoning, true)).toBe("Pensando… 8 s");
  });

  it("never goes below what it thought before when it starts thinking again", () => {
    // Stopped for a while (a command ran), then a new stretch starts: the stale clock can't count backwards
    expect(label({ text: "…", durationMs: 9000, thinkingSince: Date.now() + 20_000 }, true)).toBe("Pensando… 9 s");
  });

  it("says how long it thought once it stops", () => {
    expect(label({ text: "…", durationMs: 8000 }, false)).toBe("Pensó durante 8 s");
  });
});
