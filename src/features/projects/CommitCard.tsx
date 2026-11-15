import { Check, GitCommitHorizontal, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { errorMessage } from "@/shared/lib/errors";
import type { CommitProposal } from "@/shared/types";
import { LoadingButton } from "@/shared/ui/LoadingButton";
import { useWindowFocusRefresh } from "@/shared/hooks/useWindowFocusRefresh";
import { commitTitle } from "./commits";
import { shownPath } from "./projects";
import { type GitChange, projectCommit, projectGitChanges } from "./projectStorage";

type Props = {
  proposal: CommitProposal;
  // The folder the commit is made in
  root: string;
  // Changes when the reply's proposed changes are applied or undone: the files to commit are read again
  changesKey: string;
  onUpdate: (proposal: CommitProposal) => void;
};

// A commit the reply proposed: the user reads and edits its message, unmarks the files that don't belong and makes
// it. Nyra never commits nor pushes on its own.
export function CommitCard({ proposal, root, changesKey, onUpdate }: Props) {
  const { t } = useTranslation();
  const [message, setMessage] = useState(proposal.message);
  const [files, setFiles] = useState<GitChange[] | null>(null);
  const [unmarked, setUnmarked] = useState<Set<string>>(new Set());
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messageId = useId();
  const isPending = proposal.status === "pending";
  // Also after the user edits files in their editor
  const [reads, setReads] = useState(0);
  useWindowFocusRefresh(() => setReads((n) => n + 1), isPending);

  useEffect(() => {
    if (!isPending) return;
    let cancelled = false;
    projectGitChanges(root)
      .then((found) => {
        if (!cancelled) setFiles(found.files);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [isPending, root, changesKey, reads]);

  if (proposal.status === "committed") {
    return (
      <div className="commit-card done" role="status">
        <Check size={16} strokeWidth={2.4} aria-hidden="true" />
        <span>
          <Trans
            i18nKey="git.commit.done"
            values={{ id: proposal.commitId, title: commitTitle(proposal.message) }}
            components={{ id: <span className="mono" /> }}
          />
        </span>
      </div>
    );
  }
  if (proposal.status === "discarded") {
    return (
      <div className="commit-card done discarded">
        <X size={16} strokeWidth={2.4} aria-hidden="true" />
        <span>{t("git.commit.discarded", { title: commitTitle(proposal.message) })}</span>
        <button type="button" className="link-button" onClick={() => onUpdate({ ...proposal, status: "pending" })}>
          {t("git.commit.recover")}
        </button>
      </div>
    );
  }

  const marked = (files ?? []).filter((f) => !unmarked.has(f.path));

  function toggle(path: string) {
    setUnmarked((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function commit() {
    setIsCommitting(true);
    setError(null);
    try {
      const commitId = await projectCommit(
        root,
        message,
        marked.map((f) => f.path),
      );
      onUpdate({ message: message.trim(), status: "committed", commitId });
    } catch (e) {
      setError(errorMessage(e));
      setIsCommitting(false);
    }
  }

  return (
    <section className="commit-card" aria-labelledby={messageId}>
      <div className="commit-card-head">
        <GitCommitHorizontal size={16} strokeWidth={2} aria-hidden="true" />
        <strong id={messageId}>{t("git.commit.proposed")}</strong>
        <small>{t("git.commit.proposedHint")}</small>
      </div>
      <textarea
        className="commit-card-message mono"
        aria-label={t("git.commit.message")}
        value={message}
        rows={Math.min(8, Math.max(3, message.split("\n").length + 1))}
        onChange={(e) => setMessage(e.target.value)}
      />
      {files === null ? (
        !error && (
          <p className="commit-card-note" role="status">
            {t("git.commit.readingChanges")}
          </p>
        )
      ) : files.length === 0 ? (
        <p className="commit-card-note">{t("git.commit.nothingToSave")}</p>
      ) : (
        <fieldset className="commit-card-files">
          <legend>{t("git.commit.files", { count: marked.length })}</legend>
          {files.map((file) => (
            <label key={file.path}>
              <input type="checkbox" checked={!unmarked.has(file.path)} onChange={() => toggle(file.path)} />
              <span className={`git-status ${file.status}`} aria-hidden="true">
                {file.status}
              </span>
              <span className="mono">{shownPath(file.path)}</span>
              <span className="visually-hidden">, {t(`git.status.${file.status}`)}</span>
            </label>
          ))}
        </fieldset>
      )}
      {error && (
        <p className="commit-card-error" role="alert">
          {error}
        </p>
      )}
      <div className="commit-card-actions">
        {isCommitting ? (
          <LoadingButton>{t("git.commit.committing")}</LoadingButton>
        ) : (
          <button
            type="button"
            className="primary-button small"
            disabled={marked.length === 0 || !message.trim()}
            onClick={commit}
          >
            <GitCommitHorizontal size={14} strokeWidth={2.2} />
            {t("git.commit.commit")}
          </button>
        )}
        <button
          type="button"
          className="outline-button small"
          disabled={isCommitting}
          onClick={() => onUpdate({ ...proposal, message, status: "discarded" })}
        >
          {t("git.commit.discard")}
        </button>
      </div>
    </section>
  );
}
