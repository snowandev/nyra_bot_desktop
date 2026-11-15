import type { SendOptions } from "@/features/chat/reply/useChat";
import type { Attachment, Model } from "@/shared/types";
import { CodeWelcome } from "./CodeWelcome";
import { ProjectHome } from "./ProjectHome";
import type { CodeSpace } from "./useCodeSpace";

type Props = {
  code: CodeSpace;
  models: Model[];
  selectedModelId: string;
  onSend: (text: string, attachments: Attachment[], references: string[], options: SendOptions) => void;
  onOpenConversation: (id: string) => void;
  onOpenSettings: () => void;
  onManageSkills: () => void;
  onOpenFeatureSettings: () => void;
  shortcutsEnabled: boolean;
  isBusy: boolean;
};

// What the Código space shows with no conversation open: the project's home, or how to start before the first one
export function CodeHome(props: Props) {
  const { code, models, selectedModelId, onSend, onOpenConversation, onOpenSettings, onManageSkills } = props;
  const { onOpenFeatureSettings, shortcutsEnabled, isBusy } = props;
  const project = code.selectedProject;
  if (!project) return code.projects.isLoaded ? <CodeWelcome onAddProject={code.add} /> : null;
  return (
    <ProjectHome
      key={project.id}
      project={project}
      status={code.status.statusOf(project.id)}
      onRelocate={() => code.relocate(project)}
      onRemove={() => code.report(code.remove(project.id))}
      onInitGit={() => code.initGit(project)}
      onOpenSkills={() => code.setSkillsProjectId(project.id)}
      pending={code.pendingOf(project.id)}
      onOpenPending={code.openPending}
      conversations={code.projectConversations}
      models={models}
      selectedModelId={selectedModelId}
      onSelectModel={(id) => code.chooseModel(project, id)}
      onSend={onSend}
      onOpenConversation={onOpenConversation}
      onReveal={() => code.reveal(project)}
      onOpenSettings={onOpenSettings}
      onManageSkills={onManageSkills}
      onOpenFeatureSettings={onOpenFeatureSettings}
      shortcutsEnabled={shortcutsEnabled}
      isBusy={isBusy}
    />
  );
}
