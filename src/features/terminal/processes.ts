import type { CommandRun, Message } from "@/shared/types";

export type ActiveProcess = { run: CommandRun; messageIndex: number };

// The commands and programs still running in a conversation, and the message each one belongs to
export function activeProcesses(messages: Message[]): ActiveProcess[] {
  return messages.flatMap((m, messageIndex) =>
    (m.commands ?? [])
      .filter((run) => run.state === "running" || run.state === "asking")
      .map((run) => ({ run, messageIndex })),
  );
}

// The last line it printed that says something, for a glance at how it goes
export function lastLineOf(output: string | undefined) {
  const lines = (output ?? "").split("\n").map((line) => line.trim());
  return lines.reverse().find(Boolean) ?? "";
}
