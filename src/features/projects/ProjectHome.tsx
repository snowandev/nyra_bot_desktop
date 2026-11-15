import { FolderCode, FolderSearch, GitBranch, Info, MessageSquare, Search, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { SendOptions } from "@/features/chat/reply/useChat";
import { Composer } from "@/features/chat/Composer";
import { initRequestOf, messageForNew } from "@/features/chat/reply/commands";
import { useNewConversationSkills } from "@/features/chat/useNewConversationSkills";
import { useSkillsContext } from "@/features/skills/skillsContext";
import { useWorkspacesContext } from "@/features/workspace/workspacesContext";
import { useDraft } from "@/shared/hooks/useDraft";
import { errorMessage } from "@/shared/lib/errors";
import { focusComposer } from "@/shared/lib/whenRendered";
import { platformName, revealLabel } from "@/shared/lib/platform";
import type { Attachment, Conversation, Model } from "@/shared/types";
import { Disclaimer } from "@/shared/ui/Disclaimer";
import { LoadingButton } from "@/shared/ui/LoadingButton";
import {
  type CodeSkill,
  codeSkillOf,
  enabledCodeSkills,
  homeTasks,
  projectDefaultSkills,
  taskSendOptions,
} from "./codeSkills";
import { folderOf, shortPath } from "./projects";
import { PendingList } from "./PendingList";
import type { PendingItem, Project, ProjectStatus } from "./projectStorage";
import { useHomeDir } from "./useHomeDir";

type Props = {
  project: Project;
  status: ProjectStatus | null;
  // The project's conversations, newest first
  conversations: Conversation[];
  models: Model[];
  selectedModelId: string;
  // The model picked here is the one the project's new conversations start with
  onSelectModel: (id: string) => void;
  onSend: (text: string, attachments: Attachment[], references: string[], options: SendOptions) => void;
  onOpenConversation: (id: string) => void;
  onReveal: () => void;
  onRelocate: () => void;
  onRemove: () => void;
  // Rejects with the reason
  onInitGit: () => Promise<void>;
  onOpenSkills: () => void;
  // What waits for the user in the project's conversations
  pending: PendingItem[];
  onOpenPending: (item: PendingItem) => void;
  onOpenSettings: () => void;
  onManageSkills: () => void;
  onOpenFeatureSettings: () => void;
  // Off while Settings cover the screen
  shortcutsEnabled: boolean;
  // Nyra is answering or summarizing elsewhere: a new message waits until it ends
  isBusy: boolean;
};

const RECENT_COUNT = 5;

// A project's home is also where its new conversations start: the first message sent here opens one
export function ProjectHome(props: Props) {
  const { project, status, conversations, models, selectedModelId, onSelectModel, onSend, onOpenConversation } = props;
  const { onReveal, onRelocate, onRemove, onInitGit, onOpenSkills, pending, onOpenPending } = props;
  const { onOpenSettings, onManageSkills, onOpenFeatureSettings, shortcutsEnabled, isBusy } = props;
  const { t } = useTranslation();
  const [draft, setDraft] = useDraft(`project:${project.id}`);
  const { skills, defaultCodeSkillNames } = useSkillsContext();
  const installed = skills.map((s) => s.name);
  const enabled = enabledCodeSkills(project.disabledSkills, installed);
  // A new conversation of the project starts with the code defaults on, so Nyra uses them when a message fits
  const { skillNames, setChosenSkills, isSkillPickerOpen, setIsSkillPickerOpen, invokedSkill } =
    useNewConversationSkills(projectDefaultSkills(defaultCodeSkillNames, project.disabledSkills, installed));
  const invokedTask = codeSkillOf(invokedSkill.skill);
  const workspaces = useWorkspacesContext();
  const home = useHomeDir();
  const [isInitializing, setIsInitializing] = useState(false);
  const [gitError, setGitError] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const recent = conversations.slice(0, RECENT_COUNT);
  const preferred = models.find((m) => m.id === project.model);
  const isMissing = !!status?.missing;
  const git = status?.git ?? null;
  const isReading = workspaces.stateOf(project.path)?.kind === "indexing";
  const meaning = workspaces.meaningOf(project.path);

  const hasGit = git?.kind === "repo";

  // A task that needs nothing else starts at once; one that does waits in the composer with its hint
  function startTask(task: CodeSkill) {
    if ((task.needsGit && !hasGit) || isBusy) return;
    if (task.prompt) {
      onSend(task.prompt, [], [], taskSendOptions(task, project.id, folderOf(project), skillNames));
      return;
    }
    invokedSkill.invoke(task.name);
    focusComposer();
  }

  async function initGit() {
    setIsInitializing(true);
    setGitError(null);
    try {
      await onInitGit();
    } catch (e) {
      setGitError(errorMessage(e));
    } finally {
      setIsInitializing(false);
    }
  }

  // A new conversation of the project with this message; writesGuide: sent with /init
  function start(text: string, attachments: Attachment[], writesGuide: boolean) {
    onSend(text, attachments, [], {
      skills: skillNames,
      skill: invokedSkill.skill ?? undefined,
      // A Código skill chosen here is the task of the new conversation
      taskSkill: invokedTask?.name,
      workspace: folderOf(project),
      projectId: project.id,
      // Even if a conversation is still active behind this screen, the message never goes into it
      newConversation: true,
      ...(writesGuide && { writesGuide }),
    });
    invokedSkill.clear();
    setDraft("");
  }

  return (
    <main className="main" ref={mainRef}>
      <div className="project-home">
        <div className="project-home-column">
          <header className="project-home-header">
            <span className={`project-home-icon ${isMissing ? "missing" : ""}`} aria-hidden="true">
              {isMissing ? <TriangleAlert size={22} strokeWidth={1.8} /> : <FolderCode size={22} strokeWidth={1.8} />}
            </span>
            <div className="project-home-heading">
              <h1>{project.name}</h1>
              <div className="project-home-meta">
                <span className="mono" title={project.path}>
                  {shortPath(project.path, home, platformName === "windows")}
                </span>
                {git?.kind === "repo" && (
                  <span className="project-home-branch">
                    <GitBranch size={13} strokeWidth={2} aria-hidden="true" />
                    <span className="visually-hidden">{t("projects.home.branch")}</span>
                    {git.branch}
                    {!!git.ahead && <small>{t("projects.home.unpushed", { count: git.ahead })}</small>}
                  </span>
                )}
                {git?.kind === "notRepo" && <span className="project-home-tag">{t("projects.home.noGit")}</span>}
                {git?.kind === "notTrusted" && (
                  <span className="project-home-tag" title={t("projects.home.notTrustedHint")}>
                    {t("projects.home.notTrusted")}
                  </span>
                )}
              </div>
              <p className="project-home-model">
                {preferred
                  ? t("projects.home.modelPreferred", { model: preferred.name })
                  : t("projects.home.modelDefault")}{" "}
                {t("projects.home.modelStays")}
              </p>
            </div>
            <div className="project-home-actions">
              {!isMissing && (
                <button type="button" className="ghost-button" onClick={onReveal}>
                  <FolderSearch size={16} strokeWidth={1.8} />
                  {revealLabel()}
                </button>
              )}
              <button type="button" className="outline-button" onClick={onOpenSkills}>
                <span className="project-skills-diamond" aria-hidden="true">
                  ✦
                </span>
                {t("projects.home.skills")}
              </button>
            </div>
          </header>

          {isMissing ? (
            <div className="project-home-notice warning" role="alert">
              <TriangleAlert size={18} strokeWidth={2} aria-hidden="true" />
              <div>
                <p>
                  <Trans
                    i18nKey="projects.home.missing"
                    values={{ path: project.path }}
                    components={{ strong: <strong />, path: <span className="mono" /> }}
                  />
                </p>
                <div className="project-home-notice-actions">
                  <button type="button" className="primary-button" onClick={onRelocate}>
                    <Search size={15} strokeWidth={2} />
                    {t("projects.menu.findFolder")}
                  </button>
                  <button type="button" className="outline-button" onClick={onRemove}>
                    {t("projects.menu.remove")}
                  </button>
                </div>
              </div>
            </div>
          ) : isReading || meaning?.kind === "preparing" ? (
            <div className="project-home-notice" role="status">
              <span className="workspace-spinner" aria-hidden="true" />
              <p>
                {meaning?.kind === "preparing" && meaning.total > 0 ? (
                  <Trans
                    i18nKey="projects.home.readingProgress"
                    values={{ done: meaning.done, total: meaning.total }}
                    components={{ strong: <strong /> }}
                  />
                ) : (
                  <Trans i18nKey="projects.home.reading" components={{ strong: <strong /> }} />
                )}
              </p>
            </div>
          ) : (
            git?.kind === "notRepo" && (
              <div className="project-home-notice">
                <Info size={16} strokeWidth={2} aria-hidden="true" />
                <p>{t("projects.home.notRepo")}</p>
                {isInitializing ? (
                  <LoadingButton>{t("projects.home.initializing")}</LoadingButton>
                ) : (
                  <button type="button" className="outline-button small" onClick={initGit}>
                    {t("projects.home.initRepo")}
                  </button>
                )}
              </div>
            )
          )}
          {gitError && (
            <p className="project-home-error" role="alert">
              {gitError}
            </p>
          )}

          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={(attachments) => {
              // This already is a new conversation: "/new …" sends what follows, and /new alone has nothing to do
              const forGuide = initRequestOf(draft.trim());
              if (forGuide !== null) return start(forGuide || t("commands.init.message"), attachments, true);
              const text = messageForNew(draft.trim()) ?? draft.trim();
              if (!text && attachments.length === 0) return setDraft("");
              start(text, attachments, false);
            }}
            // /init: the new conversation writes the project's NYRA.md
            commands={[
              {
                name: "init",
                run: () => start(t("commands.init.message"), [], true),
                unavailable: isMissing ? t("commands.init.noFolder") : isBusy ? t("commands.init.busy") : undefined,
              },
            ]}
            models={models}
            selectedModelId={selectedModelId}
            onSelectModel={onSelectModel}
            modelPreference={{ projectName: project.name, modelId: project.model }}
            variant="welcome"
            placeholder={
              isMissing
                ? t("projects.home.placeholderMissing")
                : (invokedTask?.hint ??
                  (invokedSkill.skill ? undefined : t("projects.home.placeholder", { name: project.name })))
            }
            isLocked={isMissing || isBusy}
            onOpenSettings={onOpenSettings}
            dropZoneRef={mainRef}
            skillNames={skillNames}
            onChangeSkills={setChosenSkills}
            isSkillPickerOpen={isSkillPickerOpen}
            onSkillPickerOpenChange={setIsSkillPickerOpen}
            onManageSkills={onManageSkills}
            invokedSkill={invokedSkill}
            onOpenFeatureSettings={onOpenFeatureSettings}
            // A missing folder is told above with its actions; the composer's own notice would say it twice
            workspace={isMissing ? undefined : { folder: folderOf(project), isPrivate: false }}
            shortcutsEnabled={shortcutsEnabled}
          />

          {!isMissing && homeTasks(enabled).length > 0 && (
            <section className="project-home-section" aria-labelledby="project-tasks-title">
              <h2 id="project-tasks-title" className="project-home-title">
                {t("projects.home.tasks")}
              </h2>
              <div className="project-tasks">
                {homeTasks(enabled).map((task) => {
                  const withoutGit = !!task.needsGit && !hasGit;
                  return (
                    <button
                      key={task.name}
                      type="button"
                      className="project-task"
                      aria-disabled={withoutGit || undefined}
                      aria-label={t(withoutGit ? "projects.home.taskLabelNeedsGit" : "projects.home.taskLabel", {
                        task: task.task,
                        skill: task.title,
                      })}
                      onClick={() => startTask(task)}
                    >
                      <span className="project-task-icon" aria-hidden="true">
                        <task.icon size={16} strokeWidth={1.9} />
                      </span>
                      <strong>{task.task}</strong>
                      <small>{withoutGit ? t("projects.home.needsGit") : `✦ ${task.title}`}</small>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <div className="project-home-columns">
            <section className="project-home-section" aria-labelledby="project-recent-title">
              <h2 id="project-recent-title" className="project-home-title">
                {t("projects.home.recent")}
              </h2>
              {recent.length > 0 ? (
                <ul className="project-home-list">
                  {recent.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => onOpenConversation(c.id)}>
                        <MessageSquare size={15} strokeWidth={1.8} aria-hidden="true" />
                        <span>{c.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="project-home-empty">{t("projects.home.noConversations")}</p>
              )}
            </section>
            <section className="project-home-section" aria-labelledby="project-pending-title">
              <h2 id="project-pending-title" className="project-home-title">
                {t("projects.home.pending")}
                {pending.length > 0 && <span className="project-panel-count accent">{pending.length}</span>}
              </h2>
              {pending.length > 0 ? (
                <PendingList
                  items={pending}
                  conversations={conversations}
                  openConversationId={null}
                  onOpen={onOpenPending}
                />
              ) : (
                <p className="project-home-empty">{t("projects.home.nothingPending")}</p>
              )}
            </section>
          </div>
        </div>
      </div>
      <Disclaimer />
    </main>
  );
}
