import { Check, Import, LoaderCircle, SquareTerminal } from "lucide-react";
import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ClaudeCodeSession,
  groupByProject,
  importClaudeCodeSessions,
  type ImportResult,
  listClaudeCodeSessions,
} from "./claudeCode";
import { errorMessage } from "@/shared/lib/errors";
import { ClaudeCodeProjectGroup } from "./ClaudeCodeProjectGroup";
import { ErrorNotice } from "@/shared/ui/ErrorNotice";
import { ImportConflictNotice } from "./ImportConflictNotice";
import { LoadingButton } from "@/shared/ui/LoadingButton";
import { SettingsPanel } from "@/shared/ui/SettingsPanel";

type Props = {
  onImported: (conversationIds: string[]) => void;
};

function describeResult({ imported, copied, skipped, keptInChat, unreadPdfs }: ImportResult, t: TFunction) {
  const parts = [];
  if (imported.length > 0) parts.push(t("conversations.import.imported", { count: imported.length }));
  if (copied.length > 0) parts.push(t("conversations.import.copied", { count: copied.length }));
  if (skipped.length > 0) parts.push(t("conversations.import.skipped", { count: skipped.length }));
  if (keptInChat.length > 0) parts.push(t("conversations.import.keptInChat", { count: keptInChat.length }));
  if (unreadPdfs > 0) parts.push(t("conversations.import.unreadPdfs", { count: unreadPdfs }));
  return parts.join(" ");
}

export function ClaudeCodeImport({ onImported }: Props) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<ClaudeCodeSession[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isConfirming, setIsConfirming] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function loadSessions() {
    listClaudeCodeSessions()
      .then(setSessions)
      .catch((e) => setError(errorMessage(e)));
  }

  useEffect(loadSessions, []);

  function toggleSession(id: string) {
    setIsConfirming(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleMany(ids: string[], select: boolean) {
    setIsConfirming(false);
    setSelected((current) => {
      const next = new Set(current);
      ids.forEach((id) => (select ? next.add(id) : next.delete(id)));
      return next;
    });
  }

  async function importSelected() {
    setIsConfirming(false);
    setIsImporting(true);
    setError(null);
    setResult(null);
    try {
      const imported = await importClaudeCodeSessions([...selected]);
      setSelected(new Set());
      setResult(imported);
      onImported([...imported.imported, ...imported.copied]);
      // Statuses and counts changed; reading them again keeps the list honest
      loadSessions();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIsImporting(false);
    }
  }

  const projects = groupByProject(sessions ?? []);
  const allIds = (sessions ?? []).map((s) => s.id);
  const continued = (sessions ?? []).filter((s) => selected.has(s.id) && s.status === "continued");

  return (
    <SettingsPanel
      title="Claude Code"
      label={t("conversations.import.label")}
      description={t("conversations.import.description")}
      badge={sessions && <span className="pill">{sessions.length}</span>}
    >
      {error && <ErrorNotice title={error} />}

      {result && (
        <div role="status" className="notice success">
          <Check size={17} strokeWidth={2.2} />
          {describeResult(result, t)}
        </div>
      )}

      {!sessions && !error && (
        <div role="status" className="import-loading">
          <LoaderCircle size={17} strokeWidth={2.4} className="spin info" />
          {t("conversations.import.searching")}
        </div>
      )}

      {sessions?.length === 0 && (
        <div className="empty-box">
          <SquareTerminal size={26} strokeWidth={1.4} />
          <span className="empty-box-title">{t("conversations.import.noneFound")}</span>
          <span className="empty-box-text">{t("conversations.import.noneFoundHint")}</span>
        </div>
      )}

      {sessions && sessions.length > 0 && (
        <>
          <div className="import-toolbar">
            <span className="field-hint">
              {t("conversations.import.selectedOf", { selected: selected.size, total: sessions.length })}
            </span>
            <button type="button" className="link-button" onClick={() => toggleMany(allIds, true)}>
              {t("conversations.import.selectAll")}
            </button>
            <button type="button" className="link-button" onClick={() => toggleMany(allIds, false)}>
              {t("conversations.import.selectNone")}
            </button>
          </div>

          <div className="import-projects">
            {projects.map((project) => (
              <ClaudeCodeProjectGroup
                key={project.path}
                project={project}
                selected={selected}
                onToggleSession={toggleSession}
                onToggleProject={toggleMany}
              />
            ))}
          </div>

          {isConfirming ? (
            <ImportConflictNotice
              sessions={continued}
              onConfirm={importSelected}
              onCancel={() => setIsConfirming(false)}
            />
          ) : (
            <div>
              {isImporting ? (
                <LoadingButton>{t("conversations.import.importing")}</LoadingButton>
              ) : (
                <button
                  type="button"
                  className="primary-button padded"
                  disabled={selected.size === 0}
                  // Sessions continued in Nyra get a warning first; the rest import straight away
                  onClick={() => (continued.length > 0 ? setIsConfirming(true) : importSelected())}
                >
                  <Import size={17} strokeWidth={2.1} />
                  {t("conversations.import.importCount", { count: selected.size })}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </SettingsPanel>
  );
}
