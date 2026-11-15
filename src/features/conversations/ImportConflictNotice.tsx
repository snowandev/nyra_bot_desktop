import { TriangleAlert } from "lucide-react";
import { type ClaudeCodeSession, progressOf } from "./claudeCode";
import { useTranslation } from "react-i18next";

type Props = {
  sessions: ClaudeCodeSession[];
  onConfirm: () => void;
  onCancel: () => void;
};

export function ImportConflictNotice({ sessions, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  const messages = (count: number) => t("conversations.import.newMessages", { count });
  return (
    <div role="alertdialog" aria-labelledby="import-conflict-title" className="import-conflict">
      <div className="import-conflict-header">
        <TriangleAlert size={18} strokeWidth={2} />
        <span id="import-conflict-title" className="import-conflict-title">
          {t("conversations.import.conflictTitle", { count: sessions.length })}
        </span>
      </div>
      <p className="import-conflict-text">{t("conversations.import.conflictText")}</p>

      <ul className="import-conflict-list">
        {sessions.map((session) => {
          const { inNyra, inClaudeCode } = progressOf(session);
          return (
            <li key={session.id} className="import-conflict-item">
              <span className="import-conflict-name">{session.title}</span>
              <span className="import-conflict-progress">
                {t("conversations.import.progress", {
                  nyra: inNyra > 0 ? messages(inNyra) : t("conversations.import.edited"),
                  claudeCode: inClaudeCode > 0 ? messages(inClaudeCode) : t("conversations.import.unchanged"),
                })}
              </span>
              <span className={`import-conflict-outcome ${inClaudeCode > 0 ? "copy" : "skip"}`}>
                {inClaudeCode > 0 ? t("conversations.import.willCopy") : t("conversations.import.willSkip")}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="import-conflict-actions">
        <button type="button" className="ghost-button" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button type="button" className="primary-button padded" onClick={onConfirm}>
          {t("conversations.import.continue")}
        </button>
      </div>
    </div>
  );
}
