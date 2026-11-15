import { describe, expect, it } from "vitest";
import type { Attachment, Message } from "@/shared/types";
import { withoutUserMessage } from "./messageRemoval";

const file: Attachment = { id: "f1", kind: "text", name: "big.txt", mimeType: "text/plain", data: "x" };
const messages: Message[] = [
  { role: "user", content: "Hola" },
  { role: "assistant", content: "¡Hola!" },
  { role: "user", content: "Mira esto", attachments: [file] },
  { role: "assistant", content: "Es largo", otherVersions: [{ content: "Otra versión" }], versionIndex: 1 },
  { role: "user", content: "¿Y el archivo?", references: ["f1", "f0"] },
  { role: "assistant", content: "Sí" },
];

describe("withoutUserMessage", () => {
  it("removes the message and its reply, with every version, and keeps the rest", () => {
    const result = withoutUserMessage(messages, undefined, 2);
    expect(result?.messages.map((m) => m.content)).toEqual(["Hola", "¡Hola!", "¿Y el archivo?", "Sí"]);
    expect(result?.wasUnanswered).toBe(false);
  });

  it("drops later references to its files", () => {
    expect(withoutUserMessage(messages, undefined, 2)?.messages[2].references).toEqual(["f0"]);
    const onlyThat = [...messages.slice(0, 4), { role: "user" as const, content: "?", references: ["f1"] }];
    expect(withoutUserMessage(onlyThat, undefined, 2)?.messages[2]).toEqual({ role: "user", content: "?" });
  });

  it("removes only the message when it never got a reply", () => {
    const unanswered = [...messages, { role: "user" as const, content: "Un archivo enorme" }];
    const result = withoutUserMessage(unanswered, undefined, 6);
    expect(result?.messages).toHaveLength(6);
    expect(result?.wasUnanswered).toBe(true);
  });

  it("keeps a summary that starts before the message and drops one that covered it", () => {
    const summary = { text: "Resumen", fromIndex: 2 };
    expect(withoutUserMessage(messages, summary, 4)?.summary).toBe(summary);
    expect(withoutUserMessage(messages, summary, 0)?.summary).toBeUndefined();
  });

  it("refuses anything that isn't a user message", () => {
    expect(withoutUserMessage(messages, undefined, 1)).toBeNull();
    expect(withoutUserMessage(messages, undefined, 9)).toBeNull();
  });
});
