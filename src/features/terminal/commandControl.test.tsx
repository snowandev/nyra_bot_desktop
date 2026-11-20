// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { answerInstead, approveCommand, rejectCommand, useAwaitingCommand, waitForDecision } from "./commandControl";

vi.mock("./terminalStorage", () => ({ stopCommand: vi.fn(), writeCommandInput: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// What the composer reads: whether what the user writes answers a waiting command
function renderAwaiting(conversationId: string) {
  const seen: boolean[] = [];
  function Probe() {
    seen.push(useAwaitingCommand(conversationId));
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  return { now: () => seen.at(-1), unmount: () => act(() => root.unmount()) };
}

describe("a command waiting for the user", () => {
  it.each([
    ["run", (id: string) => approveCommand(id, "npm test", false)],
    ["rejected", (id: string) => rejectCommand(id)],
  ])("lets the composer send messages again once it's %s", async (_, decide) => {
    const composer = renderAwaiting("c1");
    let decided!: Promise<unknown>;
    act(() => {
      decided = waitForDecision("cmd-1", "c1", new AbortController().signal);
    });
    expect(composer.now()).toBe(true);
    await act(async () => {
      decide("cmd-1");
      await decided;
    });
    expect(composer.now()).toBe(false);
    expect(answerInstead("c1", "Hola")).toBe(false);
    composer.unmount();
  });

  it("takes what the user writes as the answer while it waits", async () => {
    const decided = waitForDecision("cmd-2", "c2", new AbortController().signal);
    expect(answerInstead("c2", "Mejor no lo ejecutes")).toBe(true);
    await expect(decided).resolves.toEqual({ run: false, answer: "Mejor no lo ejecutes" });
  });
});
