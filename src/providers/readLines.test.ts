import { describe, expect, it } from "vitest";
import { readLines } from "./readLines";

const streamOf = (chunks: string[], onCancel?: () => void) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
    cancel: onCancel,
  });

describe("readLines", () => {
  it("joins a line split across chunks and keeps the last one without a line end", async () => {
    const lines: string[] = [];
    await readLines(streamOf(['{"a":', '1}\r\n{"b"', ":2}\n", '{"c":3}']), (line) => lines.push(line));
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it("cancels the reading when a line can't be handled", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("mala\n"));
      },
      cancel: () => {
        cancelled = true;
      },
    });
    await expect(
      readLines(body, () => {
        throw new Error("ilegible");
      }),
    ).rejects.toThrow("ilegible");
    expect(cancelled).toBe(true);
  });
});
