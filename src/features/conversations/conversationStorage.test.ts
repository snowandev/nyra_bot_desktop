import { describe, expect, it } from "vitest";
import type { Conversation } from "@/shared/types";
import { mergeWithStored, toOutgoingData } from "./conversationStorage";

describe("mergeWithStored", () => {
  const conversation = (id: string, messages = 1): Conversation => ({
    id,
    title: id,
    messages: Array.from({ length: messages }, () => ({ role: "user", content: "hola" })),
  });

  it("keeps unsaved conversations first and stored ones in their saved order", () => {
    const current = [conversation("new"), conversation("b")];
    const stored = [
      { id: "a", title: "A", updatedAt: 2, pinned: false, folderId: null, projectId: null },
      { id: "b", title: "B", updatedAt: 1, pinned: false, folderId: null, projectId: null },
    ];
    expect(mergeWithStored(current, stored).map((c) => c.id)).toEqual(["new", "a", "b"]);
  });

  it("keeps loaded messages unless the conversation was rewritten on disk", () => {
    const loaded = conversation("a", 3);
    const stored = [{ id: "a", title: "A", updatedAt: 1, pinned: false, folderId: null, projectId: null }];
    expect(mergeWithStored([loaded], stored)[0]).toBe(loaded);
    expect(mergeWithStored([loaded], stored, new Set(["a"]))[0].messages).toEqual([]);
  });

  it("reads which conversations are pinned and their folder from disk", () => {
    const stored = [{ id: "a", title: "A", updatedAt: 1, pinned: true, folderId: "f", projectId: "p" }];
    expect(mergeWithStored([], stored)[0]).toMatchObject({ pinned: true, folderId: "f", projectId: "p" });
  });
});

describe("toOutgoingData", () => {
  const image = { id: "img", kind: "image" as const, name: "foto.png", mimeType: "image/png", data: "AAAA" };
  const conversation: Conversation = {
    id: "c",
    title: "t",
    messages: [
      { role: "user", content: "mira", attachments: [image, { ...image, id: "new" }] },
      { role: "assistant", content: "vale" },
    ],
  };

  it("keeps the project and the task's skill with the conversation", () => {
    const data = toOutgoingData({ ...conversation, projectId: "p", taskSkill: "debug" }, new Set());
    expect(data).toMatchObject({ projectId: "p", taskSkill: "debug" });
    expect(toOutgoingData(conversation, new Set())).not.toHaveProperty("taskSkill");
  });

  it("sends stored attachments as just their id and new ones in full, leaving the conversation in memory untouched", () => {
    const { messages } = toOutgoingData(conversation, new Set(["img"]));
    expect(messages[0].attachments).toEqual([{ id: "img" }, { ...image, id: "new" }]);
    expect(messages[1]).toBe(conversation.messages[1]);
    expect(conversation.messages[0].attachments?.[0]).toBe(image);
  });

  it("sends a stored command without its output, and a new one whole", () => {
    const run = (id: string) => ({
      ...{ id, command: "npm test", root: "/p", folder: "p", at: 0, n: 1 },
      ...{ state: "done" as const, output: "ok" },
    });
    const commands = [run("viejo"), run("nuevo")];
    const withRuns: Conversation = {
      ...conversation,
      messages: [conversation.messages[0], { role: "assistant", content: "vale", commands }],
    };
    const { messages } = toOutgoingData(withRuns, new Set(), new Set(["viejo"]));
    expect(messages[1].commands?.[0]).not.toHaveProperty("output");
    expect(messages[1].commands?.[1].output).toBe("ok");
    expect(withRuns.messages[1].commands?.[0].output).toBe("ok");
  });
});
