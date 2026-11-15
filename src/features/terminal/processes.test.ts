import { describe, expect, it } from "vitest";
import type { CommandRun, Message } from "@/shared/types";
import { activeProcesses, lastLineOf } from "./processes";

const run = (n: number, state: CommandRun["state"], output = ""): CommandRun => ({
  id: `cmd-${n}`,
  command: `comando ${n}`,
  root: "/tmp/proyecto",
  folder: "proyecto",
  at: 0,
  n,
  state,
  output,
});

describe("activeProcesses", () => {
  it("lists what still runs or asks, with the message it belongs to, however far up it is", () => {
    const messages: Message[] = [
      { role: "user", content: "Levanta el servidor" },
      { role: "assistant", content: "Ya está.", commands: [run(1, "running"), run(2, "done")] },
      { role: "user", content: "Y los tests" },
      { role: "assistant", content: "Pregunta algo.", commands: [run(3, "asking"), run(4, "stopped")] },
    ];
    expect(activeProcesses(messages).map((p) => [p.run.id, p.messageIndex])).toEqual([
      ["cmd-1", 1],
      ["cmd-3", 3],
    ]);
  });
});

describe("lastLineOf", () => {
  it("takes the last line that says something", () => {
    expect(lastLineOf("Serving HTTP on port 8765\nGET /index.html 200\n\n")).toBe("GET /index.html 200");
    expect(lastLineOf(undefined)).toBe("");
  });
});
