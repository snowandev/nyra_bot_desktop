import { appliedPaths } from "./pending";
import { ProjectPanel } from "./ProjectPanel";
import { ProjectSkillsDialog } from "./ProjectSkillsDialog";
import type { CodeSpace } from "./useCodeSpace";

type Props = {
  code: CodeSpace;
};

// The project panel next to the chat, and the project's skills dialog when it is open
export function CodePanel({ code }: Props) {
  const project = code.selectedProject;
  const skillsProject = code.projects.projects.find((p) => p.id === code.skillsProjectId) ?? null;
  const { layout } = code;
  return (
    <>
      {project && (
        <ProjectPanel
          // Another project starts with its own Git, viewer and diff, never the last one's
          key={`panel:${project.id}`}
          project={project}
          status={code.status.statusOf(project.id)}
          conversation={code.shownConversation}
          conversations={code.projectConversations}
          pending={code.pendingOf(project.id)}
          tab={layout.tab}
          onTabChange={layout.setTab}
          folded={layout.panelMode === "folded"}
          onUnfold={layout.openPanelAt}
          covering={layout.panelMode === "covering"}
          onClose={layout.closePanel}
          changedByNyra={appliedPaths(code.projectConversations)}
          onReviewFile={code.reviewFile}
          onMentionFile={code.mentionFile}
          onOpenPending={code.openPending}
          onPrepareCommit={
            code.enabledSkillsOf(project).some((s) => s.name === "commit-and-pr")
              ? () => code.prepareCommit(project)
              : undefined
          }
          onInitGit={() => code.report(code.initGit(project))}
          onRelocate={() => code.relocate(project)}
        />
      )}
      {skillsProject && (
        <ProjectSkillsDialog
          project={skillsProject}
          hasGit={code.status.statusOf(skillsProject.id)?.git?.kind === "repo"}
          onChange={(names) => code.report(code.projects.setDisabledSkills(skillsProject.id, names))}
          onClose={() => code.setSkillsProjectId(null)}
        />
      )}
    </>
  );
}
