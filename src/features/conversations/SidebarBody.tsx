import { Folder, FolderPlus, Pin, Plus, Search } from "lucide-react";
import { memo, useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { GENERAL_LIST, useConversationDrag } from "./useConversationDrag";
import { useConversationSearch } from "./useConversationSearch";
import { useShortcut } from "@/shared/hooks/useShortcut";
import { errorMessage } from "@/shared/lib/errors";
import { SHORTCUTS, shortcutLabelOf } from "@/shared/lib/shortcuts";
import { foldForSearch } from "@/shared/lib/search";
import type { SearchHit } from "./conversationStorage";
import type { Folder as FolderData } from "./folderStorage";
import { loadCollapsedSections, saveCollapsedSections, type SidebarSection as Section } from "@/shared/storage/settings";
import type { Conversation } from "@/shared/types";
import { ConversationRow } from "./ConversationRow";
import { FolderDeleteConfirm } from "./FolderDeleteConfirm";
import { FolderNameEditor } from "./FolderNameEditor";
import { FolderSection } from "./FolderSection";
import { SearchHitRow } from "./SearchHitRow";
import { SidebarSection } from "@/shared/ui/SidebarSection";

type Props = {
  conversations: Conversation[];
  activeId: string | null;
  // The conversation Nyra is working in, if any
  busyId?: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onSetPinned: (id: string, pinned: boolean) => void;
  onRename: (id: string, title: string) => void;
  // Opens the conversation at the matching message; query is what the user typed
  onOpenSearchHit: (hit: SearchHit, query: string) => void;
  // Settings cover the sidebar; its shortcut must not fire underneath
  shortcutEnabled: boolean;
  // Sorted alphabetically
  folders: FolderData[];
  // These reject with the reason, shown where the user was typing
  onCreateFolder: (name: string) => Promise<FolderData>;
  onRenameFolder: (id: string, name: string) => Promise<void>;
  onDeleteFolder: (id: string) => Promise<void>;
  onMoveConversation: (id: string, folderId: string | null) => void;
  storageError: string | null;
};

type Editing = { mode: "create"; moveConversationId?: string } | { mode: "rename"; folderId: string };

// One letter matches almost everything; contents are searched from two
const MIN_CONTENT_QUERY = 2;

const folderSection = (id: string): Section => `folder:${id}`;

// The Chat space's list: drawn again only when what it shows changes (see Sidebar)
export const SidebarBody = memo(function SidebarBody(props: Props) {
  const { conversations, activeId, onSelect, onNew, onDelete, onSetPinned, onRename, busyId } = props;
  const { onOpenSearchHit, shortcutEnabled, storageError } = props;
  const { folders, onCreateFolder, onRenameFolder, onDeleteFolder, onMoveConversation } = props;
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  // Read by screen readers after a move, since the row jumps to another section
  const [announcement, setAnnouncement] = useState("");
  const [collapsed, setCollapsed] = useState(loadCollapsedSections);
  const searchRef = useRef<HTMLInputElement>(null);
  // How to open each conversation's "Move to" menu, for the keyboard shortcut
  const moveMenus = useRef(new Map<string, () => void>());

  const trimmedQuery = query.trim();
  const isSearching = !!trimmedQuery;
  // Private conversations are never listed, so leaving one leaves no trace
  const listed = conversations.filter((c) => !c.isPrivate);
  const folderIds = new Set(folders.map((f) => f.id));
  // A folder deleted elsewhere leaves its conversations in the general list
  const folderOf = (c: Conversation) => (c.folderId && folderIds.has(c.folderId) ? c.folderId : null);
  const folderName = (id: string | null) => folders.find((f) => f.id === id)?.name;
  // A pinned conversation only shows in "Fijados", with a hint of its folder: never twice in the list
  const pinned = listed.filter((c) => c.pinned);
  const inFolder = (folderId: string) => listed.filter((c) => !c.pinned && folderOf(c) === folderId);
  const others = listed.filter((c) => !c.pinned && !folderOf(c));

  // While searching, one flat list replaces the sections, so every match fits: title matches first, then the
  // conversations that only match inside. Each conversation once, with its best content match if it has one.
  const contentSearch = useConversationSearch(trimmedQuery.length >= MIN_CONTENT_QUERY ? trimmedQuery : "");
  const foldedQuery = foldForSearch(trimmedQuery);
  const byTitle = isSearching ? listed.filter((c) => foldForSearch(c.title).includes(foldedQuery)) : [];
  const titleIds = new Set(byTitle.map((c) => c.id));
  const hitsById = new Map(contentSearch.hits.map((hit) => [hit.conversationId, hit]));
  const results = [
    ...byTitle.map((conversation) => ({ conversation, hit: hitsById.get(conversation.id) })),
    // A conversation deleted since the search ran is no longer offered
    ...contentSearch.hits.flatMap((hit) => {
      const conversation = listed.find((c) => c.id === hit.conversationId);
      return conversation && !titleIds.has(conversation.id) ? [{ conversation, hit }] : [];
    }),
  ];
  const hasNoResults = isSearching && results.length === 0 && !contentSearch.isSearching;

  const isOpen = (section: Section) => !collapsed.includes(section);

  function setOpen(section: Section, open: boolean) {
    const next = open ? collapsed.filter((s) => s !== section) : [...collapsed, section];
    setCollapsed(next);
    saveCollapsedSections(next);
  }

  // The sections a conversation's row lives in, so it can be shown
  function sectionsHolding(conversation: Conversation): Section[] {
    if (conversation.pinned) return ["pinned"];
    const folderId = folderOf(conversation);
    return folderId ? ["folders", folderSection(folderId)] : ["chats"];
  }

  const registerOpenMove = useCallback((id: string, openMove: (() => void) | null) => {
    if (openMove) moveMenus.current.set(id, openMove);
    else moveMenus.current.delete(id);
  }, []);

  // The open conversation's row may be hidden by a search or a collapsed section; it is shown first, committed
  // at once (flushSync) so its menu exists, and then opened on "Move to"
  useShortcut(
    SHORTCUTS.moveConversation,
    () => {
      const conversation = listed.find((c) => c.id === activeId);
      if (!conversation) return;
      flushSync(() => {
        setQuery("");
        const sections = sectionsHolding(conversation);
        const next = collapsed.filter((s) => !sections.includes(s));
        setCollapsed(next);
        saveCollapsedSections(next);
      });
      moveMenus.current.get(conversation.id)?.();
    },
    { enabled: shortcutEnabled },
  );

  function move(conversation: Conversation, folderId: string | null) {
    onMoveConversation(conversation.id, folderId);
    if (folderId) {
      setOpen(folderSection(folderId), true);
      setAnnouncement(
        t("conversations.movedTo", {
          title: conversation.title,
          folder: folderName(folderId) ?? t("conversations.theFolder"),
        }),
      );
    } else {
      setOpen("chats", true);
      setAnnouncement(t("conversations.removedFromFolder", { title: conversation.title }));
    }
  }

  const drag = useConversationDrag({
    zoneOf: (id) => {
      const conversation = listed.find((c) => c.id === id);
      return (conversation && folderOf(conversation)) ?? GENERAL_LIST;
    },
    onDrop: (id, zone) => {
      const conversation = listed.find((c) => c.id === id);
      if (conversation) move(conversation, zone === GENERAL_LIST ? null : zone);
    },
  });

  useShortcut(
    SHORTCUTS.searchAll,
    () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    },
    { enabled: shortcutEnabled },
  );

  // From the header it also works with the section collapsed: it opens to show where the name is typed
  function startCreatingFolder(moveConversationId?: string) {
    setOpen("folders", true);
    setEditing({ mode: "create", moveConversationId });
  }

  async function createFolder(name: string, moveConversationId?: string) {
    const folder = await onCreateFolder(name);
    setEditing(null);
    const conversation = listed.find((c) => c.id === moveConversationId);
    if (conversation) move(conversation, folder.id);
    else setAnnouncement(t("conversations.folderCreated", { name: folder.name }));
  }

  async function renameFolder(id: string, name: string) {
    await onRenameFolder(id, name);
    setEditing(null);
    setAnnouncement(t("conversations.folderRenamed", { name }));
  }

  async function deleteFolder(folder: FolderData) {
    setConfirmingDelete(null);
    setFolderError(null);
    try {
      await onDeleteFolder(folder.id);
      setAnnouncement(t("conversations.folderDeleted", { name: folder.name }));
    } catch (e) {
      setFolderError(errorMessage(e));
    }
  }

  // An empty folder goes without asking: nothing is lost
  function askToDelete(folder: FolderData) {
    const count = listed.filter((c) => folderOf(c) === folder.id).length;
    if (count === 0) deleteFolder(folder);
    else setConfirmingDelete(folder.id);
  }

  const row = (c: Conversation, inPinned = false) => (
    <ConversationRow
      key={c.id}
      conversation={c}
      isActive={c.id === activeId}
      isBusy={c.id === busyId}
      onSelect={() => onSelect(c.id)}
      onRename={(title) => onRename(c.id, title)}
      onDelete={() => onDelete(c.id)}
      organize={{
        onTogglePin: () => onSetPinned(c.id, !c.pinned),
        folders,
        onMove: (folderId) => move(c, folderId),
        onMoveToNewFolder: () => startCreatingFolder(c.id),
        folderHint: inPinned ? folderName(folderOf(c)) : undefined,
        isDragging: drag.dragging === c.id,
        onDragStart: () => drag.start(c.id),
        onDragEnd: drag.end,
        registerOpenMove: (openMove) => registerOpenMove(c.id, openMove),
      }}
    />
  );

  return (
    <>

      <button
        type="button"
        className="primary-button"
        title={t("conversations.newWithShortcut", { shortcut: shortcutLabelOf(SHORTCUTS.newConversation) })}
        onClick={onNew}
      >
        <Plus size={18} strokeWidth={2} />
        {t("conversations.new")}
      </button>

      <label className="search">
        <Search size={16} strokeWidth={2} />
        <span className="visually-hidden">{t("conversations.search")}</span>
        <input
          ref={searchRef}
          type="search"
          placeholder={t("conversations.search")}
          title={t("conversations.searchHint", { shortcut: shortcutLabelOf(SHORTCUTS.searchAll) })}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <nav aria-label={t("conversations.navLabel")} className="conversation-nav">
        {!isSearching && pinned.length > 0 && (
          <SidebarSection
            title={t("conversations.pinned")}
            icon={<Pin size={12} strokeWidth={2.2} className="accent" />}
            count={pinned.length}
            isOpen={isOpen("pinned")}
            onToggle={() => setOpen("pinned", !isOpen("pinned"))}
          >
            {pinned.map((c) => row(c, true))}
          </SidebarSection>
        )}

        {/* The section exists even without folders: it holds the button to create the first one */}
        {!isSearching && (
          <SidebarSection
            title={t("conversations.folders")}
            icon={<Folder size={12} strokeWidth={2.2} className="accent" />}
            count={folders.length}
            // Open while dragging, so the folders are there to drop on
            isOpen={isOpen("folders") || !!drag.dragging}
            onToggle={() => setOpen("folders", !isOpen("folders"))}
            spaced={pinned.length > 0}
            headerAside={
              <button
                type="button"
                className="section-action"
                aria-label={t("conversations.newFolder")}
                title={t("conversations.newFolder")}
                onClick={() => startCreatingFolder()}
              >
                <FolderPlus size={15} strokeWidth={2} />
              </button>
            }
          >
            <div className="folders-group">
              {editing?.mode === "create" && (
                <FolderNameEditor
                  mode="create"
                  folders={folders}
                  onSave={(name) => createFolder(name, editing.moveConversationId)}
                  onCancel={() => setEditing(null)}
                />
              )}
              {folders.map((folder) => {
                if (editing?.mode === "rename" && editing.folderId === folder.id) {
                  return (
                    <FolderNameEditor
                      key={folder.id}
                      mode="rename"
                      initialName={folder.name}
                      folders={folders}
                      folderId={folder.id}
                      onSave={(name) => renameFolder(folder.id, name)}
                      onCancel={() => setEditing(null)}
                    />
                  );
                }
                if (confirmingDelete === folder.id) {
                  return (
                    <FolderDeleteConfirm
                      key={folder.id}
                      name={folder.name}
                      conversationCount={listed.filter((c) => folderOf(c) === folder.id).length}
                      onCancel={() => setConfirmingDelete(null)}
                      onConfirm={() => deleteFolder(folder)}
                    />
                  );
                }
                const section = folderSection(folder.id);
                const inside = inFolder(folder.id);
                return (
                  <FolderSection
                    key={folder.id}
                    folder={folder}
                    count={inside.length}
                    isOpen={isOpen(section)}
                    onToggle={() => setOpen(section, !isOpen(section))}
                    onRename={() => setEditing({ mode: "rename", folderId: folder.id })}
                    onDelete={() => askToDelete(folder)}
                    isDropTarget={drag.target === folder.id}
                    dropZone={drag.zone(folder.id)}
                  >
                    {inside.map((c) => row(c))}
                  </FolderSection>
                );
              })}
            </div>
          </SidebarSection>
        )}

        {!isSearching && (others.length > 0 || drag.dragging) && (
          <SidebarSection
            title={t("conversations.chats")}
            icon={<span className="section-diamond" aria-hidden="true" />}
            count={others.length}
            isOpen={isOpen("chats")}
            onToggle={() => setOpen("chats", !isOpen("chats"))}
            spaced
            dropLabel={drag.target === GENERAL_LIST ? t("conversations.removeFromFolder") : null}
            dropZone={drag.zone(GENERAL_LIST)}
          >
            {others.map((c) => row(c))}
          </SidebarSection>
        )}

        {results.length > 0 && (
          <SidebarSection
            title={t("conversations.results")}
            icon={<Search size={12} strokeWidth={2.2} className="accent" />}
            count={results.length}
            isOpen
          >
            <ul className="search-hits">
              {results.map(({ conversation, hit }) => (
                <SearchHitRow
                  key={conversation.id}
                  title={conversation.title}
                  query={trimmedQuery}
                  hit={hit}
                  isActive={conversation.id === activeId}
                  onOpen={() => (hit ? onOpenSearchHit(hit, trimmedQuery) : onSelect(conversation.id))}
                />
              ))}
            </ul>
          </SidebarSection>
        )}
        {contentSearch.error && (
          <p role="alert" className="sidebar-error">
            {t("conversations.searchFailed", { error: contentSearch.error })}
          </p>
        )}
        {hasNoResults && <p className="empty-hint">{t("conversations.noResults")}</p>}
      </nav>

      <span className="visually-hidden" role="status">
        {announcement}
      </span>

      {(storageError || folderError) && (
        <p role="alert" className="sidebar-error">
          {storageError ? t("conversations.storageFailed", { error: storageError }) : folderError}
        </p>
      )}

    </>
  );
});
