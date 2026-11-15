import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  fileCount: number | null;
};

export function DropOverlay({ fileCount }: Props) {
  const { t } = useTranslation();
  return (
    <div className="drop-overlay">
      <div className="drop-target" role="status" aria-live="polite">
        <div className="drop-emblem" aria-hidden="true">
          <span className="drop-emblem-ring outer" />
          <span className="drop-emblem-ring inner" />
          <Download size={34} strokeWidth={1.8} className="drop-emblem-icon" />
        </div>
        <div>
          <div className="drop-title">{t("attachments.drop.title")}</div>
          <div className="drop-subtitle">{t("attachments.drop.subtitle")}</div>
        </div>
        <span className="drop-count">
          {fileCount ? t("attachments.drop.count", { count: fileCount }) : t("attachments.drop.files")}
        </span>
      </div>
    </div>
  );
}
