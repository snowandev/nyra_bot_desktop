import { invoke } from "@tauri-apps/api/core";
import { settledRun } from "@/features/terminal/commandTools";
import { i18n } from "@/shared/i18n/i18n";
import type {
  Attachment,
  CommandRun,
  Conversation,
  ConversationSummary,
  Message,
  WorkspaceFolder,
} from "@/shared/types";

// Conversations are stored by the Rust side in SQLite; only these commands reach it

type ConversationMeta = {
  id: string;
  title: string;
  updatedAt: number;
  pinned: boolean;
  folderId: string | null;
  projectId: string | null;
};

type StoredData = {
  messages: Message[];
  summary?: ConversationSummary;
  skills?: string[];
  workspace?: WorkspaceFolder;
  taskSkill?: string;
  modelChoice?: Conversation["modelChoice"];
};

// A folder that isn't two strings is dropped: Rust refuses any path the user didn't pick anyway
function validWorkspace(value: unknown): WorkspaceFolder | undefined {
  const folder = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return typeof folder.path === "string" && typeof folder.name === "string"
    ? { path: folder.path, name: folder.name }
    : undefined;
}

export const listConversations = () => invoke<ConversationMeta[]>("list_conversations");

// Combines the stored list with what is in memory: conversations not saved yet (new, private) stay first,
// stored ones follow in their saved order, and changedIds were rewritten on disk so their copy is dropped
export function mergeWithStored(
  current: Conversation[],
  stored: ConversationMeta[],
  changedIds: ReadonlySet<string> = new Set(),
): Conversation[] {
  const byId = new Map(current.map((c) => [c.id, c]));
  const storedIds = new Set(stored.map((s) => s.id));
  const unsaved = current.filter((c) => !storedIds.has(c.id));
  const fromDisk = stored.map((s) => {
    const inMemory = byId.get(s.id);
    if (inMemory && !changedIds.has(s.id)) return inMemory;
    return {
      id: s.id,
      title: s.title,
      messages: [],
      pinned: s.pinned,
      folderId: s.folderId,
      ...(s.projectId && { projectId: s.projectId }),
    };
  });
  return [...unsaved, ...fromDisk];
}

// null when nothing is stored under that id, e.g. a private conversation
export async function loadConversationData(id: string): Promise<StoredData | null> {
  const raw = await invoke<string | null>("load_conversation", { id });
  if (raw === null) return null;
  const data: unknown = JSON.parse(raw);
  // Stored by this app, but a damaged file must not break the chat
  if (typeof data !== "object" || data === null || !Array.isArray((data as StoredData).messages)) {
    throw new Error(i18n.t("conversations.damaged"));
  }
  const stored = data as StoredData;
  const workspace = validWorkspace(stored.workspace);
  const taskSkill = typeof stored.taskSkill === "string" ? stored.taskSkill : undefined;
  const choice: unknown = stored.modelChoice;
  const modelChoice = choice === "demanding" || choice === "main" ? choice : undefined;
  // A program left running after its reply was ended with the Nyra that ran it: no card shows it running any more
  const messages = stored.messages.map((m) => (m.commands ? { ...m, commands: m.commands.map(settledRun) } : m));
  return { ...stored, messages, workspace, taskSkill, modelChoice };
}

// An attachment already on disk is sent as just its id: its content never changes, and sending it again after
// every reply would serialize megabytes of base64 for nothing. The Rust side fills it back in when loading.
type AttachmentReference = { id: string };
type OutgoingMessage = Omit<Message, "attachments"> & { attachments?: (Attachment | AttachmentReference)[] };

// The same goes for the output of a command already on disk: it never changes once the command ended
const withoutOutput = ({ output: _, ...run }: CommandRun) => run;

const NONE: ReadonlySet<string> = new Set();

export function toOutgoingData(
  { messages, summary, skills, workspace, projectId, taskSkill, modelChoice }: Conversation,
  storedAttachmentIds: ReadonlySet<string>,
  storedOutputIds: ReadonlySet<string> = NONE,
) {
  const outgoing: OutgoingMessage[] = messages.map((m) => {
    if (!m.attachments && !m.commands?.some((r) => storedOutputIds.has(r.id))) return m;
    return {
      ...m,
      ...(m.attachments && {
        attachments: m.attachments.map((a) => (storedAttachmentIds.has(a.id) ? { id: a.id } : a)),
      }),
      ...(m.commands && { commands: m.commands.map((r) => (storedOutputIds.has(r.id) ? withoutOutput(r) : r)) }),
    };
  });
  return {
    messages: outgoing,
    ...(summary && { summary }),
    ...(skills?.length && { skills }),
    ...(workspace && { workspace }),
    // Rust keeps it in a column of its own
    ...(projectId && { projectId }),
    ...(taskSkill && { taskSkill }),
    ...(modelChoice && { modelChoice }),
  };
}

export function saveConversation(
  conversation: Conversation,
  storedAttachmentIds: ReadonlySet<string>,
  storedOutputIds: ReadonlySet<string>,
) {
  const data = toOutgoingData(conversation, storedAttachmentIds, storedOutputIds);
  return invoke<void>("save_conversation", { id: conversation.id, title: conversation.title, data: JSON.stringify(data) });
}

// Same limit as the Rust side, which checks it again
export const TITLE_MAX = 120;

export const renameStoredConversation = (id: string, title: string) =>
  invoke<void>("rename_conversation", { id, title });

export const setConversationPinned = (id: string, pinned: boolean) =>
  invoke<void>("set_conversation_pinned", { id, pinned });

export const setConversationFolder = (id: string, folderId: string | null) =>
  invoke<void>("set_conversation_folder", { id, folderId });

export const deleteStoredConversation = (id: string) => invoke<void>("delete_conversation", { id });

export const deleteAllStoredConversations = () => invoke<number>("delete_all_conversations");

// Matches across every saved conversation, best first, one per conversation
export type SearchHit = {
  conversationId: string;
  title: string;
  updatedAt: number;
  // The message to jump to: the best match, or the one the file was attached to
  messageIndex: number;
  attachmentName: string | null;
  // Text around the match, with the matched words between MATCH_START and MATCH_END
  snippet: string;
  matchCount: number;
};

export const MATCH_START = "\u0001";
export const MATCH_END = "\u0002";

export const searchConversations = (query: string) => invoke<SearchHit[]>("search_conversations", { query });
