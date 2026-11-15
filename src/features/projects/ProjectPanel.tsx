import { AtSign, ChevronLeft, FileStack, Folder, GitBranch, X } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { LazyAttachmentViewer } from "@/features/attachments/LazyAttachmentViewer";
import { useWorkspaceFiles } from "@/features/workspace/useWorkspaceFiles";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import { marksOf } from "./fileTree";
import { SHORTCUTS, shortcutLabelOf } from "@/shared/lib/shortcuts";
import type { Conversation } from "@/shared/types";
import { FilesTab } from "./FilesTab";
import { GitDiffViewer } from "./GitDiffViewer";
import { GitTab } from "./GitTab";
import { PendingList } from "./PendingList";
import type { GitChange, PendingItem, Project, ProjectStatus } from "./projectStorage";
import { useGitChanges } from "./useGitChanges";

export type PanelTab = "files" | "git" | "pending";

type Props = {
  project: Project;
  status: ProjectStatus | null;
  // The project's conversation that is open, if any
  conversation: Conversation | null;
  conversations: Conversation[];
  pending: PendingItem[];
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  // Folded into icons with their counts, when the review needs the room
  folded: boolean;
  onUnfold: (tab: PanelTab) => void;
  // Over the chat, in a narrow window: "‹ Chat" goes back to it
  covering: boolean;
  onClose: () => void;
  // Files a conversation of the project changed with Nyra
  changedByNyra: Set<string>;
  // A file with a change to review in the open conversation opens in that review (true); otherwise in the viewer
  onReviewFile: (path: string) => boolean;
  // «Mencionar en el mensaje» of the viewer
  onMentionFile: (path: string) => void;
  onOpenPending: (item: PendingItem) => void;
  onPrepareCommit?: () => void;
  onInitGit: () => void;
  onRelocate: () => void;
};

// Their names are in the catalog, under panel.tabs.<tab>
const TABS: PanelTab[] = ["files", "git", "pending"];

// Next to a project's conversation or home: its files, its Git and what waits for the user in any of its conversations
export function ProjectPanel(props: Props) {
  const { project, status, conversation, conversations, pending, tab, onTabChange, folded, onUnfold } = props;
  const { covering, onClose, changedByNyra, onReviewFile, onMentionFile, onOpenPending, onPrepareCommit } = props;
  const { onInitGit, onRelocate } = props;
  const { t } = useTranslation();
  // A file of the folder open in the viewer, read from the disk when opened
  const files = useWorkspaceFiles();
  const [viewedPath, setViewedPath] = useState<string | null>(null);
  // Folding the panel (a review takes its room) closes the file it showed, so it doesn't come back on unfolding
  const [wasFolded, setWasFolded] = useState(folded);
  if (wasFolded !== folded) {
    setWasFolded(folded);
    if (folded && files.file) files.close();
  }

  // Stable, so the file tree isn't drawn again on every word of a reply being written
  const chooseFile = useStableCallback((path: string) => {
    if (onReviewFile(path)) return;
    setViewedPath(path);
    void files.open(project.path, path);
  });
  const marks = conversation ? marksOf(conversation) : null;

  function mentionViewed() {
    files.close();
    if (viewedPath) onMentionFile(viewedPath);
  }
  const isMissing = !!status?.missing;
  const git = status?.git ?? null;
  const isRepo = git?.kind === "repo" && !isMissing;
  const gitChanges = useGitChanges(project.path, isRepo && (tab === "git" || folded), changedByNyra.size);
  const [diff, setDiff] = useState<GitChange | null>(null);
  const gitCount = gitChanges.total;
  // Over the chat, Escape goes back to it once whatever opened on top of the panel (a diff, the viewer) is closed
  useEscapeKey(onClose, covering && !folded);

  const count = (which: PanelTab) =>
    which === "git" ? (isRepo && gitChanges.changes ? gitCount : null) : which === "pending" ? pending.length : null;

  if (folded) {
    return (
      <nav className="project-panel-rail" aria-label={t("panel.folded")}>
        <button
          type="button"
          className="icon-button"
          aria-label={t("panel.tabs.files")}
          title={t("panel.tabs.files")}
          onClick={() => onUnfold("files")}
        >
          <Folder size={17} strokeWidth={1.9} />
        </button>
        {isRepo && (
          <button
            type="button"
            className="icon-button"
            aria-label={t("panel.gitChanged", { count: gitCount })}
            title={t("panel.tabs.git")}
            onClick={() => onUnfold("git")}
          >
            <GitBranch size={17} strokeWidth={1.9} />
            {gitCount > 0 && <span className="project-panel-rail-count">{gitCount}</span>}
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label={t("panel.pendingCount", { count: pending.length })}
          title={t("panel.tabs.pending")}
          onClick={() => onUnfold("pending")}
        >
          <FileStack size={17} strokeWidth={1.9} />
          {pending.length > 0 && <span className="project-panel-rail-count accent">{pending.length}</span>}
        </button>
      </nav>
    );
  }

  // ← → move between the tabs, as in any tab list
  function onTabsKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const index = TABS.indexOf(tab);
    const next = TABS[(index + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    onTabChange(next);
    e.currentTarget.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
    e.preventDefault();
  }

  return (
    <aside className={`project-panel ${covering ? "covering" : ""}`} aria-label={t("panel.label", { name: project.name })}>
      <div className="project-panel-head">
        {covering && (
          <button type="button" className="ghost-button" onClick={onClose}>
            <ChevronLeft size={16} strokeWidth={2} />
            {t("projects.space.chat")}
          </button>
        )}
        <div className="project-panel-tabs" role="tablist" aria-label={t("panel.tabsLabel")} onKeyDown={onTabsKeyDown}>
          {TABS.map((value) => {
            const n = count(value);
            return (
              <button
                key={value}
                type="button"
                role="tab"
                id={`project-panel-tab-${value}`}
                aria-selected={tab === value}
                aria-controls="project-panel-body"
                tabIndex={tab === value ? 0 : -1}
                data-tab={value}
                onClick={() => onTabChange(value)}
              >
                {t(`panel.tabs.${value}`)}
                {n !== null && n > 0 && (
                  <span className={`project-panel-count ${value === "pending" ? "accent" : ""}`}>{n}</span>
                )}
              </button>
            );
          })}
        </div>
        {!covering && (
          <button
            type="button"
            className="icon-button small"
            aria-label={t("panel.close")}
            title={t("panel.closeWithShortcut", { shortcut: shortcutLabelOf(SHORTCUTS.projectPanel) })}
            onClick={onClose}
          >
            <X size={15} strokeWidth={2} />
          </button>
        )}
      </div>
      <div
        className="project-panel-body"
        id="project-panel-body"
        role="tabpanel"
        aria-labelledby={`project-panel-tab-${tab}`}
      >
        {isMissing && tab !== "pending" ? (
          <div className="project-panel-state warning" role="alert">
            <strong>{t("panel.missingTitle")}</strong>
            <Trans
              i18nKey="panel.missingBody"
              values={{ path: project.path }}
              components={{ path: <span className="mono" /> }}
            />
            <button type="button" className="outline-button small" onClick={onRelocate}>
              {t("panel.findFolder")}
            </button>
          </div>
        ) : tab === "files" ? (
          <>
            {files.error && (
              <p className="project-panel-state warning" role="alert">
                {files.error}
              </p>
            )}
            <FilesTab key={project.id} project={project} marks={marks} onChooseFile={chooseFile} />
          </>
        ) : tab === "git" ? (
          <GitTab
            git={git}
            changes={gitChanges.changes}
            total={gitChanges.total}
            error={gitChanges.error}
            changedByNyra={changedByNyra}
            onRefresh={() => void gitChanges.refresh()}
            onOpenDiff={setDiff}
            onPrepareCommit={onPrepareCommit}
            onInitGit={onInitGit}
          />
        ) : pending.length > 0 ? (
          <PendingList
            items={pending}
            conversations={conversations}
            openConversationId={conversation?.id ?? null}
            onOpen={onOpenPending}
          />
        ) : (
          <div className="project-panel-state">
            <strong>{t("panel.nothingPendingTitle")}</strong>
            {t("panel.nothingPendingBody", { name: project.name })}
          </div>
        )}
      </div>
      {diff && <GitDiffViewer root={project.path} change={diff} onClose={() => setDiff(null)} />}
      {files.file && (
        <LazyAttachmentViewer
          attachment={files.file}
          onClose={files.close}
          actions={
            <button type="button" className="outline-button small" onClick={mentionViewed}>
              <AtSign size={14} strokeWidth={2} />
              {t("panel.mention")}
            </button>
          }
        />
      )}
    </aside>
  );
}
