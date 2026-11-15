import { Trans, useTranslation } from "react-i18next";
import { InlineConfirm } from "@/shared/ui/InlineConfirm";

type Props = {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
};

// In place of the project's header
export function ProjectRemoveConfirm({ name, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  return (
    <InlineConfirm
      className="folder-confirm"
      actionsClassName="folder-confirm-actions"
      title={
        <Trans
          i18nKey="projects.remove.title"
          values={{ name }}
          components={{ name: <span className="folder-confirm-name" /> }}
        />
      }
      confirmLabel={t("projects.remove.confirm")}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <p>
        <Trans i18nKey="projects.remove.body" components={{ strong: <strong /> }} />
      </p>
    </InlineConfirm>
  );
}
