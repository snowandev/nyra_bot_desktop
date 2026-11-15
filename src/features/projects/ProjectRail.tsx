import { PanelLeftOpen, Plus, Settings } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { SHORTCUTS, shortcutLabelOf } from "@/shared/lib/shortcuts";
import type { Project, ProjectStatus } from "./projectStorage";

type Props = {
  projects: Project[];
  statusOf: (projectId: string) => ProjectStatus | null;
  // How many changes to review and commands waiting there are in each project
  pendingCount: (projectId: string) => number;
  selectedProjectId: string | null;
  isDrawerOpen: boolean;
  onOpenDrawer: () => void;
  // Folded by the user with room for the whole sidebar: it unfolds from the bottom corner, where it was folded,
  // instead of opening as a drawer
  onUnfold: (() => void) | null;
  // Focus goes back to it when the drawer closes
  drawerButtonRef: RefObject<HTMLButtonElement | null>;
  onOpenProject: (id: string) => void;
  onAddProject: () => void;
  onOpenSettings: () => void;
  // The Chat / Código switch, upright
  spaceSwitch: ReactNode;
};

// The first two letters stand for the project, as on a folded sidebar there is only room for an icon
const initialsOf = (name: string) => Array.from(name.trim()).slice(0, 2).join("").toUpperCase();

// The Código sidebar folded into icons, by the user or for a narrow window, where the bottom button opens the whole
// sidebar as a drawer
export function ProjectRail(props: Props) {
  const { projects, statusOf, pendingCount, selectedProjectId, isDrawerOpen, onOpenDrawer, drawerButtonRef } = props;
  const { onUnfold, onOpenProject, onAddProject, onOpenSettings, spaceSwitch } = props;
  const { t } = useTranslation();

  return (
    <nav className="sidebar-rail" aria-label={t("projects.rail.label")}>
      {spaceSwitch}
      <span className="sidebar-rail-separator" aria-hidden="true" />
      <div className="project-rail-projects">
        {projects.map((p) => {
          const isMissing = !!statusOf(p.id)?.missing;
          const waiting = pendingCount(p.id);
          return (
            <button
              key={p.id}
              type="button"
              className={`project-rail-item ${isMissing ? "missing" : ""}`}
              aria-current={p.id === selectedProjectId ? "true" : undefined}
              aria-label={[
                p.name,
                isMissing && t("projects.rail.folderGone"),
                waiting > 0 && t("projects.rail.pending", { count: waiting }),
              ]
                .filter(Boolean)
                .join(", ")}
              title={p.name}
              onClick={() => onOpenProject(p.id)}
            >
              {initialsOf(p.name)}
              {waiting > 0 && <span className="project-rail-dot" aria-hidden="true" />}
            </button>
          );
        })}
        <button
          type="button"
          className="icon-button"
          aria-label={t("projects.sidebar.newProject")}
          title={t("projects.sidebar.newProject")}
          onClick={onAddProject}
        >
          <Plus size={18} strokeWidth={2} />
        </button>
      </div>
      <button
        type="button"
        className="icon-button"
        aria-label={t("settings.title")}
        title={t("conversations.settingsWithShortcut", { shortcut: shortcutLabelOf(SHORTCUTS.settings) })}
        onClick={onOpenSettings}
      >
        <Settings size={18} strokeWidth={1.8} />
      </button>
      {/* At the bottom corner, as in the Chat space: it unfolds the sidebar, or in a narrow window opens it as a drawer */}
      {onUnfold ? (
        <button
          type="button"
          className="icon-button sidebar-unfold"
          aria-label={t("conversations.sidebar.unfold")}
          title={t("conversations.sidebar.unfoldWithShortcut", { shortcut: shortcutLabelOf(SHORTCUTS.sidebar) })}
          onClick={onUnfold}
        >
          <PanelLeftOpen size={18} strokeWidth={2} />
        </button>
      ) : (
        <button
          ref={drawerButtonRef}
          type="button"
          className="icon-button sidebar-unfold"
          aria-label={t("projects.rail.showSidebar")}
          aria-expanded={isDrawerOpen}
          title={t("projects.rail.showSidebar")}
          onClick={onOpenDrawer}
        >
          <PanelLeftOpen size={18} strokeWidth={2} />
        </button>
      )}
    </nav>
  );
}
