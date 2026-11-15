import type { ComponentProps, ReactNode } from "react";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import { useSidebarConversations } from "./sidebarConversations";
import { SidebarBody } from "./SidebarBody";
import { SidebarShell } from "./SidebarShell";

type Props = ComponentProps<typeof SidebarBody> & {
  onOpenSettings: () => void;
  // Settings → Proveedores, from the downloads indicator
  onOpenModels: () => void;
  // The Chat / Código switch
  spaceSwitch: ReactNode;
  onFold: () => void;
};

// While a reply is written the whole window is drawn on every frame. The list is drawn again only when what it shows
// changes: its actions always call the latest ones the app passed, so skipping a frame never leaves an old one.
export function Sidebar(props: Props) {
  const { onOpenSettings, onOpenModels, spaceSwitch, conversations, onFold, ...rest } = props;
  const listed = useSidebarConversations(conversations);
  const onSelect = useStableCallback(props.onSelect);
  const onNew = useStableCallback(props.onNew);
  const onDelete = useStableCallback(props.onDelete);
  const onSetPinned = useStableCallback(props.onSetPinned);
  const onRename = useStableCallback(props.onRename);
  const onOpenSearchHit = useStableCallback(props.onOpenSearchHit);
  const onCreateFolder = useStableCallback(props.onCreateFolder);
  const onRenameFolder = useStableCallback(props.onRenameFolder);
  const onDeleteFolder = useStableCallback(props.onDeleteFolder);
  const onMoveConversation = useStableCallback(props.onMoveConversation);
  return (
    <SidebarShell onOpenSettings={onOpenSettings} onOpenModels={onOpenModels} onFold={onFold}>
      {spaceSwitch}
      <SidebarBody
        {...rest}
        conversations={listed}
        onSelect={onSelect}
        onNew={onNew}
        onDelete={onDelete}
        onSetPinned={onSetPinned}
        onRename={onRename}
        onOpenSearchHit={onOpenSearchHit}
        onCreateFolder={onCreateFolder}
        onRenameFolder={onRenameFolder}
        onDeleteFolder={onDeleteFolder}
        onMoveConversation={onMoveConversation}
      />
    </SidebarShell>
  );
}
