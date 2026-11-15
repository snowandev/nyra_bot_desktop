import { X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { DiffTable } from "@/features/workspace/DiffTable";
import type { DiffRow } from "@/features/workspace/fileChanges";
import { Dialog } from "@/shared/ui/Dialog";
import { errorMessage } from "@/shared/lib/errors";
import { gitDiffRows, newFileRows } from "./gitDiff";
import { shownPath } from "./projects";
import { type GitChange, projectGitDiff } from "./projectStorage";

type Props = {
  root: string;
  change: GitChange;
  onClose: () => void;
};

type Loaded = { rows: DiffRow[]; isNew: boolean } | { unavailable: true } | { error: string };

// A file's difference with the last commit, only to read: to undo something the user asks Nyra, which proposes it
// as a change with its own review
export function GitDiffViewer({ root, change, onClose }: Props) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [view, setView] = useState<"unified" | "split">("unified");
  const titleId = useId();

  useEffect(() => {
    let cancelled = false;
    projectGitDiff(root, change.path, change.status)
      .then((diff) => {
        if (cancelled) return;
        if (diff.unavailable) setLoaded({ unavailable: true });
        else
          setLoaded({ rows: diff.wholeFile ? newFileRows(diff.text) : gitDiffRows(diff.text), isNew: diff.wholeFile });
      })
      .catch((e) => {
        if (!cancelled) setLoaded({ error: errorMessage(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [root, change.path, change.status]);

  return (
    <Dialog onClose={onClose} labelledBy={titleId} className="command-viewer git-diff-viewer">
      <div className="command-viewer-head">
        <span className="title" id={titleId}>
          <span className={`git-status ${change.status}`} aria-hidden="true">
            {change.status}
          </span>
          <span className="mono">{shownPath(change.path)}</span>
          <span className="git-diff-kind">
            {t("git.diff.kind", { status: t(`git.statusTitle.${change.status}`) })}
          </span>
        </span>
        {loaded && "rows" in loaded && !loaded.isNew && (
          <span className="segmented small" role="group" aria-label={t("git.diff.how")}>
            <button type="button" aria-pressed={view === "unified"} onClick={() => setView("unified")}>
              {t("git.diff.unified")}
            </button>
            <button type="button" aria-pressed={view === "split"} onClick={() => setView("split")}>
              {t("git.diff.split")}
            </button>
          </span>
        )}
        <button data-autofocus type="button" className="icon-button small" aria-label={t("git.diff.close")} onClick={onClose}>
          <X size={16} strokeWidth={2} />
        </button>
      </div>
      <div className="git-diff-body">
        {!loaded ? (
          <p className="project-panel-state" role="status">
            {t("git.diff.reading")}
          </p>
        ) : "error" in loaded ? (
          <p className="project-panel-state" role="alert">
            {loaded.error}
          </p>
        ) : "unavailable" in loaded ? (
          <p className="project-panel-state">{t("git.diff.unavailable")}</p>
        ) : loaded.rows.length === 0 ? (
          <p className="project-panel-state">{t("git.diff.noDifference")}</p>
        ) : (
          <DiffTable
            rows={loaded.rows}
            view={loaded.isNew ? "unified" : view}
            currentBlock={-1}
            onExpand={() => {}}
            idPrefix="git-diff"
            isNewFile={loaded.isNew}
          />
        )}
      </div>
    </Dialog>
  );
}
