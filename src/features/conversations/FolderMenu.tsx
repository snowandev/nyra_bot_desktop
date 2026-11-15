import { Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActionMenu } from "@/shared/ui/ActionMenu";

type Props = {
  name: string;
  onRename: () => void;
  onDelete: () => void;
};

export function FolderMenu({ name, onRename, onDelete }: Props) {
  const { t } = useTranslation();
  return (
    <ActionMenu
      label={t("conversations.folder.optionsOf", { name })}
      className="folder-menu"
      items={[
        { icon: Pencil, label: t("conversations.folder.rename"), onSelect: onRename },
        { icon: Trash2, label: t("conversations.folder.delete"), onSelect: onDelete, danger: true },
      ]}
    />
  );
}
