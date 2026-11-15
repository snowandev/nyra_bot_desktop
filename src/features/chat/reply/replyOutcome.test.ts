import { describe, expect, it } from "vitest";
import type { Message } from "@/shared/types";
import { applyReplyOutcome } from "./replyOutcome";

function outcome(answer: string, options: { withFolder?: boolean; save?: (facts: string[]) => Promise<never[]> } = {}) {
  let reply: Message = { role: "assistant", content: answer };
  const errors: string[] = [];
  const saved: string[][] = [];
  const done = applyReplyOutcome({
    answer,
    history: [],
    folder: options.withFolder ? { root: "/tmp/proyecto", modifiedOf: new Map() } : null,
    memory: {
      texts: [],
      save: (facts) => {
        saved.push(facts);
        return options.save ? options.save(facts) : Promise.resolve([]);
      },
    },
    conversationId: "c1",
    setReply: (change) => (reply = change(reply)),
    onError: (message) => errors.push(message),
  });
  return { done, reply: () => reply, errors, saved };
}

describe("applyReplyOutcome", () => {
  it("proposes the commit only with a folder, and gives the text without its tag", async () => {
    const answer = "Listo.\n<nyra-commit>Add login form</nyra-commit>";
    const inFolder = outcome(answer, { withFolder: true });
    expect(await inFolder.done).toBe("Listo.");
    expect(inFolder.reply().commitProposal).toEqual({ message: "Add login form", status: "pending" });
    const alone = outcome(answer);
    await alone.done;
    expect(alone.reply().commitProposal).toBeUndefined();
  });

  it("keeps what the reply asked to remember, and says so when it couldn't", async () => {
    const answer = "Apuntado.<nyra-remember>Le gusta el té verde</nyra-remember>";
    const ok = outcome(answer);
    await ok.done;
    expect(ok.saved).toEqual([["Le gusta el té verde"]]);
    const failing = outcome(answer, { save: () => Promise.reject(new Error("disco lleno")) });
    await failing.done;
    expect(failing.errors[0]).toContain("disco lleno");
  });
});
