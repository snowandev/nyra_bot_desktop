import { Folder, FolderPlus } from "lucide-react";
import { FOLDER_COUNTER_FROM, FOLDER_NAME_MAX, folderNameError } from "./folders";
import type { Folder as FolderData } from "./folderStorage";
import { useTranslation } from "react-i18next";
import { NameEditor } from "@/shared/ui/NameEditor";

type Props = {
  mode: "create" | "rename";
  initialName?: string;
  folders: FolderData[];
  // The folder being renamed, so its own name doesn't count as taken
  folderId?: string;
  // Rejects with the reason when the name can't be saved
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
};

// Written in place, where the folder will live
export function FolderNameEditor({ mode, initialName, folders, folderId, onSave, onCancel }: Props) {
  const { t } = useTranslation();
  return (
    <NameEditor
      icon={mode === "create" ? FolderPlus : Folder}
      initialName={initialName}
      placeholder={t("conversations.folder.namePlaceholder")}
      label={mode === "create" ? t("conversations.folder.newNameLabel") : t("conversations.folder.renameLabel")}
      max={FOLDER_NAME_MAX}
      counterFrom={FOLDER_COUNTER_FROM}
      validate={(name, hasTriedToSave) => folderNameError(name, folders, folderId ?? null, hasTriedToSave)}
      onSave={onSave}
      onCancel={onCancel}
    />
  );
}
