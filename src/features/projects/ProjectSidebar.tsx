import type { ComponentProps, ReactNode } from "react";
import { SidebarShell } from "@/features/conversations/SidebarShell";
import { useSidebarConversations } from "@/features/conversations/sidebarConversations";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import { ProjectSidebarBody } from "./ProjectSidebarBody";

type Props = ComponentProps<typeof ProjectSidebarBody> & {
  onOpenSettings: () => void;
  onOpenModels: () => void;
  // Folding it into icons, or closing it when it is shown as a drawer
  onFold?: () => void;
  // The Chat / Código switch
  spaceSwitch: ReactNode;
};

// While a reply is written the whole window is drawn on every frame. The list is drawn again only when what it shows
// changes: its actions always call the latest ones passed, so skipping a frame never leaves an old one.
export function ProjectSidebar(props: Props) {
  const { onOpenSettings, onOpenModels, onFold, spaceSwitch, conversations, ...rest } = props;
  const listed = useSidebarConversations(conversations);
  const onAddProject = useStableCallback(props.onAddProject);
  const onOpenProject = useStableCallback(props.onOpenProject);
  const onOpenConversation = useStableCallback(props.onOpenConversation);
  const onRenameConversation = useStableCallback(props.onRenameConversation);
  const onDeleteConversation = useStableCallback(props.onDeleteConversation);
  const onRenameProject = useStableCallback(props.onRenameProject);
  const onRemoveProject = useStableCallback(props.onRemoveProject);
  const onRestoreProject = useStableCallback(props.onRestoreProject);
  const onDismissRemoved = useStableCallback(props.onDismissRemoved);
  const onRelocateProject = useStableCallback(props.onRelocateProject);
  const onRevealProject = useStableCallback(props.onRevealProject);
  const onOpenProjectSkills = useStableCallback(props.onOpenProjectSkills);
  return (
    <SidebarShell onOpenSettings={onOpenSettings} onOpenModels={onOpenModels} onFold={onFold}>
      {spaceSwitch}
      <ProjectSidebarBody
        {...rest}
        conversations={listed}
        onAddProject={onAddProject}
        onOpenProject={onOpenProject}
        onOpenConversation={onOpenConversation}
        onRenameConversation={onRenameConversation}
        onDeleteConversation={onDeleteConversation}
        onRenameProject={onRenameProject}
        onRemoveProject={onRemoveProject}
        onRestoreProject={onRestoreProject}
        onDismissRemoved={onDismissRemoved}
        onRelocateProject={onRelocateProject}
        onRevealProject={onRevealProject}
        onOpenProjectSkills={onOpenProjectSkills}
      />
    </SidebarShell>
  );
}
