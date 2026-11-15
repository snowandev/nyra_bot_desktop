import { FolderMinus, FolderSearch, Pencil, Plus, Search, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { revealLabel } from "@/shared/lib/platform";
import { SHORTCUTS, shortcutLabelOf } from "@/shared/lib/shortcuts";
import { ActionMenu, type ActionMenuItem } from "@/shared/ui/ActionMenu";

type Props = {
  name: string;
  // The folder isn't where it was: instead of working in it, it can be looked for
  isMissing: boolean;
  onNewConversation: () => void;
  onRelocate: () => void;
  onRename: () => void;
  onReveal: () => void;
  onOpenSkills: () => void;
  onRemove: () => void;
};

export function ProjectMenu(props: Props) {
  const { name, isMissing, onNewConversation, onRelocate, onRename, onReveal, onOpenSkills, onRemove } = props;
  const { t } = useTranslation();
  const items: ActionMenuItem[] = [
    isMissing
      ? { icon: Search, label: t("projects.menu.findFolder"), onSelect: onRelocate }
      : {
          icon: Plus,
          label: t("conversations.new"),
          onSelect: onNewConversation,
          shortcut: shortcutLabelOf(SHORTCUTS.newConversation),
        },
    { icon: Pencil, label: t("conversations.menu.rename"), onSelect: onRename, shortcut: "F2" },
    ...(isMissing ? [] : [{ icon: FolderSearch, label: revealLabel(), onSelect: onReveal }]),
    { icon: Sparkles, label: t("projects.menu.skills"), onSelect: onOpenSkills },
    {
      icon: FolderMinus,
      label: (
        <span className="conversation-menu-label">
          {t("projects.menu.remove")}
          <span className="project-menu-hint">{t("projects.menu.removeHint")}</span>
        </span>
      ),
      onSelect: onRemove,
      separated: true,
    },
  ];
  return <ActionMenu label={t("projects.menu.actionsOf", { name })} className="folder-menu" items={items} />;
}
