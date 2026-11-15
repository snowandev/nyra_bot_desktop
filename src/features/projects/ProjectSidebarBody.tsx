import {
  FolderCode,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Plus,
  Search,
  SquareTerminal,
  TriangleAlert,
  X,
} from "lucide-react";
import { type KeyboardEvent, memo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useWorkspacesContext } from "@/features/workspace/workspacesContext";
import { useShortcut } from "@/shared/hooks/useShortcut";
import { errorMessage } from "@/shared/lib/errors";
import { platformName } from "@/shared/lib/platform";
import { SHORTCUTS, shortcutLabelOf } from "@/shared/lib/shortcuts";
import { loadCollapsedSections, saveCollapsedSections } from "@/shared/storage/settings";
import type { Conversation } from "@/shared/types";
import { ConversationRow } from "@/features/conversations/ConversationRow";
import { NameEditor } from "@/shared/ui/NameEditor";
import { SidebarSection } from "@/shared/ui/SidebarSection";
import {
  gitLabel,
  PROJECT_COUNTER_FROM,
  PROJECT_NAME_MAX,
  projectNameError,
  searchProjects,
  shortPath,
} from "./projects";
import type { PendingItem, Project, ProjectStatus } from "./projectStorage";
import { ProjectMenu } from "./ProjectMenu";
import { ProjectRemoveConfirm } from "./ProjectRemoveConfirm";
import { useHomeDir } from "./useHomeDir";
import { moveTreeFocus, useRovingTree } from "./useRovingTree";

type Props = {
  projects: Project[];
  conversations: Conversation[];
  statusOf: (projectId: string) => ProjectStatus | null;
  // The project whose home or conversation is open
  selectedProjectId: string | null;
  activeConversationId: string | null;
  // The conversation Nyra is working in, if any
  busyId?: string | null;
  onAddProject: () => void;
  onOpenProject: (id: string) => void;
  onOpenConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
  // These reject with the reason, shown where the user acted
  onRenameProject: (id: string, name: string) => Promise<void>;
  onRemoveProject: (id: string) => Promise<void>;
  // The project just taken out of the list, while it can still be brought back
  removedProject: Project | null;
  onRestoreProject: (id: string) => Promise<void>;
  onDismissRemoved: () => void;
  onRelocateProject: (project: Project) => void;
  onRevealProject: (project: Project) => void;
  onOpenProjectSkills: (project: Project) => void;
  // Settings cover the sidebar; its shortcut must not fire underneath
  shortcutEnabled: boolean;
  error: string | null;
  // What waits for the user in each project: changes to review and commands waiting for permission
  pendingOf: (projectId: string) => PendingItem[];
};

const projectSection = (id: string) => `project:${id}` as const;
// The rows the arrow keys move through: each project's header, its "new conversation" and its conversations
const TREE_ROWS = ".sidebar-section-toggle, .project-home-row, .conversation-select";

// The Código space's sidebar: each project with its conversations inside, newest first. Drawn again only when what
// it shows changes (see ProjectSidebar).
export const ProjectSidebarBody = memo(function ProjectSidebarBody(props: Props) {
  const { projects, conversations, statusOf, selectedProjectId, activeConversationId, busyId } = props;
  const { onAddProject, onOpenProject, onOpenConversation, onRenameConversation, onDeleteConversation } = props;
  const { onRenameProject, onRemoveProject, onRelocateProject, onRevealProject, onOpenProjectSkills } = props;
  const { removedProject, onRestoreProject, onDismissRemoved } = props;
  const { shortcutEnabled, error, pendingOf } = props;
  const workspaces = useWorkspacesContext();
  const home = useHomeDir();
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(loadCollapsedSections);
  // Read by screen readers after a change that moves things in the list
  const [announcement, setAnnouncement] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  useRovingTree(treeRef, TREE_ROWS);
  const isSearching = !!query.trim();
  const shown = searchProjects(projects, conversations, query);

  useShortcut(
    SHORTCUTS.searchAll,
    () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    },
    { enabled: shortcutEnabled },
  );

  // While searching every project with a match is open, so the matches are in view
  const isOpen = (id: string) => isSearching || !collapsed.includes(projectSection(id));

  function setOpen(id: string, open: boolean) {
    const section = projectSection(id);
    const next = open ? collapsed.filter((s) => s !== section) : [...collapsed, section];
    setCollapsed(next);
    saveCollapsedSections(next);
  }

  async function rename(project: Project, name: string) {
    await onRenameProject(project.id, name);
    setRenaming(null);
    setAnnouncement(t("projects.sidebar.renamed", { name }));
  }

  async function remove(project: Project) {
    setConfirmingRemove(null);
    setActionError(null);
    try {
      await onRemoveProject(project.id);
      setAnnouncement(t("projects.sidebar.removed", { name: project.name }));
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }

  async function restore(project: Project) {
    setActionError(null);
    try {
      await onRestoreProject(project.id);
      setAnnouncement(t("projects.sidebar.restored", { name: project.name }));
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }

  // Moves through the list as a tree: ↑ ↓ between rows, → opens a project or enters it, ← closes it or goes up to it,
  // Enter on a project opens its home, F2 renames it and ⇧F10 or the menu key opens the row's menu
  function onTreeKeyDown(e: KeyboardEvent<HTMLElement>) {
    const target = e.target as HTMLElement;
    if (!target.matches(TREE_ROWS)) return;
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(TREE_ROWS));
    const index = rows.indexOf(target);
    const item = target.closest<HTMLElement>("[data-project-id]");
    const projectId = item?.dataset.projectId;
    const header = item?.querySelector<HTMLElement>(".sidebar-section-toggle");
    const isHeader = target === header;
    const isExpanded = header?.getAttribute("aria-expanded") === "true";
    if (moveTreeFocus(e.key, rows, index)) return e.preventDefault();
    if (e.key === "ArrowRight" && isHeader) {
      if (isExpanded) rows[index + 1]?.focus();
      else target.click();
    } else if (e.key === "ArrowLeft") {
      if (isHeader && isExpanded) target.click();
      else header?.focus();
    } else if (e.key === "Enter" && isHeader && projectId) onOpenProject(projectId);
    else if (e.key === "F2" && isHeader && projectId) setRenaming(projectId);
    else if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
      const row = isHeader ? target.closest(".sidebar-section-header") : target.closest(".conversation-row");
      row?.querySelector<HTMLElement>(".conversation-menu-trigger")?.click();
    } else return;
    e.preventDefault();
  }

  function rowOf(project: Project, inside: Conversation[], index: number) {
    if (renaming === project.id) {
      return (
        <NameEditor
          icon={FolderCode}
          initialName={project.name}
          placeholder={t("projects.sidebar.namePlaceholder")}
          label={t("projects.sidebar.renameLabel")}
          max={PROJECT_NAME_MAX}
          counterFrom={PROJECT_COUNTER_FROM}
          validate={projectNameError}
          onSave={(name) => rename(project, name)}
          onCancel={() => setRenaming(null)}
        />
      );
    }
    if (confirmingRemove === project.id) {
      return (
        <ProjectRemoveConfirm
          name={project.name}
          onCancel={() => setConfirmingRemove(null)}
          onConfirm={() => remove(project)}
        />
      );
    }
    const status = statusOf(project.id);
    const isMissing = !!status?.missing;
    const isReading = !isMissing && workspaces.stateOf(project.path)?.kind === "indexing";
    const git = gitLabel(status?.git ?? null);
    const path = shortPath(project.path, home, platformName === "windows");
    const open = isOpen(project.id);
    const Icon = isMissing ? TriangleAlert : open ? FolderOpen : FolderCode;
    const state = isMissing
      ? t("projects.sidebar.folderGoneState")
      : isReading
        ? t("projects.sidebar.readingState")
        : status?.git?.kind === "repo"
          ? t("projects.sidebar.branchState", { branch: git })
          : git;
    const isHome = project.id === selectedProjectId && !activeConversationId;
    const waiting = pendingOf(project.id);
    const changes = waiting.filter((i) => i.kind === "change").length;
    const commands = waiting.length - changes;
    const signals = [
      changes > 0 && t("projects.sidebar.changes", { count: changes }),
      commands > 0 && t("projects.sidebar.commands", { count: commands }),
    ].filter((text): text is string => !!text);
    return (
      <SidebarSection
        title={project.name}
        icon={<Icon size={14} strokeWidth={2} className={isMissing ? "project-missing-icon" : "accent"} />}
        count={inside.length}
        isOpen={open}
        onToggle={() => setOpen(project.id, !open)}
        isFolder
        isTreeItem
        spaced={index > 0}
        label={[project.name, path, state, ...signals, t("common.conversations", { count: inside.length })]
          .filter(Boolean)
          .join(", ")}
        meta={
          isMissing ? (
            <span className="project-meta-missing">{t("projects.sidebar.folderGone")}</span>
          ) : isReading ? (
            <span>{t("projects.sidebar.reading")}</span>
          ) : (
            <>
              <span className="project-meta-path mono" title={project.path}>
                {path}
              </span>
              {git && (
                <span className="project-meta-branch">
                  {status?.git?.kind === "repo" && <GitBranch size={11} strokeWidth={2} aria-hidden="true" />}
                  {git}
                </span>
              )}
              {changes > 0 && (
                <span className="project-signal change" title={signals[0]}>
                  <i aria-hidden="true" />
                  {changes}
                </span>
              )}
              {commands > 0 && (
                <span className="project-signal command" title={signals[signals.length - 1]}>
                  <SquareTerminal size={10} strokeWidth={2.2} aria-hidden="true" />
                  {commands}
                </span>
              )}
            </>
          )
        }
        headerAside={
          <ProjectMenu
            name={project.name}
            isMissing={isMissing}
            onNewConversation={() => onOpenProject(project.id)}
            onRelocate={() => onRelocateProject(project)}
            onRename={() => setRenaming(project.id)}
            onReveal={() => onRevealProject(project)}
            onOpenSkills={() => onOpenProjectSkills(project)}
            onRemove={() => setConfirmingRemove(project.id)}
          />
        }
      >
        {!isSearching && !isMissing && (
          <button
            type="button"
            className={`conversation-item project-home-row ${isHome ? "active" : ""}`}
            aria-current={isHome ? "page" : undefined}
            role="treeitem"
            aria-level={2}
            aria-selected={isHome}
            title={project.path}
            onClick={() => onOpenProject(project.id)}
          >
            <Plus size={14} strokeWidth={2} aria-hidden="true" />
            {t("conversations.new")}
          </button>
        )}
        {inside.map((c) => (
          <ConversationRow
            key={c.id}
            conversation={c}
            isActive={c.id === activeConversationId}
            isBusy={c.id === busyId}
            hasPending={waiting.some((i) => i.conversationId === c.id)}
            treeLevel={2}
            onSelect={() => onOpenConversation(c.id)}
            onRename={(title) => onRenameConversation(c.id, title)}
            onDelete={() => onDeleteConversation(c.id)}
          />
        ))}
      </SidebarSection>
    );
  }

  return (
    <>

      <button type="button" className="primary-button" onClick={onAddProject}>
        <FolderPlus size={18} strokeWidth={2} />
        {t("projects.sidebar.newProject")}
        <span className="visually-hidden">{t("projects.sidebar.newProjectHint")}</span>
      </button>

      {projects.length > 0 && (
        <label className="search">
          <Search size={16} strokeWidth={2} />
          <span className="visually-hidden">{t("projects.sidebar.searchLabel")}</span>
          <input
            ref={searchRef}
            type="search"
            placeholder={t("projects.sidebar.search")}
            title={t("projects.sidebar.searchHint", { shortcut: shortcutLabelOf(SHORTCUTS.searchAll) })}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}

      <nav aria-label={t("projects.sidebar.nav")} className="conversation-nav" onKeyDown={onTreeKeyDown}>
        {projects.length === 0 && (
          <p className="project-sidebar-empty">
            <Trans i18nKey="projects.sidebar.empty" components={{ strong: <strong /> }} />
          </p>
        )}
        {shown.length > 0 && (
          <div ref={treeRef} role="tree" aria-label={t("projects.sidebar.tree")} className="project-tree">
            {shown.map(({ project, conversations: inside }, index) => (
              <div
                key={project.id}
                className={`project-tree-item ${statusOf(project.id)?.missing ? "missing" : ""}`}
                data-project-id={project.id}
              >
                {rowOf(project, inside, index)}
              </div>
            ))}
          </div>
        )}
        {isSearching && shown.length === 0 && <p className="empty-hint">{t("conversations.noResults")}</p>}
      </nav>

      {removedProject && (
        <div className="project-undo" role="status">
          <span>{t("projects.sidebar.undoNotice", { name: removedProject.name })}</span>
          <button type="button" className="link-button" onClick={() => restore(removedProject)}>
            {t("projects.sidebar.undo")}
          </button>
          <button
            type="button"
            className="icon-button small"
            aria-label={t("projects.sidebar.closeNotice")}
            onClick={onDismissRemoved}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      )}

      <span className="visually-hidden" role="status">
        {announcement}
      </span>

      {(error || actionError) && (
        <p role="alert" className="sidebar-error">
          {error ? t("projects.sidebar.readError", { error }) : actionError}
        </p>
      )}
    </>
  );
});
