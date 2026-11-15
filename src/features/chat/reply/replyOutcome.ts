import type { Message, SavedMemory } from "@/shared/types";
import { i18n } from "@/shared/i18n/i18n";
import { errorMessage } from "@/shared/lib/errors";
import { makeSheetVersions } from "@/features/attachments/sheetVersions";
import { takeMemories } from "@/features/memory/memories";
import { takeCommit } from "@/features/projects/commits";
import { takeChanges } from "@/features/workspace/fileChanges";
import { proposeChanges } from "@/features/workspace/workspaceChanges";
import { withoutRequestTags } from "./replyTags";

// The saved memories while memory is on, and how to keep the ones a reply asks to save
export type MemoryAccess = {
  texts: string[];
  save: (facts: string[], conversationId: string) => Promise<SavedMemory[]>;
};

type Outcome = {
  answer: string;
  history: Message[];
  // The connected folder, where changes and a commit can go
  folder: { root: string; modifiedOf: Map<string, number> } | null;
  // null in a private conversation, or with memory off
  memory: MemoryAccess | null;
  conversationId: string;
  setReply: (change: (reply: Message) => Message) => void;
  onError: (message: string) => void;
};

// What the finished reply asked for besides its text: memories to keep, changes to review, versions of attached
// spreadsheets, a commit. Each one that fails says so and leaves the reply as it is. Resolves with the answer's text.
export async function applyReplyOutcome(outcome: Outcome) {
  const { answer, history, folder, memory, conversationId, setReply, onError } = outcome;
  const remembered = takeMemories(withoutRequestTags(answer), memory?.texts ?? []);
  const { facts } = remembered;
  const { changes: parsed, text: withoutChanges } = takeChanges(remembered.text);
  const { message: commitMessage, text } = takeCommit(withoutChanges);
  // Only with a folder: a commit is made in it
  if (folder && commitMessage) {
    setReply((reply) => ({ ...reply, commitProposal: { message: commitMessage, status: "pending" } }));
  }
  const proposed = parsed.filter((c) => !c.file);
  const sheetChanges = parsed.filter((c) => c.file);
  // An attached spreadsheet changes into a new version kept with the reply; the user's file stays as it was
  if (sheetChanges.length > 0) {
    try {
      const made = await makeSheetVersions(history, sheetChanges);
      setReply((reply) => ({
        ...reply,
        attachments: [...(reply.attachments ?? []), ...made.attachments],
        sheetVersions: made.versions,
      }));
    } catch (e) {
      onError(i18n.t("reply.fileVersionFailed", { error: errorMessage(e) }));
    }
  }
  // Shown as cards to review; without a folder (or with one that failed) a proposal has nowhere to go
  if (folder && proposed.length > 0) {
    try {
      const changes = await proposeChanges(folder.root, proposed, folder.modifiedOf);
      setReply((reply) => ({ ...reply, workspaceChanges: changes }));
    } catch (e) {
      onError(i18n.t("reply.changesFailed", { error: errorMessage(e) }));
    }
  }
  if (memory && facts.length > 0) {
    // Kept with the reply so the chat shows what was saved; a failure doesn't take the reply away
    try {
      const saved = await memory.save(facts, conversationId);
      if (saved.length > 0) setReply((reply) => ({ ...reply, memoriesSaved: saved }));
    } catch (e) {
      onError(i18n.t("reply.memoryFailed", { error: errorMessage(e) }));
    }
  }
  return text;
}
