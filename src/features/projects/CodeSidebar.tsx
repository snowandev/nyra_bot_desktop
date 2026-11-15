import type { ReactNode } from "react";
import type { SidebarFold } from "@/features/conversations/useSidebarFold";
import { useShortcut } from "@/shared/hooks/useShortcut";
import { SHORTCUTS } from "@/shared/lib/shortcuts";
import { whenRendered } from "@/shared/lib/whenRendered";
import { ProjectRail } from "./ProjectRail";
import { ProjectSidebar } from "./ProjectSidebar";
import { SidebarDrawer } from "./SidebarDrawer";
import type { CodeSpace } from "./useCodeSpace";

type Props = {
  code: CodeSpace;
  // Folded by the user, as in Chat
  fold: SidebarFold;
  // The Chat / Código switch, upright for the folded sidebar
  spaceSwitch: (vertical: boolean) => ReactNode;
  // The project conversation shown, if any, and the one Nyra is working in
  activeConversationId: string | null;
  busyId: string | null;
  onOpenConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
  onOpenSettings: () => void;
  onOpenModels: () => void;
  shortcutEnabled: boolean;
  storageError: string | null;
};

// The Código sidebar: whole, or folded into icons by the user or, with the whole one as a drawer, when the window
// needs the room
export function CodeSidebar(props: Props) {
  const { code, fold, spaceSwitch, activeConversationId, busyId, onOpenConversation } = props;
  const { onRenameConversation, onDeleteConversation, onOpenSettings, onOpenModels, shortcutEnabled } = props;
  const { storageError } = props;
  const { projects, selectedProject, status } = code;
  const needsRoom = code.layout.sidebarFolded;
  const isFolded = needsRoom || fold.isFolded;

  // Folded for the room, the search is in the drawer: the shortcut opens it with the cursor in the search
  useShortcut(
    SHORTCUTS.searchAll,
    () => {
      code.setIsDrawerOpen(true);
      whenRendered(
        () => document.querySelector<HTMLInputElement>(".sidebar-drawer input[type='search']"),
        (search) => search.focus(),
      );
    },
    { enabled: shortcutEnabled && needsRoom && !code.isDrawerOpen },
  );

  function closeDrawer() {
    code.setIsDrawerOpen(false);
    code.drawerButtonRef.current?.focus();
  }

  const sidebar = (
    <ProjectSidebar
      projects={projects.projects}
      conversations={code.conversations}
      statusOf={status.statusOf}
      selectedProjectId={selectedProject?.id ?? null}
      activeConversationId={activeConversationId}
      busyId={busyId}
      onAddProject={code.add}
      onOpenProject={code.openById}
      onOpenConversation={onOpenConversation}
      onRenameConversation={onRenameConversation}
      onDeleteConversation={onDeleteConversation}
      onRenameProject={projects.rename}
      onRemoveProject={code.remove}
      removedProject={code.removedProject}
      onRestoreProject={code.restore}
      onDismissRemoved={code.dismissRemoved}
      onRelocateProject={code.relocate}
      onRevealProject={code.reveal}
      onOpenProjectSkills={(project) => code.setSkillsProjectId(project.id)}
      onOpenSettings={onOpenSettings}
      onOpenModels={onOpenModels}
      // Shown over the chat for the room, folding it back is closing it
      onFold={needsRoom ? closeDrawer : fold.fold}
      shortcutEnabled={shortcutEnabled}
      error={projects.error ?? code.error ?? storageError}
      spaceSwitch={spaceSwitch(false)}
      pendingOf={code.pendingOf}
    />
  );

  if (!isFolded) return sidebar;
  return (
    <>
      <ProjectRail
        projects={projects.projects}
        statusOf={status.statusOf}
        pendingCount={(id) => code.pendingOf(id).length}
        selectedProjectId={selectedProject?.id ?? null}
        isDrawerOpen={code.isDrawerOpen}
        onOpenDrawer={() => code.setIsDrawerOpen(true)}
        onUnfold={needsRoom ? null : fold.unfold}
        drawerButtonRef={code.drawerButtonRef}
        onOpenProject={code.openById}
        onAddProject={code.add}
        onOpenSettings={onOpenSettings}
        spaceSwitch={spaceSwitch(true)}
      />
      {code.isDrawerOpen && (
        <SidebarDrawer onClose={closeDrawer}>
          {sidebar}
        </SidebarDrawer>
      )}
    </>
  );
}
