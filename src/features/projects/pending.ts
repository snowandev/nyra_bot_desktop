import type { Conversation } from "@/shared/types";
import type { PendingItem } from "./projectStorage";

// Worked out once per conversation: while a reply is written only that conversation changes, so the others aren't
// gone through again on every word
const pendingByConversation = new WeakMap<Conversation, PendingItem[]>();
const appliedByConversation = new WeakMap<Conversation, string[]>();

function cached<T>(cache: WeakMap<Conversation, T>, conversation: Conversation, work: () => T) {
  const known = cache.get(conversation);
  if (known) return known;
  const found = work();
  cache.set(conversation, found);
  return found;
}

// What waits for the user in one conversation of a project: changes not reviewed yet and commands waiting for
// permission to run
export function pendingIn(conversation: Conversation, projectId: string): PendingItem[] {
  return cached(pendingByConversation, conversation, () => pendingOf(conversation, projectId));
}

function pendingOf(conversation: Conversation, projectId: string): PendingItem[] {
  return conversation.messages.flatMap((message, messageIndex) => [
    ...(message.workspaceChanges ?? [])
      .filter((c) => c.status === "pending")
      .map((c) => ({
        projectId,
        conversationId: conversation.id,
        messageIndex,
        kind: "change" as const,
        id: c.id,
        label: c.path,
        isNew: c.kind === "create",
      })),
    ...(message.commitProposal?.status === "pending"
      ? [
          {
            projectId,
            conversationId: conversation.id,
            messageIndex,
            kind: "commit" as const,
            id: `commit-${messageIndex}`,
            label: message.commitProposal.message,
            isNew: false,
          },
        ]
      : []),
    ...(message.commands ?? [])
      .filter((r) => r.state === "pending")
      .map((r) => ({
        projectId,
        conversationId: conversation.id,
        messageIndex,
        kind: "command" as const,
        id: r.id,
        label: r.command,
        isNew: false,
      })),
  ]);
}

// What was read from disk, with the conversations open in Nyra in its place (they are newer) and without the ones
// deleted since
export function mergePending(stored: PendingItem[], conversations: Conversation[]): PendingItem[] {
  const inProjects = conversations.filter((c) => c.projectId);
  const known = new Set(inProjects.map((c) => c.id));
  const loaded = inProjects.filter((c) => c.messages.length > 0);
  const loadedIds = new Set(loaded.map((c) => c.id));
  return [
    ...stored.filter((item) => known.has(item.conversationId) && !loadedIds.has(item.conversationId)),
    ...loaded.flatMap((c) => pendingIn(c, c.projectId ?? "")),
  ];
}

// Each conversation's items together, the open one first and the rest as the list comes (newest first)
export function groupByConversation(items: PendingItem[], conversations: Conversation[], openId: string | null) {
  const order = new Map(conversations.map((c, i) => [c.id, i]));
  const groups = new Map<string, PendingItem[]>();
  for (const item of items) groups.set(item.conversationId, [...(groups.get(item.conversationId) ?? []), item]);
  const position = (id: string) => (id === openId ? -1 : (order.get(id) ?? Infinity));
  return [...groups]
    .sort(([a], [b]) => position(a) - position(b))
    .map(([conversationId, grouped]) => ({ conversationId, items: grouped }));
}

// Files the project's conversations changed with Nyra and that stay changed, for "por Nyra" in the Git tab. Only
// the conversations open in Nyra know it; the others count once opened.
export function appliedPaths(conversations: Conversation[]) {
  return new Set(
    conversations.flatMap((c) =>
      cached(appliedByConversation, c, () =>
        c.messages.flatMap((m) =>
          (m.workspaceChanges ?? [])
            .filter((x) => x.status === "applied" && !x.importedFrom)
            .map((x) => x.copiedTo ?? x.path),
        ),
      ),
    ),
  );
}
