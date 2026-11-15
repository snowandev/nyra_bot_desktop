import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  onSetUp: () => void;
  onOpenWelcome: () => void;
};

// Above the composer while there is no model to write to: the welcome was skipped, or every provider is gone
export function NoModelsNotice({ onSetUp, onOpenWelcome }: Props) {
  const { t } = useTranslation();
  return (
    <div className="no-models-notice" role="status">
      <TriangleAlert size={17} strokeWidth={2} aria-hidden="true" />
      <span className="no-models-text">
        <b>{t("welcome.noModels.title")}</b> {t("welcome.noModels.text")}
      </span>
      <button type="button" className="primary-button small" onClick={onSetUp}>
        {t("welcome.noModels.setUp")}
      </button>
      <button type="button" className="outline-button small" onClick={onOpenWelcome}>
        {t("welcome.noModels.welcome")}
      </button>
    </div>
  );
}
