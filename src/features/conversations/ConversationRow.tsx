import { Folder } from "lucide-react";
import { type DragEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CONVERSATION_DRAG_TYPE } from "./folders";
import { TITLE_MAX } from "./conversationStorage";
import type { Folder as FolderData } from "./folderStorage";
import type { Conversation } from "@/shared/types";
import { ConversationMenu } from "./ConversationMenu";

type Props = {
  conversation: Conversation;
  isActive: boolean;
  // Nyra is working in it: writing a reply, or waiting on a command that may take long
  isBusy?: boolean;
  // A change to review or a command waiting for permission in it (the Código space)
  hasPending?: boolean;
  // Its level when it is a row of a tree (inside a project of the Código sidebar)
  treeLevel?: number;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  // The Chat space's pinning, folders and dragging; a project's conversation has none of them
  organize?: {
    onTogglePin: () => void;
    folders: FolderData[];
    onMove: (folderId: string | null) => void;
    onMoveToNewFolder: () => void;
    // In "Fijados", the folder the conversation belongs to, so it isn't lost from view
    folderHint?: string;
    isDragging: boolean;
    onDragStart: () => void;
    onDragEnd: () => void;
    registerOpenMove: (openMove: (() => void) | null) => void;
  };
};


// WebKit's own drag image is a snapshot that can take in much of the sidebar; a compact pill with the title is
// what's dragged instead. It only has to exist while the browser copies it, right after dragstart.
function showDragImage(e: DragEvent<HTMLElement>, title: string) {
  const ghost = document.createElement("div");
  ghost.className = "conversation-drag-ghost";
  ghost.textContent = title;
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 16, ghost.offsetHeight / 2);
  window.setTimeout(() => ghost.remove(), 0);
}

export function ConversationRow(props: Props) {
  const { conversation, isActive, isBusy = false, hasPending = false, treeLevel, onSelect, onRename, onDelete } = props;
  const { organize } = props;
  const folderHint = organize?.folderHint;
  const { t } = useTranslation();
  // The name being typed while renaming in place; null when not renaming
  const [draft, setDraft] = useState<string | null>(null);
  // Removing the field can fire a blur right after Enter or Escape; only the first ending counts
  const finished = useRef(false);

  function startRenaming() {
    finished.current = false;
    setDraft(conversation.title);
  }

  function finish(save: boolean) {
    if (finished.current) return;
    finished.current = true;
    const title = draft?.trim();
    if (save && title && title !== conversation.title) onRename(title);
    setDraft(null);
  }

  return (
    <div
      className={`conversation-item conversation-row ${isActive ? "active" : ""} ${draft !== null ? "renaming" : ""} ${organize?.isDragging ? "dragging" : ""}`}
      draggable={!!organize && draft === null}
      onDragStart={(e) => {
        if (!organize) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(CONVERSATION_DRAG_TYPE, conversation.id);
        e.dataTransfer.setData("text/plain", conversation.title);
        showDragImage(e, conversation.title);
        organize.onDragStart();
      }}
      onDragEnd={organize?.onDragEnd}
    >
      {draft === null ? (
        <button
          type="button"
          className="conversation-select"
          aria-current={isActive ? "page" : undefined}
          role={treeLevel ? "treeitem" : undefined}
          aria-level={treeLevel}
          aria-selected={treeLevel ? isActive : undefined}
          onClick={onSelect}
          onKeyDown={(e) => {
            if (e.key !== "F2") return;
            e.preventDefault();
            startRenaming();
          }}
        >
          <span className="conversation-marker" />
          <span className="conversation-title">{conversation.title}</span>
          {hasPending && (
            <span className="conversation-pending" role="img" aria-label={t("conversations.row.pending")} />
          )}
          {isBusy && <span className="conversation-busy" role="img" aria-label={t("conversations.row.busy")} />}
          {folderHint && (
            <span className="conversation-folder-hint" title={t("conversations.row.inFolder", { folder: folderHint })}>
              <Folder size={12} strokeWidth={2} />
              <span>{folderHint}</span>
            </span>
          )}
        </button>
      ) : (
        <input
          className="conversation-rename"
          aria-label={t("conversations.row.renameLabel")}
          value={draft}
          maxLength={TITLE_MAX}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") finish(true);
            if (e.key === "Escape") finish(false);
          }}
          // Clicking elsewhere keeps what was typed, as most apps do
          onBlur={() => finish(true)}
        />
      )}
      {draft === null && (
        <ConversationMenu
          title={conversation.title}
          onRename={startRenaming}
          onDelete={onDelete}
          organize={
            organize && {
              isPinned: !!conversation.pinned,
              folders: organize.folders,
              folderId: conversation.folderId ?? null,
              onTogglePin: organize.onTogglePin,
              onMove: organize.onMove,
              onMoveToNewFolder: organize.onMoveToNewFolder,
              registerOpenMove: organize.registerOpenMove,
            }
          }
        />
      )}
    </div>
  );
}
