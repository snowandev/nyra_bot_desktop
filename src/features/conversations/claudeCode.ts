import { invoke } from "@tauri-apps/api/core";
import { base64ToBytes } from "@/shared/lib/base64";
import { MAX_ATTACHED_PDF_IMAGES, readPdf } from "@/features/attachments/pdf";
import type { Attachment } from "@/shared/types";
import { loadConversationData } from "./conversationStorage";

// "continued": imported and then continued in Nyra, so re-importing won't overwrite it
type ImportStatus = "new" | "imported" | "continued";

export type ClaudeCodeSession = {
  id: string;
  project: string;
  projectPath: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  status: ImportStatus;
  // Only for continued sessions
  importedMessageCount: number | null;
  nyraMessageCount: number | null;
};

export type ImportResult = {
  // Created or updated in place
  imported: string[];
  // Continued in Nyra; the newer Claude Code version was saved as a separate conversation
  copied: string[];
  // Continued in Nyra and nothing new in Claude Code
  skipped: string[];
  // Of the imported or copied, those left in the chat: their folder is too general to become a project on its own
  // (the personal folder, Documents…)
  keptInChat: string[];
  // Of the imported or copied, those with PDFs still to be read here; only these are opened after the import
  pendingPdfs: string[];
  // PDFs whose text couldn't be read (damaged or with a password); the next import tries again
  unreadPdfs: number;
};

export type ClaudeCodeProject = {
  path: string;
  name: string;
  sessions: ClaudeCodeSession[];
};

// The Rust side reads ~/.claude/projects (or CLAUDE_CONFIG_DIR) and parses each session
export const listClaudeCodeSessions = () => invoke<ClaudeCodeSession[]>("list_claude_code_sessions");

const importSessions = (ids: string[]) =>
  invoke<Omit<ImportResult, "unreadPdfs">>("import_claude_code_sessions", { ids });

// Reads one imported PDF and stores what it gives; false when it couldn't be read or stored, so it stays waiting
async function completeImportedPdf(conversationId: string, attachment: Attachment) {
  try {
    const read = await readPdf(base64ToBytes(attachment.pdf ?? ""), { maxImages: MAX_ATTACHED_PDF_IMAGES });
    const { text, visuals, pageCount, visualsUpToPage } = read;
    const completed = { id: attachment.id, data: text, pageCount, visualsUpToPage, ...(visuals.length > 0 && { visuals }) };
    await invoke("complete_imported_pdf", { conversationId, attachment: JSON.stringify(completed) });
    return true;
  } catch {
    // Counted and told in the import's result; the next import tries again
    return false;
  }
}

// Rust keeps an imported PDF as the file alone; its text and images are read here, as for a PDF attached in Nyra.
// Each goes on its own: one that fails doesn't stop the rest, nor the import, whose conversations are already saved.
// Returns how many failed. A conversation that can't be opened any more (deleted meanwhile) has none to read.
async function readImportedPdfs(conversationId: string) {
  const data = await loadConversationData(conversationId).catch(() => null);
  const pending = (data?.messages ?? [])
    .flatMap((m) => m.attachments ?? [])
    .filter((a) => a.kind === "pdf" && a.pdf && a.pageCount === undefined);
  let unread = 0;
  for (const attachment of pending) {
    if (!(await completeImportedPdf(conversationId, attachment))) unread++;
  }
  return unread;
}

export async function importClaudeCodeSessions(ids: string[]) {
  const result = await importSessions(ids);
  let unreadPdfs = 0;
  for (const id of result.pendingPdfs) unreadPdfs += await readImportedPdfs(id);
  return { ...result, unreadPdfs };
}

// How far each side moved since the import; Nyra's count can shrink if a message was edited and later ones dropped
export function progressOf(session: ClaudeCodeSession) {
  const base = session.importedMessageCount ?? 0;
  return {
    inNyra: Math.max(0, (session.nyraMessageCount ?? base) - base),
    inClaudeCode: Math.max(0, session.messageCount - base),
  };
}

// Sessions arrive newest first, so projects keep the order of their most recent session
export function groupByProject(sessions: ClaudeCodeSession[]): ClaudeCodeProject[] {
  const projects = new Map<string, ClaudeCodeProject>();
  for (const session of sessions) {
    const project = projects.get(session.projectPath) ?? { path: session.projectPath, name: session.project, sessions: [] };
    project.sessions.push(session);
    projects.set(session.projectPath, project);
  }
  return [...projects.values()];
}

