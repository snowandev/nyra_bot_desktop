import { Trash2, TriangleAlert } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { formatStorage } from "@/shared/lib/format";
import { InlineConfirm } from "@/shared/ui/InlineConfirm";
import type { InstalledModel } from "@/providers/ollamaModels";

type Props = {
  model: InstalledModel;
  // "este equipo" or "el equipo 192.168.1.20": it may not be this computer's disk
  place: string;
  isDefault: boolean;
  // What new conversations will use instead, when the default is deleted
  nextDefault: string | null;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

// In place of the model's row
export function ModelDeleteConfirm(props: Props) {
  const { model, place, isDefault, nextDefault, isDeleting, onCancel, onConfirm } = props;
  const { t } = useTranslation();
  const size = formatStorage(model.size);
  return (
    <InlineConfirm
      as="li"
      className="model-delete-confirm"
      actionsClassName="model-delete-actions"
      small
      isBusy={isDeleting}
      title={
        <Trans
          i18nKey="models.deleteConfirm.title"
          values={{ name: model.name }}
          components={{ name: <span className="mono" /> }}
        />
      }
      confirmLabel={
        <>
          <Trash2 size={13} strokeWidth={2} />
          {isDeleting ? t("models.deleteConfirm.deleting") : t("models.deleteConfirm.confirm", { size })}
        </>
      }
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <p>
        <Trans i18nKey="models.deleteConfirm.body" values={{ place, size }} components={{ strong: <strong /> }} />
      </p>
      {isDefault && (
        <div className="model-delete-default">
          <TriangleAlert size={15} strokeWidth={2} />
          <span>
            <strong>{t("models.deleteConfirm.isDefault")}</strong>{" "}
            {nextDefault ? (
              <Trans
                i18nKey="models.deleteConfirm.nextDefault"
                values={{ name: nextDefault }}
                components={{ name: <span className="mono" /> }}
              />
            ) : (
              t("models.deleteConfirm.noneLeft")
            )}
          </span>
        </div>
      )}
    </InlineConfirm>
  );
}
