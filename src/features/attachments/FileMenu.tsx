import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ActionMenu } from "@/shared/ui/ActionMenu";

type Props = {
  fileName: string;
  // The message the file was sent with, or the reply Nyra wrote it in
  onShowMessage: () => void;
};

// The "⋯" of a file in the Files panel, like the one of each conversation in the sidebar
export function FileMenu({ fileName, onShowMessage }: Props) {
  const { t } = useTranslation();
  return (
    <ActionMenu
      label={t("attachments.row.menu", { name: fileName })}
      className="file-menu"
      items={[{ icon: MessageSquare, label: t("attachments.row.showMessage"), onSelect: onShowMessage }]}
    />
  );
}
