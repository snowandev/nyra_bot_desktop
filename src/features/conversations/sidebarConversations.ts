import { useState } from "react";
import type { Conversation } from "@/shared/types";

// What the sidebars show of a conversation and where they place it; the rest (its messages, a reply being written)
// never changes a row
const sameRow = (a: Conversation, b: Conversation) =>
  a.title === b.title &&
  a.pinned === b.pinned &&
  a.folderId === b.folderId &&
  a.isPrivate === b.isPrivate &&
  a.projectId === b.projectId;

// The new list with each conversation as it was drawn while its row is the same; the very list drawn when nothing
// it shows changed
export function keptRows(kept: Conversation[], conversations: Conversation[]): Conversation[] {
  const before = new Map(kept.map((c) => [c.id, c]));
  const next = conversations.map((c) => {
    const old = before.get(c.id);
    return old && sameRow(old, c) ? old : c;
  });
  return next.length === kept.length && next.every((c, i) => c === kept[i]) ? kept : next;
}

// A reply being written replaces its conversation on every frame, and the list mustn't be drawn again for it
export function useSidebarConversations(conversations: Conversation[]): Conversation[] {
  const [kept, setKept] = useState(conversations);
  const next = keptRows(kept, conversations);
  // Adjusting state while rendering, React's pattern for keeping a value derived from props
  if (next !== kept) setKept(next);
  return next;
}
