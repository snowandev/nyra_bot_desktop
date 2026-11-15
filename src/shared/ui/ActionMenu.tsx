import { Ellipsis, type LucideIcon } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
import { useAnchoredMenu } from "@/shared/hooks/useAnchoredMenu";

export type ActionMenuItem = {
  icon: LucideIcon;
  label: ReactNode;
  onSelect: () => void;
  // The keys that do the same from anywhere, shown at the right
  shortcut?: string;
  danger?: boolean;
  // A line above it, to set it apart from the ones before
  separated?: boolean;
};

type Props = {
  // What the menu is about, for its button and the menu itself: «Acciones de "web"»
  label: string;
  items: ActionMenuItem[];
  // A class of the place it is in, next to the menu's own
  className?: string;
};

const ITEMS = "[role^='menuitem'], .conversation-menu-back";

// Arrow keys walk a menu's items, Home and End jump to the ends
export function moveMenuFocus(e: KeyboardEvent<HTMLElement>) {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(ITEMS));
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next =
    e.key === "ArrowDown"
      ? (index + 1) % items.length
      : e.key === "ArrowUp"
        ? (index - 1 + items.length) % items.length
        : e.key === "Home"
          ? 0
          : e.key === "End"
            ? items.length - 1
            : null;
  if (next === null) return;
  e.preventDefault();
  items[next]?.focus();
}

// The "⋯" of a row (a folder, a project, a file): a button that opens its actions next to it, fixed so a scrolling
// list doesn't clip it. It opens with the focus on its first action and the arrows move through the rest.
export function ActionMenu({ label, items, className = "" }: Props) {
  const { isOpen, rootRef, triggerRef, position, toggle, close } = useAnchoredMenu();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) listRef.current?.querySelector<HTMLElement>(ITEMS)?.focus();
  }, [isOpen]);

  return (
    <div className={`conversation-menu ${className} ${isOpen ? "open" : ""}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="conversation-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={toggle}
      >
        <Ellipsis size={16} strokeWidth={2} />
      </button>
      {isOpen && (
        <div
          ref={listRef}
          role="menu"
          aria-label={label}
          className="conversation-menu-list"
          style={position}
          onKeyDown={moveMenuFocus}
        >
          {items.map(({ icon: Icon, label: text, onSelect, shortcut, danger, separated }, i) => (
            <div key={i} role="none" className="action-menu-entry">
              {separated && <hr className="conversation-menu-separator" />}
              <button
                type="button"
                role="menuitem"
                className={`conversation-menu-option ${danger ? "danger" : ""}`}
                onClick={() => {
                  close();
                  onSelect();
                }}
              >
                <Icon size={16} strokeWidth={1.8} />
                {text}
                {shortcut && <kbd className="menu-option-shortcut">{shortcut}</kbd>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
