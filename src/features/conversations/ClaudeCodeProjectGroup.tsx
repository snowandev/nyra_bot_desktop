import type { ClaudeCodeProject } from "./claudeCode";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/shared/lib/format";

type Props = {
  project: ClaudeCodeProject;
  selected: Set<string>;
  onToggleSession: (id: string) => void;
  onToggleProject: (ids: string[], select: boolean) => void;
};

export function ClaudeCodeProjectGroup({ project, selected, onToggleSession, onToggleProject }: Props) {
  const { t } = useTranslation();
  const ids = project.sessions.map((s) => s.id);
  const selectedCount = ids.filter((id) => selected.has(id)).length;
  const allSelected = selectedCount === ids.length;

  return (
    <section className="import-project" aria-label={t("conversations.import.project", { name: project.name })}>
      <label className="import-project-header">
        <input
          type="checkbox"
          checked={allSelected}
          // Indeterminate has no HTML attribute; it can only be set on the element
          ref={(el) => {
            if (el) el.indeterminate = selectedCount > 0 && !allSelected;
          }}
          onChange={() => onToggleProject(ids, !allSelected)}
        />
        <span className="import-project-text">
          <span className="import-project-name">{project.name}</span>
          <span className="import-project-path mono">{project.path}</span>
        </span>
        <span className="pill">{project.sessions.length}</span>
      </label>
      <ul className="import-session-list">
        {project.sessions.map((session) => (
          <li key={session.id}>
            <label className="import-session">
              <input type="checkbox" checked={selected.has(session.id)} onChange={() => onToggleSession(session.id)} />
              <span className="import-session-title">{session.title}</span>
              {session.status === "imported" && (
                <span className="pill info">{t("conversations.import.statusImported")}</span>
              )}
              {session.status === "continued" && (
                <span className="pill caution" title={t("conversations.import.continuedHint")}>
                  {t("conversations.import.statusContinued")}
                </span>
              )}
              <span className="import-session-meta">
                {formatDate(session.updatedAt)} · {t("conversations.import.messages", { count: session.messageCount })}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
