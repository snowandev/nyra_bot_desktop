import { Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "@/shared/lib/errors";
import { SettingsPanel } from "@/shared/ui/SettingsPanel";

type Props = {
  conversationCount: number;
  onDeleteAll: () => Promise<void>;
};

type Status = "idle" | "confirming" | "deleting" | "deleted";

export function DataSettings({ conversationCount, onDeleteAll }: Props) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const isEmpty = conversationCount === 0;

  async function deleteAll() {
    setStatus("deleting");
    setError(null);
    try {
      await onDeleteAll();
      setStatus("deleted");
    } catch (e) {
      setError(errorMessage(e));
      setStatus("idle");
    }
  }

  return (
    <SettingsPanel title={t("settings.general.data")} description={t("settings.data.description")}>
      <div className="setting-row">
        <div className="setting-row-text">
          <span className="setting-row-title">{t("settings.data.deleteAll")}</span>
          <span className="setting-row-description">
            {status === "deleted"
              ? t("settings.data.deleted")
              : isEmpty
                ? t("settings.data.empty")
                : t("settings.data.deletes", { count: conversationCount })}
          </span>
          {error && <span className="setting-row-error">{t("settings.data.couldNotDelete", { error })}</span>}
        </div>
        {status !== "confirming" && (
          <button
            type="button"
            className="primary-button danger padded"
            disabled={isEmpty || status === "deleting"}
            onClick={() => setStatus("confirming")}
          >
            <Trash2 size={16} strokeWidth={2} />
            {status === "deleting" ? t("settings.data.deleting") : t("settings.data.deleteAllButton")}
          </button>
        )}
      </div>

      {status === "confirming" && (
        <div role="alertdialog" aria-labelledby="delete-all-title" className="danger-confirm">
          <div className="danger-confirm-header">
            <TriangleAlert size={18} strokeWidth={2} />
            <span id="delete-all-title" className="danger-confirm-title">
              {t("settings.data.confirm", { count: conversationCount })}
            </span>
          </div>
          <p className="danger-confirm-text">{t("settings.data.confirmText")}</p>
          <div className="danger-confirm-actions">
            <button type="button" className="ghost-button" onClick={() => setStatus("idle")}>
              {t("common.cancel")}
            </button>
            <button type="button" className="primary-button danger padded" onClick={deleteAll}>
              {t("settings.data.confirmButton")}
            </button>
          </div>
        </div>
      )}
    </SettingsPanel>
  );
}
