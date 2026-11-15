import { type Dispatch, type SetStateAction, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { attachmentsOf } from "@/features/attachments/attachments";
import { errorMessage } from "@/shared/lib/errors";
import {
  deleteAllStoredConversations,
  deleteStoredConversation,
  listConversations,
  loadConversationData,
  mergeWithStored,
  renameStoredConversation,
  saveConversation,
  setConversationFolder,
  setConversationPinned,
} from "./conversationStorage";
import { releaseUnusedWorkspaces } from "@/features/workspace/workspaceStorage";
import type { Conversation } from "@/shared/types";

type Saved = Pick<Conversation, "messages" | "summary" | "skills" | "workspace" | "taskSkill" | "modelChoice">;

// A save that failed (disk full, database locked) is tried again after this long
const SAVE_RETRY_MS = 5000;
// A conversation receiving a reply changes on every frame: it is saved at most this often meanwhile, so closing Nyra
// while a reply waits (a command to approve) never loses the conversation, the user's message included
const STREAMING_SAVE_MS = 5000;

const workspacePathsOf = (conversations: Conversation[]) =>
  new Set(conversations.flatMap((c) => (c.workspace ? [c.workspace.path] : [])));

const attachmentIdsOf = (messages: Conversation["messages"]) => new Set(attachmentsOf(messages).map((a) => a.id));
const outputIdsOf = (messages: Conversation["messages"]) =>
  new Set(messages.flatMap((m) => (m.commands ?? []).filter((r) => r.output !== undefined).map((r) => r.id)));

// Keeps the in-memory conversations in sync with disk. The list loads at startup, but each conversation's
// messages only load when it is opened, so a long history (or many imports) doesn't slow the app down.
export function useConversationStorage(
  conversations: Conversation[],
  setConversations: Dispatch<SetStateAction<Conversation[]>>,
  streamingId: string | null,
  // Folders let go because no conversation uses them any more. Only the window that manages folders passes it: the
  // quick chat bar doesn't see the main window's unsaved conversations, so it must never let a folder go.
  onWorkspacesReleased?: (paths: string[]) => void,
  // After a conversation reached the disk, for another window to show it
  onSaved?: (id: string) => void,
) {
  const [storageError, setStorageError] = useState<string | null>(null);
  // State, not just a ref, so the chat can block sending until the messages are there
  const [loadingIds, setLoadingIds] = useState<ReadonlySet<string>>(new Set());
  // Conversations whose messages are in memory; the others are placeholders that must never be saved
  const loaded = useRef(new Set<string>());
  const loading = useRef(new Set<string>());
  const saved = useRef(new Map<string, Saved>());
  // Attachments of each conversation already on disk, so saves only send their id
  const storedAttachments = useRef(new Map<string, Set<string>>());
  // The same for the outputs of commands
  const storedOutputs = useRef(new Map<string, Set<string>>());
  // Saves of one conversation run one after another, so an older one can't finish last and win
  const saveQueue = useRef(new Map<string, Promise<void>>());
  // Conversations whose last save failed; once none is left, the sidebar stops saying so
  const failedSaves = useRef(new Set<string>());
  // Bumped to run the saving effect again after a failure, even if nothing else changes
  const [retries, setRetries] = useState(0);
  // When the conversation receiving a reply was last saved, and the one pending save of it
  const streamingSavedAt = useRef(new Map<string, number>());
  const streamingSave = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (streamingSave.current) clearTimeout(streamingSave.current);
    },
    [],
  );

  const report = (e: unknown) => setStorageError(errorMessage(e));

  // Read when the release runs, after the saves before it
  const current = useRef({ conversations, onWorkspacesReleased, onSaved });
  useLayoutEffect(() => {
    current.current = { conversations, onWorkspacesReleased, onSaved };
  });

  // Once the pending saves and deletions are on disk, so Rust sees which folders the saved conversations still use
  const releaseUnusedFolders = useCallback(() => {
    if (!current.current.onWorkspacesReleased) return;
    void Promise.all(saveQueue.current.values())
      .then(() => releaseUnusedWorkspaces([...workspacePathsOf(current.current.conversations)]))
      .then((paths) => {
        if (paths.length > 0) current.current.onWorkspacesReleased?.(paths);
      })
      .catch((e) => setStorageError(errorMessage(e)));
  }, []);

  // changedIds were rewritten on disk (e.g. re-imported), so their in-memory copy is dropped
  async function refresh(changedIds: string[] = []) {
    try {
      const stored = await listConversations();
      const changed = new Set(changedIds);
      changed.forEach((id) => {
        loaded.current.delete(id);
        saved.current.delete(id);
        storedAttachments.current.delete(id);
        storedOutputs.current.delete(id);
      });
      setConversations((current) => mergeWithStored(current, stored, changed));
    } catch (e) {
      report(e);
    }
  }

  async function ensureLoaded(id: string) {
    if (loaded.current.has(id) || loading.current.has(id)) return;
    loading.current.add(id);
    setLoadingIds(new Set(loading.current));
    try {
      const data = await loadConversationData(id);
      // Nothing on disk: the conversation only exists in memory and must stay unsaved
      if (!data) return;
      saved.current.set(id, data);
      storedAttachments.current.set(id, attachmentIdsOf(data.messages));
      storedOutputs.current.set(id, outputIdsOf(data.messages));
      loaded.current.add(id);
      setConversations((list) =>
        list.map((c) =>
          c.id === id
            ? {
                ...c,
                messages: data.messages,
                summary: data.summary,
                skills: data.skills,
                workspace: data.workspace,
                taskSkill: data.taskSkill,
                modelChoice: data.modelChoice,
              }
            : c,
        ),
      );
    } catch (e) {
      report(e);
    } finally {
      loading.current.delete(id);
      setLoadingIds(new Set(loading.current));
    }
  }

  function markNew(id: string) {
    loaded.current.add(id);
  }

  // Runs after that conversation's pending save, in its queue
  function afterPendingSave(id: string, task: () => Promise<unknown>) {
    const pending = saveQueue.current.get(id) ?? Promise.resolve();
    saveQueue.current.set(id, pending.then(task).then(() => {}, report));
  }

  // The deletion waits for that conversation's pending save; otherwise the save could land after it and
  // bring the conversation back on the next start
  function forget(id: string) {
    loaded.current.delete(id);
    saved.current.delete(id);
    storedAttachments.current.delete(id);
    storedOutputs.current.delete(id);
    afterPendingSave(id, () => deleteStoredConversation(id));
    // Its folder may not be known here: an unopened conversation only has its title in memory
    releaseUnusedFolders();
  }

  // After the conversation's pending save, so a conversation pinned while it is first being saved has a row
  function setPinned(id: string, pinned: boolean) {
    afterPendingSave(id, () => setConversationPinned(id, pinned));
  }

  // Same as pinning: after the pending save, and applied by the first save if there is no row yet
  function setFolder(id: string, folderId: string | null) {
    afterPendingSave(id, () => setConversationFolder(id, folderId));
  }

  // Also after the pending save; a conversation not stored yet gets the new title with its first save
  function rename(id: string, title: string) {
    afterPendingSave(id, () => renameStoredConversation(id, title));
  }

  // Pending saves finish first; otherwise one could write a conversation back after it was deleted
  async function forgetAll() {
    loaded.current.clear();
    saved.current.clear();
    storedAttachments.current.clear();
    storedOutputs.current.clear();
    await Promise.all(saveQueue.current.values());
    saveQueue.current.clear();
    await deleteAllStoredConversations();
    releaseUnusedFolders();
  }

  // The list is read once at startup; later refreshes are explicit
  useEffect(() => {
    let cancelled = false;
    listConversations()
      .then((stored) => {
        if (cancelled) return;
        setConversations((current) => mergeWithStored(current, stored));
        // Folders left behind before this existed, or by a conversation deleted while Nyra was closing
        releaseUnusedFolders();
      })
      .catch((e) => {
        if (!cancelled) setStorageError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [setConversations, releaseUnusedFolders]);

  useEffect(() => {
    for (const conversation of conversations) {
      const { id, messages, summary, skills, workspace, taskSkill, modelChoice } = conversation;
      if (!loaded.current.has(id) || messages.length === 0) continue;
      if (id === streamingId) {
        const since = Date.now() - (streamingSavedAt.current.get(id) ?? 0);
        if (since < STREAMING_SAVE_MS) {
          // Saved later even if no new frame comes (the reply waits for the user)
          streamingSave.current ??= setTimeout(() => {
            streamingSave.current = null;
            setRetries((n) => n + 1);
          }, STREAMING_SAVE_MS - since);
          continue;
        }
      }
      const last = saved.current.get(id);
      const unchanged =
        last?.messages === messages &&
        last.summary === summary &&
        last.skills === skills &&
        last.workspace === workspace &&
        last.taskSkill === taskSkill &&
        last.modelChoice === modelChoice;
      if (unchanged) continue;

      const snapshot = { messages, summary, skills, workspace, taskSkill, modelChoice };
      saved.current.set(id, snapshot);
      if (id === streamingId) streamingSavedAt.current.set(id, Date.now());
      const previous = saveQueue.current.get(id) ?? Promise.resolve();
      const save = async () => {
        const stored = { attachments: storedAttachments.current.get(id), outputs: storedOutputs.current.get(id) };
        await saveConversation(conversation, stored.attachments ?? new Set(), stored.outputs ?? new Set());
        // Pinned before its first save (e.g. while the first reply streamed): the row exists only now
        if (conversation.pinned) await setConversationPinned(id, true);
        // A branch starts in its original's folder, and a new conversation can be moved before it is saved
        if (conversation.folderId) await setConversationFolder(id, conversation.folderId);
        // Only after the save succeeded; if it failed, the next one sends the content again
        storedAttachments.current.set(id, attachmentIdsOf(messages));
        storedOutputs.current.set(id, outputIdsOf(messages));
        if (failedSaves.current.delete(id) && failedSaves.current.size === 0) setStorageError(null);
        current.current.onSaved?.(id);
      };
      const retryLater = (e: unknown) => {
        report(e);
        failedSaves.current.add(id);
        // Unless a newer version is already on its way, this one counts as unsaved and goes again
        if (saved.current.get(id) === snapshot) saved.current.delete(id);
        setTimeout(() => setRetries((n) => n + 1), SAVE_RETRY_MS);
      };
      saveQueue.current.set(id, previous.then(save).catch(retryLater));
    }
  }, [conversations, streamingId, retries]);

  // A folder gone from the conversations in memory (disconnected, changed, a private conversation closed); declared
  // after the saving effect, so the save that drops it is queued first
  const inMemoryFolders = useRef(new Set<string>());
  useEffect(() => {
    const paths = workspacePathsOf(conversations);
    const dropped = [...inMemoryFolders.current].some((path) => !paths.has(path));
    inMemoryFolders.current = paths;
    if (dropped) releaseUnusedFolders();
  });

  // Resolves once the conversation's pending saves are on disk, for another window to read it
  const whenSaved = (id: string) => saveQueue.current.get(id) ?? Promise.resolve();

  return {
    whenSaved,
    storageError,
    isLoading: (id: string) => loadingIds.has(id),
    ensureLoaded,
    markNew,
    forget,
    forgetAll,
    setPinned,
    setFolder,
    rename,
    refresh,
  };
}
