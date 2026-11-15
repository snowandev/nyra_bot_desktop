import { describe, expect, it } from "vitest";
import type { Conversation, ProposedChange } from "@/shared/types";
import { appliedPaths, groupByConversation, mergePending, pendingIn } from "./pending";
import type { PendingItem } from "./projectStorage";

const change = (id: string, path: string, status: ProposedChange["status"]): ProposedChange => ({
  id,
  root: "/p",
  path,
  kind: "edit",
  blocks: [],
  status,
});

const conversation = (id: string, changes: ProposedChange[] = []): Conversation => ({
  id,
  title: id,
  projectId: "p1",
  messages: changes.length
    ? [
        { role: "user", content: "hola" },
        {
          role: "assistant",
          content: "",
          workspaceChanges: changes,
          commands: [{ id: `${id}-run`, command: "npm test", root: "/p", folder: "p", at: 0, n: 1, state: "pending" }],
        },
      ]
    : [],
});

const stored = (conversationId: string, id: string): PendingItem => ({
  projectId: "p1",
  conversationId,
  messageIndex: 1,
  kind: "change",
  id,
  label: "a.ts",
  isNew: false,
});

describe("pending", () => {
  it("finds the changes to review and the commands waiting in a conversation", () => {
    const items = pendingIn(conversation("c1", [change("x", "a.ts", "pending"), change("y", "b.ts", "applied")]), "p1");
    expect(items.map((i) => [i.kind, i.label, i.messageIndex])).toEqual([
      ["change", "a.ts", 1],
      ["command", "npm test", 1],
    ]);
  });

  it("counts a commit proposed and not made yet", () => {
    const withCommit = conversation("c1");
    withCommit.messages = [
      { role: "user", content: "prepara el commit" },
      { role: "assistant", content: "", commitProposal: { message: "Add prices", status: "pending" } },
    ];
    expect(pendingIn(withCommit, "p1").map((i) => [i.kind, i.id, i.label])).toEqual([["commit", "commit-1", "Add prices"]]);
  });

  it("uses the copy in memory of an open conversation and forgets deleted ones", () => {
    const open = conversation("c1", [change("x", "a.ts", "applied")]);
    const closed = conversation("c2");
    const merged = mergePending([stored("c1", "x"), stored("c2", "z"), stored("gone", "w")], [open, closed]);
    expect(merged.map((i) => i.id)).toEqual(["z", "c1-run"]);
  });

  it("puts the open conversation first", () => {
    const items = [stored("c1", "x"), stored("c2", "y")];
    const groups = groupByConversation(items, [conversation("c1"), conversation("c2")], "c2");
    expect(groups.map((g) => g.conversationId)).toEqual(["c2", "c1"]);
  });

  it("knows which files Nyra changed", () => {
    const paths = appliedPaths([conversation("c1", [change("x", "a.ts", "applied"), change("y", "b.ts", "undone")])]);
    expect([...paths]).toEqual(["a.ts"]);
  });
});
