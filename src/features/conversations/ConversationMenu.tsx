import { ArrowLeft, Check, ChevronRight, Ellipsis, Folder, FolderInput, FolderMinus, FolderPlus, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAnchoredMenu } from "@/shared/hooks/useAnchoredMenu";
import { moveMenuFocus } from "@/shared/ui/ActionMenu";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import { SHORTCUTS, shortcutLabelOf } from "@/shared/lib/shortcuts";
import type { Folder as FolderData } from "./folderStorage";

// Pinning and moving to a folder are the Chat space's; a project's conversation only has renaming and deleting
type Organize = {
  isPinned: boolean;
  folders: FolderData[];
  folderId: string | null;
  onTogglePin: () => void;
  onMove: (folderId: string | null) => void;
  // Creates a folder and moves the conversation into it in one step
  onMoveToNewFolder: () => void;
  // Hands the sidebar a way to open "Move to" directly, for its keyboard shortcut; null when the row goes away
  registerOpenMove: (openMove: (() => void) | null) => void;
};

type Props = {
  title: string;
  onRename: () => void;
  onDelete: () => void;
  organize?: Organize;
};

const ITEMS = "[role^='menuitem'], .conversation-menu-back";

export function ConversationMenu(props: Props) {
  const { title, onRename, onDelete, organize } = props;
  const registerOpenMove = organize?.registerOpenMove;
  const { t } = useTranslation();
  const { isOpen, rootRef, triggerRef, position, toggle, close } = useAnchoredMenu();
  // The "Move to" list replaces the main menu: at 272 px a submenu beside it would cover the chat
  const [view, setView] = useState<"main" | "move">("main");
  const listRef = useRef<HTMLDivElement>(null);

  // Each view starts with focus on its first item, as keyboard users expect from a menu
  useEffect(() => {
    if (isOpen) listRef.current?.querySelector<HTMLElement>(ITEMS)?.focus();
  }, [isOpen, view]);

  const openMove = useStableCallback(() => {
    // The list can be scrolled away from the row; the page's own containers can't scroll (overflow: clip)
    triggerRef.current?.scrollIntoView({ block: "nearest" });
    setView("move");
    if (!isOpen) toggle();
  });

  // A layout effect, so it is registered as soon as the row is committed: the shortcut may have just opened
  // the section holding it and calls this right after
  useLayoutEffect(() => {
    if (!registerOpenMove) return;
    registerOpenMove(openMove);
    return () => registerOpenMove(null);
  }, [registerOpenMove, openMove]);

  function run(action: () => void) {
    close();
    action();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (view === "main" && e.key === "ArrowRight" && (e.target as HTMLElement).dataset.opensMove) {
      e.preventDefault();
      setView("move");
    } else if (view === "move" && e.key === "ArrowLeft") {
      e.preventDefault();
      setView("main");
    } else {
      moveMenuFocus(e);
    }
  }

  return (
    <div className={`conversation-menu ${isOpen ? "open" : ""}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="conversation-menu-trigger"
        aria-label={t("conversations.menu.optionsOf", { title })}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => {
          setView("main");
          toggle();
        }}
      >
        <Ellipsis size={16} strokeWidth={2} />
      </button>

      {isOpen && view === "main" && (
        <div
          ref={listRef}
          role="menu"
          aria-label={t("conversations.menu.label")}
          className="conversation-menu-list"
          style={position}
          onKeyDown={onKeyDown}
        >
          {organize && (
            <button
              type="button"
              role="menuitem"
              className="conversation-menu-option"
              onClick={() => run(organize.onTogglePin)}
            >
              {organize.isPinned ? <PinOff size={16} strokeWidth={1.8} /> : <Pin size={16} strokeWidth={1.8} />}
              {organize.isPinned ? t("conversations.menu.unpin") : t("conversations.menu.pin")}
            </button>
          )}
          <button type="button" role="menuitem" className="conversation-menu-option" onClick={() => run(onRename)}>
            <Pencil size={16} strokeWidth={1.8} />
            {t("conversations.menu.rename")}
          </button>
          {organize && (
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              data-opens-move="true"
              className="conversation-menu-option"
              onClick={() => setView("move")}
            >
              <FolderInput size={16} strokeWidth={1.8} />
              {t("conversations.menu.moveTo")}
              <kbd className="menu-option-shortcut">{shortcutLabelOf(SHORTCUTS.moveConversation)}</kbd>
              <ChevronRight size={15} strokeWidth={1.8} className="conversation-menu-chevron" />
            </button>
          )}
          <hr className="conversation-menu-separator" />
          <button type="button" role="menuitem" className="conversation-menu-option danger" onClick={() => run(onDelete)}>
            <Trash2 size={16} strokeWidth={1.8} />
            {t("conversations.menu.delete")}
          </button>
        </div>
      )}

      {isOpen && view === "move" && organize && (
        <div
          ref={listRef}
          role="menu"
          aria-label={t("conversations.menu.moveLabel", { title })}
          className="conversation-menu-list"
          style={position}
          onKeyDown={onKeyDown}
        >
          <button
            type="button"
            className="conversation-menu-back"
            aria-label={t("conversations.menu.back")}
            onClick={() => setView("main")}
          >
            <ArrowLeft size={14} strokeWidth={2} />
            {t("conversations.menu.moveToTitle")}
          </button>
          <span className="conversation-menu-subtitle">{title}</span>
          {organize.folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              role="menuitemradio"
              aria-checked={folder.id === organize.folderId}
              className="conversation-menu-option"
              onClick={() => run(() => organize.onMove(folder.id))}
            >
              <Folder size={16} strokeWidth={1.8} />
              <span className="conversation-menu-label">{folder.name}</span>
              {folder.id === organize.folderId && (
                <Check size={15} strokeWidth={2} className="conversation-menu-check" />
              )}
            </button>
          ))}
          {organize.folders.length > 0 && <hr className="conversation-menu-separator" />}
          <button
            type="button"
            role="menuitem"
            className="conversation-menu-option"
            onClick={() => run(organize.onMoveToNewFolder)}
          >
            <FolderPlus size={16} strokeWidth={1.8} />
            {t("conversations.menu.newFolder")}
          </button>
          {organize.folderId && (
            <button
              type="button"
              role="menuitem"
              className="conversation-menu-option"
              onClick={() => run(() => organize.onMove(null))}
            >
              <FolderMinus size={16} strokeWidth={1.8} />
              {t("conversations.menu.removeFromFolder")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
