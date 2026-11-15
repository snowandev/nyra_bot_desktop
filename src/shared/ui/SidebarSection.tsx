import { ChevronDown } from "lucide-react";
import { type HTMLAttributes, type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  title: string;
  icon: ReactNode;
  // Shown while collapsed, so it's clear how many conversations are hidden
  count: number;
  isOpen: boolean;
  // Without it the section can't be collapsed and its title is just a label
  onToggle?: () => void;
  spaced?: boolean;
  // The user's own folders keep their name as written, unlike the app's sections in small caps
  isFolder?: boolean;
  // At the right of the header, just before the chevron: a folder's "⋯" menu, the "new folder" button
  headerAside?: ReactNode;
  // A second line under the title, such as a project's path and branch
  meta?: ReactNode;
  // Read by screen readers instead of the title and the meta, when they say less than the whole
  label?: string;
  // A top row of a tree (the Código sidebar's projects), its list the row's group
  isTreeItem?: boolean;
  // A conversation is being dragged over it; the label says what dropping does
  dropLabel?: string | null;
  dropZone?: HTMLAttributes<HTMLDivElement>;
  children: ReactNode;
};

export function SidebarSection(props: Props) {
  const { title, icon, count, isOpen, onToggle, spaced = false, isFolder = false, headerAside, dropLabel, dropZone } =
    props;
  const { children, meta, label, isTreeItem = false } = props;
  const { t } = useTranslation();
  // A folder's name is shown as the user wrote it; the app's own sections read better in lowercase here
  const name = isFolder ? t("ui.quotedName", { name: title }) : title.toLowerCase();
  const listId = useId();
  const className = ["sidebar-section", spaced && "spaced", isFolder && "folder", headerAside && "has-aside", dropLabel && "is-drop-target"]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} {...dropZone}>
      <div className="sidebar-section-header">
        {onToggle ? (
          <button
            type="button"
            className="section-label sidebar-section-toggle"
            aria-expanded={isOpen}
            aria-controls={listId}
            aria-label={label}
            role={isTreeItem ? "treeitem" : undefined}
            aria-level={isTreeItem ? 1 : undefined}
            title={isOpen ? t("ui.hideSection", { name }) : t("ui.showSection", { name })}
            onClick={onToggle}
          >
            {icon}
            {meta ? (
              <span className="sidebar-section-title-group">
                <span className="sidebar-section-title">{title}</span>
                <span className="sidebar-section-meta">{meta}</span>
              </span>
            ) : (
              <span className="sidebar-section-title">{title}</span>
            )}
            {dropLabel ? (
              <span className="sidebar-section-drop">{dropLabel}</span>
            ) : (
              !isOpen && <span className="sidebar-section-count">{count}</span>
            )}
            {/* Keeps the button's place free, so every chevron stays in the same column */}
            {headerAside && <span className="sidebar-section-aside-space" aria-hidden="true" />}
            <ChevronDown size={14} strokeWidth={2.2} className={`sidebar-section-chevron ${isOpen ? "" : "collapsed"}`} />
          </button>
        ) : (
          <div className="section-label sidebar-section-toggle static">
            {icon}
            <span className="sidebar-section-title">{title}</span>
            <span className="sidebar-section-count">{count}</span>
          </div>
        )}
        {headerAside && <div className="sidebar-section-aside">{headerAside}</div>}
      </div>
      {isOpen && (
        <div id={listId} role="group" aria-label={title} className="sidebar-section-list">
          {children}
        </div>
      )}
    </div>
  );
}
