import { useCallback, useMemo, useRef, useState } from "react";
import type { PendingRequest } from "@/features/chat/ChatView";
import type { useChat } from "@/features/chat/reply/useChat";
import type { useProviderSettings } from "@/features/models/useProviderSettings";
import type { useWorkspaces } from "@/features/workspace/useWorkspaces";
import { appendToDraft } from "@/shared/hooks/useDraft";
import { useShortcut } from "@/shared/hooks/useShortcut";
import { errorMessage } from "@/shared/lib/errors";
import { SHORTCUTS } from "@/shared/lib/shortcuts";
import { focusComposer } from "@/shared/lib/whenRendered";
import {
  loadLastProject,
  loadSpace,
  saveLastProject,
  type Space,
} from "@/shared/storage/settings";
import { codeSkillOf, enabledCodeSkills, projectDefaultSkills, taskSendOptions } from "./codeSkills";
import {
  byProject,
  conversationsOf,
  folderOf,
  preferredModelOf,
  sortProjects,
} from "./projects";
import { initProjectGit, type PendingItem, type Project } from "./projectStorage";
import { useCodeLayout } from "./useCodeLayout";
import { useProjects } from "./useProjects";
import { useProjectsPending } from "./useProjectsPending";
import { useProjectStatus } from "./useProjectStatus";

type Options = {
  chat: ReturnType<typeof useChat>;
  settings: ReturnType<typeof useProviderSettings>;
  workspaces: ReturnType<typeof useWorkspaces>;
  // Names of the installed skills, to know which Código skills a project can use
  installedSkills: string[];
  // The skills marked by default in a new conversation of a code project
  defaultSkills: string[];
  space: Space;
  isSettingsOpen: boolean;
  // Shows the Código space (not Settings); the hook then opens what it needs in it
  onShowSpace: () => void;
  // Opens a conversation in its space, as the rest of the app does
  openConversation: (id: string) => void;
};

export type CodeSpace = ReturnType<typeof useCodeSpace>;

// Everything the Código space keeps and does: its projects, the one open, their state, the panel, what is pending and
// the actions on them. The app only moves between spaces and shows what this says.
export function useCodeSpace(options: Options) {
  const { chat, settings, workspaces, installedSkills, defaultSkills, space, isSettingsOpen } = options;
  const { onShowSpace, openConversation } = options;
  // Opening on a project's home, it starts with the project's model as if the user had just gone there
  const projects = useProjects(workspaces.pick, (list) => {
    const project = list.find((p) => p.id === loadLastProject()) ?? sortProjects(list)[0];
    const preferred = project && preferredModelOf(project, settings.models);
    if (loadSpace() === "code" && preferred) settings.showModel(preferred);
  });
  const [projectId, setProjectId] = useState<string | null>(loadLastProject);
  const [error, setError] = useState<string | null>(null);
  const status = useProjectStatus(projects.projects, space === "code" ? projectId : null);
  // Just taken out of the list, while "Deshacer" can still bring it back
  const [removedProject, setRemovedProject] = useState<Project | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const layout = useCodeLayout(isReviewing);
  const [pendingRequest, setPendingRequest] = useState<PendingRequest | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  // The drawer belongs to the folded sidebar: once the window has room again it closes, and it doesn't come back open
  // the next time the sidebar folds
  const [wasFolded, setWasFolded] = useState(layout.sidebarFolded);
  if (wasFolded !== layout.sidebarFolded) {
    setWasFolded(layout.sidebarFolded);
    if (!layout.sidebarFolded) setIsDrawerOpen(false);
  }
  const drawerButtonRef = useRef<HTMLButtonElement>(null);
  // The project whose "Skills del proyecto" dialog is open
  const [skillsProjectId, setSkillsProjectId] = useState<string | null>(null);

  const selectedProject = projects.projects.find((p) => p.id === projectId) ?? projects.projects[0] ?? null;
  // Only what is listed: a removed project's conversations stay hidden with it
  const conversationsByProject = useMemo(() => byProject(chat.conversations, (c) => c.projectId), [chat.conversations]);
  const conversations = projects.projects.flatMap((p) => conversationsByProject.get(p.id) ?? []);
  const isConversationShown = !!chat.active && space === "code" && !!chat.active.projectId;
  const shownConversation = isConversationShown ? chat.active : null;
  const projectConversations = (selectedProject && conversationsByProject.get(selectedProject.id)) || [];
  const pending = useProjectsPending(projects.projects.map((p) => p.id).join(), chat.conversations);
  const pendingByProject = useMemo(() => byProject(pending, (item) => item.projectId), [pending]);
  const pendingOf = useCallback((id: string) => pendingByProject.get(id) ?? [], [pendingByProject]);
  const enabledSkillsOf = (project: Project) => enabledCodeSkills(project.disabledSkills, installedSkills);

  // Any failure of an action is shown in the sidebar, where projects are managed
  const report = (promise: Promise<unknown>) => void promise.catch((e) => setError(errorMessage(e)));

  useShortcut(SHORTCUTS.projectPanel, layout.togglePanel, { enabled: !isSettingsOpen && space === "code" });

  const isListed = (id: string | null | undefined) => !!id && projects.projects.some((p) => p.id === id);

  function select(id: string) {
    setProjectId(id);
    saveLastProject(id);
  }

  // Its home, where a new conversation of the project starts with the project's model
  function openHome(project: Project) {
    select(project.id);
    const preferred = preferredModelOf(project, settings.models);
    if (preferred) settings.showModel(preferred);
    else settings.selectDefaultModel();
    onShowSpace();
    setIsDrawerOpen(false);
    chat.openConversation(null);
  }

  function openById(id: string) {
    const project = projects.projects.find((p) => p.id === id);
    if (project) openHome(project);
  }

  async function add() {
    setError(null);
    try {
      const project = await projects.add();
      if (project) openHome(project);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function remove(id: string) {
    const project = projects.projects.find((p) => p.id === id) ?? null;
    await projects.remove(id);
    setRemovedProject(project);
    if (chat.active?.projectId === id) chat.openConversation(null);
  }

  // "Deshacer" stays until the project is really back, so a failure can be tried again
  async function restore(id: string) {
    const project = await projects.restore(id);
    setRemovedProject(null);
    openHome(project);
  }

  // «Buscar la carpeta…»: the project and its conversations follow the folder to its new place
  async function relocate(project: Project) {
    setError(null);
    try {
      const moved = await projects.relocate(project.id);
      if (!moved) return;
      void status.refresh(moved);
      await chat.refreshConversations(conversationsOf(moved.id, chat.conversations).map((c) => c.id));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function initGit(project: Project) {
    await initProjectGit(project.path);
    await status.refresh(project);
  }

  function reveal(project: Project) {
    setError(null);
    report(workspaces.reveal(project.path));
  }

  // Picking a model on a project's home also makes it the project's; a failed save only loses the preference
  function chooseModel(project: Project, modelId: string) {
    settings.selectModel(modelId);
    report(projects.setModel(project.id, modelId));
  }

  // From the panel or a home: the conversation opens with the change in its review, or the command in view
  function openPending(item: PendingItem) {
    if (layout.panelMode === "covering") layout.closePanel();
    openConversation(item.conversationId);
    setPendingRequest((previous) => ({
      id: (previous?.id ?? 0) + 1,
      conversationId: item.conversationId,
      kind: item.kind,
      itemId: item.id,
    }));
  }

  // A file of the panel with a change to review in the open conversation opens in that review; false lets the panel
  // open it in the viewer
  function reviewFile(path: string) {
    const change = pending.find(
      (i) => i.kind === "change" && i.label === path && i.conversationId === shownConversation?.id,
    );
    if (change) openPending(change);
    return !!change;
  }

  // «Mencionar en el mensaje» of the viewer: "@path" goes at the end of the message being written, and its content
  // goes with the message
  function mentionFile(path: string) {
    if (!selectedProject) return;
    if (layout.panelMode === "covering") layout.closePanel();
    appendToDraft(shownConversation?.id ?? `project:${selectedProject.id}`, `@${path} `);
    focusComposer();
  }

  // «Preparar un commit» of the Git tab: a new conversation of the project with that task and the project's model
  function prepareCommit(project: Project) {
    const enabled = enabledSkillsOf(project);
    const task = enabled.find((s) => s.name === "commit-and-pr");
    if (!task?.prompt || chat.isStreaming || chat.isSummarizing) return;
    openHome(project);
    const names = projectDefaultSkills(defaultSkills, project.disabledSkills, installedSkills);
    const preferred = settings.models.find((m) => m.id === preferredModelOf(project, settings.models));
    chat.send(task.prompt, [], [], { ...taskSendOptions(task, project.id, folderOf(project), names), model: preferred });
  }

  const clearPendingRequest = useCallback(() => setPendingRequest(null), []);
  const { onReviewChange } = layout;
  const reportReview = useCallback(
    (open: boolean) => {
      setIsReviewing(open);
      onReviewChange(open);
    },
    [onReviewChange],
  );

  // What a conversation of a project adds to the chat: the project's skills in the "+" menu, its preferred model, the
  // task's skill in the header and, for a local model in a task of several files, a discreet tip
  function chatViewProps() {
    const active = chat.active;
    const project = active?.projectId ? projects.projects.find((p) => p.id === active.projectId) : null;
    const taskSkill = active?.taskSkill
      ? {
          name: active.taskSkill,
          label: codeSkillOf(active.taskSkill)?.title ?? active.taskSkill,
          onRemove: chat.removeTaskSkill,
        }
      : undefined;
    if (!active || !project) return { taskSkill, onReviewChange: reportReview };
    return {
      taskSkill,
      onReviewChange: reportReview,
      pendingRequest,
      onPendingHandled: clearPendingRequest,
      modelPreference: {
        projectName: project.name,
        modelId: project.model,
        onPrefer: (id: string) => report(projects.setModel(project.id, id)),
      },
    };
  }

  return {
    projects,
    selectedProject,
    conversations,
    projectConversations,
    shownConversation,
    status,
    error,
    report,
    layout,
    pending,
    pendingOf,
    enabledSkillsOf,
    removedProject,
    dismissRemoved: () => setRemovedProject(null),
    isDrawerOpen,
    setIsDrawerOpen,
    drawerButtonRef,
    skillsProjectId,
    setSkillsProjectId,
    isListed,
    select,
    openHome,
    openById,
    add,
    remove,
    restore,
    relocate,
    initGit,
    reveal,
    chooseModel,
    openPending,
    reviewFile,
    mentionFile,
    prepareCommit,
    chatViewProps,
  };
}
