import { Folder, FolderOpen } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { Folder as FolderData } from "./folderStorage";
import { FolderMenu } from "./FolderMenu";
import { SidebarSection } from "@/shared/ui/SidebarSection";

type Props = {
  folder: FolderData;
  // Conversations shown inside: those matching the search, and never the pinned ones
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
  isDropTarget: boolean;
  dropZone: HTMLAttributes<HTMLDivElement>;
  children: ReactNode;
};

export function FolderSection(props: Props) {
  const { folder, count, isOpen, onToggle, onRename, onDelete, isDropTarget, dropZone, children } = props;
  const Icon = isOpen ? FolderOpen : Folder;
  const { t } = useTranslation();

  return (
    <SidebarSection
      title={folder.name}
      icon={<Icon size={14} strokeWidth={2} className="accent" />}
      count={count}
      isOpen={isOpen}
      onToggle={onToggle}
      isFolder
      headerAside={<FolderMenu name={folder.name} onRename={onRename} onDelete={onDelete} />}
      dropLabel={isDropTarget ? t("conversations.folder.moveHere") : null}
      dropZone={dropZone}
    >
      {count > 0 ? (
        children
      ) : (
        <p className="folder-empty">
          <Trans i18nKey="conversations.folder.empty" components={{ strong: <strong /> }} />
        </p>
      )}
    </SidebarSection>
  );
}
