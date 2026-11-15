import { FilePen } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  paths: string[];
};

// While the reply arrives: the files it is preparing changes for, without actions until the proposal is complete,
// so nothing half written can be applied
export function PreparingChanges({ paths }: Props) {
  const { t } = useTranslation();
  return (
    <ul className="change-proposals-list preparing" aria-label={t("changes.proposals.preparing")}>
      {paths.map((path, i) => (
        <li key={`${path}-${i}`}>
          <div className="change-card preparing">
            <span className="change-card-icon">
              <span className="workspace-spinner" aria-hidden="true" />
            </span>
            <span className="change-card-text">
              <span className="change-card-path">{path}</span>
              <span className="change-card-meta">
                <FilePen size={12} strokeWidth={2} aria-hidden="true" />
                {t("changes.proposals.preparingDots")}
              </span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
