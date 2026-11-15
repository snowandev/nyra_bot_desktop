import { Activity, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ActiveProcess } from "./processes";
import { ProcessRow } from "./ProcessRow";

type Props = {
  processes: ActiveProcess[];
  onShowMessage: (index: number) => void;
  onClose: () => void;
};

// What still runs in the conversation, however far up its card is: a server left running, a long build
export function ProcessesPanel({ processes, onShowMessage, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <aside aria-label={t("terminal.processes.label")} className="files-panel processes-panel">
      <div className="files-panel-header">
        <div className="files-panel-title">
          <h2>{t("terminal.processes.title")}</h2>
          <span className="pill">{processes.length}</span>
        </div>
        <button type="button" className="icon-button small" aria-label={t("terminal.processes.close")} onClick={onClose}>
          <X size={18} strokeWidth={2} />
        </button>
      </div>
      {processes.length === 0 ? (
        <div className="files-empty">
          <div className="files-empty-icon">
            <span />
            <Activity size={24} strokeWidth={1.8} />
          </div>
          <span className="files-empty-title">{t("terminal.processes.emptyTitle")}</span>
          <span className="files-empty-text">{t("terminal.processes.emptyText")}</span>
        </div>
      ) : (
        <ul className="process-list">
          {processes.map((process) => (
            <ProcessRow key={process.run.id} process={process} onShowMessage={onShowMessage} />
          ))}
        </ul>
      )}
    </aside>
  );
}
