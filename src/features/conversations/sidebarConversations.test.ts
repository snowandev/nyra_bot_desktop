import { describe, expect, it } from "vitest";
import type { Conversation } from "@/shared/types";
import { keptRows } from "./sidebarConversations";

const conversation = (id: string, title: string, content = ""): Conversation =>
  ({ id, title, messages: content ? [{ role: "assistant", content }] : [] }) as unknown as Conversation;

describe("keptRows", () => {
  const list = [conversation("a", "Viaje a Lisboa"), conversation("b", "Receta de pan")];

  it("keeps the same list while a reply is written in one of its conversations", () => {
    const writing = [conversation("a", "Viaje a Lisboa", "Primero, el"), list[1]];
    expect(keptRows(list, writing)).toBe(list);
  });

  it("gives a new list when something the sidebar shows changes, keeping the other rows", () => {
    const renamed = [conversation("a", "Viaje a Oporto"), conversation("b", "Receta de pan", "Harina")];
    const next = keptRows(list, renamed);
    expect(next).not.toBe(list);
    expect(next[0].title).toBe("Viaje a Oporto");
    expect(next[1]).toBe(list[1]);
  });

  it("gives a new list when a conversation comes or goes", () => {
    expect(keptRows(list, [list[0]])).toEqual([list[0]]);
    expect(keptRows(list, [conversation("c", "Nueva"), ...list])).toHaveLength(3);
  });
});
