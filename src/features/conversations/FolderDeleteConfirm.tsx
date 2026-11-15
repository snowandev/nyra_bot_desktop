import { Trans, useTranslation } from "react-i18next";
import { InlineConfirm } from "@/shared/ui/InlineConfirm";

type Props = {
  name: string;
  conversationCount: number;
  onCancel: () => void;
  onConfirm: () => void;
};

// In place of the folder's header
export function FolderDeleteConfirm({ name, conversationCount, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  return (
    <InlineConfirm
      className="folder-confirm"
      actionsClassName="folder-confirm-actions"
      title={
        <Trans
          i18nKey="conversations.folder.deleteTitle"
          values={{ name }}
          components={{ name: <span className="folder-confirm-name" /> }}
        />
      }
      confirmLabel={t("conversations.folder.deleteConfirm")}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <p>
        <Trans
          i18nKey="conversations.folder.keeps"
          count={conversationCount}
          components={{ strong: <strong /> }}
        />
      </p>
    </InlineConfirm>
  );
}
