import { GitBranch, Info, RefreshCw } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { shownPath } from "./projects";
import type { GitChange, GitState } from "./projectStorage";
import { splitPath } from "@/shared/lib/paths";

type Props = {
  git: GitState | null;
  changes: GitChange[] | null;
  // All the changed files; the list stops at a few hundred
  total: number;
  error: string | null;
  // Files a conversation of the project changed with Nyra
  changedByNyra: Set<string>;
  onRefresh: () => void;
  onOpenDiff: (change: GitChange) => void;
  // Missing when the project's "Commit y descripción de PR" skill is off
  onPrepareCommit?: () => void;
  onInitGit: () => void;
};

// The repository at a glance: the branch, the commits not pushed and each changed file with its lines
export function GitTab(props: Props) {
  const { git, changes, total, error, changedByNyra, onRefresh, onOpenDiff, onPrepareCommit, onInitGit } = props;
  const { t } = useTranslation();
  if (git?.kind === "unavailable") {
    return (
      <div className="project-panel-state">
        <strong>{t("git.unavailableTitle")}</strong>
        {t("git.unavailableBody")}
      </div>
    );
  }
  if (git?.kind === "notTrusted") {
    return (
      <div className="project-panel-state">
        <strong>{t("git.notTrustedTitle")}</strong>
        <Trans i18nKey="git.notTrustedBody" components={{ cmd: <span className="mono" /> }} />
      </div>
    );
  }
  if (git?.kind !== "repo") {
    return (
      <div className="project-panel-state">
        <strong>{t("git.notRepoTitle")}</strong>
        {t("git.notRepoBody")}
        <button type="button" className="outline-button small" onClick={onInitGit}>
          {t("git.init")}
        </button>
      </div>
    );
  }
  return (
    <div className="git-tab">
      <div className="git-branch">
        <GitBranch size={16} strokeWidth={2} aria-hidden="true" />
        <strong>{git.branch}</strong>
        <small>
          {git.ahead ? t("git.ahead", { count: git.ahead }) : git.ahead === 0 ? t("git.upToDate") : ""}
        </small>
        <button type="button" className="icon-button small" aria-label={t("git.refresh")} onClick={onRefresh}>
          <RefreshCw size={14} strokeWidth={2} />
        </button>
      </div>
      <div className="project-panel-subtitle">
        <span>{t("git.changes")}</span>
        <span className="project-panel-count">{total}</span>
      </div>
      {error && (
        <p className="project-panel-state" role="alert">
          {error}
        </p>
      )}
      {changes === null ? (
        <p className="project-panel-state" role="status">
          {t("git.reading")}
        </p>
      ) : changes.length === 0 ? (
        <p className="project-panel-state">{t("git.noChanges")}</p>
      ) : (
        <ul className="git-list">
          {changes.map((change) => {
            const { name, folder } = splitPath(shownPath(change.path));
            const byNyra = changedByNyra.has(change.path);
            const lines =
              change.added === null
                ? t("git.linesUncounted")
                : `${t("git.linesAdded", { count: change.added })}, ${t("git.linesRemoved", { count: change.removed ?? 0 })}`;
            const label = { name, folder, status: t(`git.status.${change.status}`), lines };
            return (
              <li key={change.path}>
                <button
                  type="button"
                  className="git-file"
                  aria-label={
                    t(folder ? "git.fileInFolderLabel" : "git.fileLabel", label) + (byNyra ? t("git.changedByNyra") : "")
                  }
                  onClick={() => onOpenDiff(change)}
                >
                  <span className={`git-status ${change.status}`} aria-hidden="true">
                    {change.status}
                  </span>
                  <span className="git-file-text">
                    <strong>{name}</strong>
                    <small>
                      {folder}
                      {byNyra && (
                        <>
                          {folder && " · "}
                          <span className="git-by-nyra">{t("git.byNyra")}</span>
                        </>
                      )}
                    </small>
                  </span>
                  <span className="git-lines" aria-hidden="true">
                    {!!change.added && <span className="added">+{change.added}</span>}
                    {!!change.removed && <span className="removed">−{change.removed}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {changes && total > changes.length && (
        <p className="project-panel-note">
          {t("git.showingFirst", { shown: changes.length, total })}
        </p>
      )}
      <p className="project-panel-note">
        <Info size={13} strokeWidth={2} aria-hidden="true" />
        <span>{t("git.legend")}</span>
      </p>
      {onPrepareCommit && (
        <button type="button" className="outline-button project-panel-wide-button" onClick={onPrepareCommit}>
          <span className="project-skills-diamond" aria-hidden="true">
            ✦
          </span>
          {t("git.prepareCommit")}
        </button>
      )}
    </div>
  );
}
