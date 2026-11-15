import { Settings } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  onOpenNyra: () => void;
};

// Before any model is set up: the bar can't answer, and Nyra's Settings is one click away
export function QuickNoModel({ onOpenNyra }: Props) {
  const { t } = useTranslation();
  return (
    <div className="quick-no-model">
      <span className="quick-no-model-text">
        <b>{t("quick.noModelTitle")}</b>
        <small>{t("quick.noModelHint")}</small>
      </span>
      <button type="button" className="quick-button primary" onClick={onOpenNyra}>
        <Settings size={14} strokeWidth={2} aria-hidden="true" />
        {t("quick.openNyra")}
      </button>
    </div>
  );
}
