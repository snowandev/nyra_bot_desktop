import { Check, ChevronDown, ChevronRight, Eye, File, Folder, FolderOpen, Info } from "lucide-react";
import type { TFunction } from "i18next";
import { type KeyboardEvent, memo, useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useWorkspacesContext } from "@/features/workspace/workspacesContext";
import { whenRendered } from "@/shared/lib/whenRendered";
import { buildTree, type FileMarks, foldersHolding, onlyMarked, sameMarks, type TreeRow, visibleRows } from "./fileTree";
import type { Project } from "./projectStorage";
import { useRovingTree } from "./useRovingTree";
import { scrollRowIntoView, useRowsInView } from "./useRowsInView";

type Props = {
  project: Project;
  // What the open conversation did with each file; null on the project's home, where nothing is marked
  marks: Map<string, FileMarks> | null;
  // Enter or a click on a file: open it in the viewer, or its review if it has a change to review
  onChooseFile: (path: string) => void;
};

const ROWS = ".project-files-row";
// Every row has this height (project-files-row), so where each one is can be worked out without drawing it
const ROW_HEIGHT = 28;

// The project's folder as a tree, with what the open conversation read, proposed changing and changed. Drawn again
// only when what it shows changes: not on every word of a reply being written.
export const FilesTab = memo(function FilesTab({ project, marks: conversationMarks, onChooseFile }: Props) {
  const workspaces = useWorkspacesContext();
  const { t } = useTranslation();
  const state = workspaces.stateOf(project.path);
  const { refresh } = workspaces;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [onlyThisConversation, setOnlyThisConversation] = useState(false);
  const files = state?.kind === "ready" ? state.files : null;
  const tree = useMemo(() => (files ? buildTree(files.map((f) => f.path)) : []), [files]);
  const marks = useMemo(() => conversationMarks ?? new Map<string, FileMarks>(), [conversationMarks]);
  const markedFolders = useMemo(() => foldersHolding(marks), [marks]);
  const filtering = onlyThisConversation && !!conversationMarks;
  const shown = useMemo(() => (filtering ? onlyMarked(tree, marks) : tree), [filtering, tree, marks]);
  const flat = useMemo(
    () => visibleRows(shown, (path) => filtering || expanded.has(path)),
    [shown, filtering, expanded],
  );
  const treeRef = useRef<HTMLUListElement>(null);
  useRovingTree(treeRef, ROWS);
  const { first, last } = useRowsInView(treeRef, flat.length, ROW_HEIGHT);

  useEffect(() => {
    if (!state) void refresh(project.path);
  }, [state, refresh, project.path]);

  function toggle(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  // A row may be far from what is drawn: the panel scrolls to it first, then it gets the focus once drawn
  function focusRow(index: number) {
    const row = flat[index];
    if (!row) return;
    scrollRowIntoView(treeRef, index, ROW_HEIGHT);
    whenRendered(
      () => treeRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(row.node.path)}"]`),
      (element) => element.focus(),
    );
  }

  // ↑ ↓ Home End move between rows, → opens a folder or enters it, ← closes it or goes up to it. Worked out on the
  // rows themselves, not on what is drawn, so they also reach those out of view.
  function onKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    const target = e.target as HTMLElement;
    if (!target.matches(ROWS)) return;
    const index = flat.findIndex((row) => row.node.path === target.dataset.path);
    const row = flat[index];
    if (!row) return;
    const isOpen = !!row.node.children && (filtering || expanded.has(row.node.path));
    const parent = row.node.path.split("/").slice(0, -1).join("/");
    if (e.key === "ArrowDown") focusRow(index + 1);
    else if (e.key === "ArrowUp") focusRow(index - 1);
    else if (e.key === "Home") focusRow(0);
    else if (e.key === "End") focusRow(flat.length - 1);
    else if (e.key === "ArrowRight" && row.node.children) {
      if (isOpen) focusRow(index + 1);
      else toggle(row.node.path);
    } else if (e.key === "ArrowLeft" && isOpen) toggle(row.node.path);
    else if (e.key === "ArrowLeft" && parent) focusRow(flat.findIndex((r) => r.node.path === parent));
    else return;
    e.preventDefault();
  }

  if (!state || state.kind === "indexing") {
    return (
      <p className="project-panel-state" role="status">
        {t("panel.files.reading")}
      </p>
    );
  }
  if (state.kind !== "ready") {
    return (
      <p className="project-panel-state" role="status">
        {state.kind === "empty" ? t("panel.files.empty") : t("panel.files.unreadable")}
      </p>
    );
  }

  function rowOf({ node, level }: TreeRow) {
    if (node.children) {
      const open = filtering || expanded.has(node.path);
      const holdsMarked = !open && markedFolders.has(node.path);
      return (
        <li key={node.path} role="none">
          <button
            type="button"
            className="project-files-row folder"
            role="treeitem"
            aria-level={level}
            aria-expanded={open}
            aria-label={t(holdsMarked ? "panel.files.folderWithMarked" : "panel.files.folder", { name: node.name })}
            data-path={node.path}
            style={{ paddingLeft: 4 + (level - 1) * 14 }}
            onClick={() => toggle(node.path)}
          >
            {open ? <ChevronDown size={13} strokeWidth={2} /> : <ChevronRight size={13} strokeWidth={2} />}
            {open ? <FolderOpen size={14} strokeWidth={1.8} /> : <Folder size={14} strokeWidth={1.8} />}
            <span className="project-files-name">{node.name}</span>
            {holdsMarked && <span className="project-files-dot" aria-hidden="true" />}
          </button>
        </li>
      );
    }
    const nodeMarks = marks.get(node.path);
    return (
      <li key={node.path} role="none">
        <button
          type="button"
          className={`project-files-row ${nodeMarks ? "touched" : ""}`}
          role="treeitem"
          aria-level={level}
          aria-label={[node.name, ...describe(nodeMarks, t)].join(", ")}
          data-path={node.path}
          title={node.path}
          style={{ paddingLeft: 22 + (level - 1) * 14 }}
          onClick={() => onChooseFile(node.path)}
        >
          <File size={14} strokeWidth={1.8} />
          <span className="project-files-name">{node.name}</span>
          <span className="project-files-marks" aria-hidden="true">
            {nodeMarks?.read && <Eye size={12} strokeWidth={2} className="mark-read" />}
            {nodeMarks?.proposed && <i className="mark-proposed" />}
            {nodeMarks?.applied && <Check size={13} strokeWidth={2.4} className="mark-applied" />}
          </span>
        </button>
      </li>
    );
  }

  return (
    <div className="project-files">
      {conversationMarks && (
        <>
          <div className="segmented small wide" role="group" aria-label={t("panel.files.which")}>
            <button type="button" aria-pressed={!onlyThisConversation} onClick={() => setOnlyThisConversation(false)}>
              {t("panel.files.all")}
            </button>
            <button type="button" aria-pressed={onlyThisConversation} onClick={() => setOnlyThisConversation(true)}>
              {t("panel.files.thisConversation")}
            </button>
          </div>
          <p className="project-files-legend" aria-hidden="true">
            <span>{t("panel.files.legend")}</span>
            <span>
              <Eye size={12} strokeWidth={2} className="mark-read" />
              {t("panel.files.read")}
            </span>
            <span>
              <i className="mark-proposed" />
              {t("panel.files.proposed")}
            </span>
            <span>
              <Check size={12} strokeWidth={2.4} className="mark-applied" />
              {t("panel.files.applied")}
            </span>
          </p>
        </>
      )}
      {shown.length > 0 ? (
        <ul
          ref={treeRef}
          className="project-files-tree"
          role="tree"
          aria-label={t("panel.files.treeLabel", { name: project.name })}
          onKeyDown={onKeyDown}
        >
          {/* Only the rows in view are drawn; the space of the others keeps the scroll as long as the whole tree */}
          {first > 0 && <li role="none" aria-hidden="true" style={{ height: first * ROW_HEIGHT }} />}
          {flat.slice(first, last).map(rowOf)}
          {last < flat.length && (
            <li role="none" aria-hidden="true" style={{ height: (flat.length - last) * ROW_HEIGHT }} />
          )}
        </ul>
      ) : (
        <p className="project-panel-state">{t("panel.files.untouched")}</p>
      )}
      {state.truncated && (
        <p className="project-panel-note">{t("panel.files.truncated")}</p>
      )}
      <p className="project-panel-note">
        <Info size={13} strokeWidth={2} aria-hidden="true" />
        <span>
          <Trans i18nKey="panel.files.enterHint" components={{ kbd: <kbd /> }} />
        </span>
      </p>
    </div>
  );
}, sameFilesTab);

function sameFilesTab(before: Props, after: Props) {
  if (before.project !== after.project || before.onChooseFile !== after.onChooseFile) return false;
  if (before.marks === after.marks) return true;
  return !!before.marks && !!after.marks && sameMarks(before.marks, after.marks);
}

function describe(marks: FileMarks | undefined, t: TFunction) {
  if (!marks) return [];
  return [
    marks.read && t("panel.files.readHere"),
    marks.proposed && t("panel.files.proposedHere"),
    marks.applied && t("panel.files.appliedHere"),
  ].filter((text): text is string => !!text);
}
