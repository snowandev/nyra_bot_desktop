import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ChatSearchRequest, ChatView } from "@/features/chat/ChatView";
import type { GeneralOption } from "@/features/settings/GeneralSettings";
import type { PersonalizationOption } from "@/features/settings/PersonalizationSettings";
import type { SettingsSection } from "@/features/settings/SettingsView";
import { ChatRail } from "@/features/conversations/ChatRail";
import { Sidebar } from "@/features/conversations/Sidebar";
import { useSidebarFold } from "@/features/conversations/useSidebarFold";
import { type NewPrivacy, WelcomeView } from "@/features/chat/WelcomeView";
import { MemoriesContext } from "@/features/memory/memoriesContext";
import { ModelDownloadsContext } from "@/features/models/modelDownloadsContext";
import { PreferencesContext } from "@/features/settings/preferencesContext";
import { ProviderSettingsContext } from "@/features/models/providerSettingsContext";
import { SkillsContext } from "@/features/skills/skillsContext";
import { WorkspacesContext } from "@/features/workspace/workspacesContext";
import { useChat } from "@/features/chat/reply/useChat";
import { useFolders } from "@/features/conversations/useFolders";
import { useMemories } from "@/features/memory/useMemories";
import { useWorkspaces } from "@/features/workspace/useWorkspaces";
import { useModelDownloads } from "@/features/models/useModelDownloads";
import { usePreferences } from "@/features/settings/usePreferences";
import { useProviderSettings } from "@/features/models/useProviderSettings";
import { useQuickBarLink } from "@/features/quick-bar/useQuickBarLink";
import { useQuickShortcut } from "@/features/quick-bar/useQuickShortcut";
import { useShortcut } from "@/shared/hooks/useShortcut";
import { useSkills } from "@/features/skills/useSkills";
import { useTray } from "./useTray";
import { notifyNeedsYou, notifyReplyCompleted } from "@/shared/lib/notifications";
import { SHORTCUTS } from "@/shared/lib/shortcuts";
import { ollama } from "@/providers/ollama";
import type { SearchHit } from "@/features/conversations/conversationStorage";
import { useCodeSpace } from "@/features/projects/useCodeSpace";
import { CodeSidebar } from "@/features/projects/CodeSidebar";
import { CodeHome } from "@/features/projects/CodeHome";
import { CodePanel } from "@/features/projects/CodePanel";
import { SpaceSwitch } from "@/features/projects/SpaceSwitch";
import { preferredModelOf } from "@/features/projects/projects";
import type { CodeSpace } from "@/features/projects/useCodeSpace";
import { ModelOfferDialog } from "@/features/models/ModelOfferDialog";
import { useModelRouting } from "@/features/models/useModelRouting";
import { WelcomeFlow } from "@/features/welcome/WelcomeFlow";
import { NoModelsNotice } from "@/features/welcome/NoModelsNotice";
import { useBrowserAvailable } from "@/features/browser/useBrowserAvailable";
import type { Conversation, Message } from "@/shared/types";
import { useDraftPlaces } from "@/shared/hooks/useDraft";
import { clearQuickLast, loadSpace, releaseFromQuick, saveSpace, type Space } from "@/shared/storage/settings";
import { focusComposer } from "@/shared/lib/whenRendered";
import { retryingLazy } from "@/shared/lib/loadOnDemand";
import { LoadErrorBoundary } from "@/shared/ui/LoadErrorBoundary";
import { useUpdates } from "@/features/updates/useUpdates";
import { UpdatesContext } from "@/features/updates/updatesContext";
import { UpdateDialog } from "@/features/updates/UpdateDialog";

// Settings load the first time they open, not when Nyra starts
const SettingsView = retryingLazy(() => import("@/features/settings/SettingsView").then((m) => m.SettingsView));

// The model that wrote the conversation's last reply, when the reply says which
function lastReplyModelId(messages: Message[]) {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "assistant") return messages[i].modelId;
  return undefined;
}

function App() {
  const { t } = useTranslation();
  const [view, setView] = useState<"chat" | "settings">("chat");
  const [searchRequest, setSearchRequest] = useState<ChatSearchRequest | null>(null);
  // The welcome screen's "Privada" toggle, here so the shortcut can turn it on
  const [newPrivacy, setNewPrivacy] = useState<NewPrivacy>("normal");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [generalOption, setGeneralOption] = useState<GeneralOption | undefined>();
  const [personalizationOption, setPersonalizationOption] = useState<PersonalizationOption | undefined>();
  const [settingsSkill, setSettingsSkill] = useState<string | undefined>();
  const settings = useProviderSettings();
  const preferencesState = usePreferences();
  const { preferences } = preferencesState;
  const skillsState = useSkills();
  const memoriesState = useMemories();
  const { memories, saveFromReply } = memoriesState;
  const memoryTexts = useMemo(() => memories.map((m) => m.text), [memories]);
  // From the icon's menu: a new conversation in Chat, whichever space was open, or one of the recent ones in its space
  useTray(preferences.keepInTray, {
    onNewConversation: () => {
      focusComposer();
      openConversation(null);
    },
    onOpenConversation: (id) => {
      focusComposer();
      openConversation(id);
    },
  });
  useQuickShortcut(preferences.quickShortcutEnabled, preferences.quickShortcut);
  const workspaces = useWorkspaces({
    ollamaConfig: settings.optionsFor(ollama.id),
    meaning: preferences.semanticSearch,
    embeddingModel: preferences.embeddingModel,
  });
  const folders = useFolders();
  const [space, setSpace] = useState<Space>(loadSpace);
  // The conversation each space had open, to find it again when coming back; null is its new-conversation screen
  const lastOpen = useRef<Record<Space, string | null>>({ chat: null, code: null });
  const draftPlaces = useDraftPlaces();
  const updates = useUpdates(preferences.checkUpdates);
  const modelDownloads = useModelDownloads({
    configFor: () => settings.optionsFor(ollama.id),
    // The chat's model list picks up the new model even if Settings is closed. If Ollama can't be reached
    // right now, the list is read again the next time the provider panel opens.
    onFinished: () => settings.refreshProviderModels(ollama.id).catch(() => {}),
  });
  const { routing, mainModel } = useModelRouting(settings);
  // The Código space is set up after the chat, which needs to know each project's own model
  const codeRef = useRef<CodeSpace | null>(null);
  const { models } = settings;
  const pinnedModelFor = useCallback(
    ({ projectId }: Pick<Conversation, "projectId">) => {
      const project = codeRef.current?.projects.projects.find((p) => p.id === projectId);
      const id = project && preferredModelOf(project, models);
      return id ? models.find((m) => m.id === id) : undefined;
    },
    [models],
  );
  const canOpenBrowser = useBrowserAvailable(preferences.browser);
  const chat = useChat({
    model: settings.selectedModel,
    routing,
    mainModel,
    pinnedModelFor,
    configFor: settings.optionsFor,
    personalization: preferences.personalization,
    skills: skillsState.skills,
    webSearch: preferences.webSearch,
    runCommands: preferences.runCommands,
    runCode: preferences.runCode,
    browser: preferences.browser,
    memory: preferences.memory ? { texts: memoryTexts, save: saveFromReply } : null,
    prepareWorkspace: workspaces.prepare,
    pauseMeaning: workspaces.pauseMeaning,
    onWorkspacesReleased: workspaces.forget,
    smartTitles: preferences.smartTitles,
    onReplyCompleted: preferences.notifyOnReply ? notifyOnReply : undefined,
    onCommandNeedsYou: preferences.notifyOnAttention
      ? (need, count) => void notifyNeedsYou(need, count).catch(() => {})
      : undefined,
  });

  // What the views show and measure against: with «Automático», the model the conversation is on (the main one for a
  // new conversation); otherwise the one selected
  const shownModelId = (routing && chat.activeModel?.id) || settings.selectedModelId;

  const isSettingsOpen = view === "settings";
  const code = useCodeSpace({
    chat,
    settings,
    workspaces,
    installedSkills: skillsState.skills.map((s) => s.name),
    defaultSkills: skillsState.defaultCodeSkillNames,
    space,
    isSettingsOpen,
    onShowSpace: () => {
      enterSpace("code");
      setView("chat");
    },
    openConversation: (id) => openConversation(id),
  });
  useLayoutEffect(() => {
    codeRef.current = code;
  });

  // An opened conversation goes on with the model of its last reply, if it is still installed; with «Automático»
  // Nyra picks by itself
  const lastModelId = lastReplyModelId(chat.active?.messages ?? []);
  const restoredFor = useRef<string | null>(null);
  const { isAuto, selectedModelId, showModel } = settings;
  useEffect(() => {
    if (!chat.activeId || chat.isLoading || restoredFor.current === chat.activeId) return;
    restoredFor.current = chat.activeId;
    if (isAuto || !lastModelId || lastModelId === selectedModelId) return;
    if (models.some((m) => m.id === lastModelId)) showModel(lastModelId);
  }, [chat.activeId, chat.isLoading, lastModelId, isAuto, selectedModelId, models, showModel]);

  useQuickBarLink({
    refreshConversations: chat.refreshConversations,
    openConversation: (id) => openConversation(id),
    onShowChat: () => setView("chat"),
  });

  function notifyOnReply() {
    // A failed notification must never interrupt the chat
    notifyReplyCompleted().catch(() => {});
  }

  function openSettings(section: SettingsSection, option?: GeneralOption, skill?: string) {
    setSettingsSection(section);
    setGeneralOption(option);
    setSettingsSkill(skill);
    setPersonalizationOption(undefined);
    setView("settings");
  }
  const openProviderSettings = () => openSettings("providers");
  // Opens by itself only on a new install; Settings → General opens it again
  const [isWelcomeOpen, setIsWelcomeOpen] = useState(() => !preferences.welcomeDone);
  function closeWelcome() {
    setIsWelcomeOpen(false);
    // The model chosen in it is the one the new conversation that follows it uses; one already going keeps its own
    if (!chat.activeId) settings.selectDefaultModel();
    if (!preferences.welcomeDone) preferencesState.updatePreferences({ welcomeDone: true });
  }
  // Without any model the composer can't send: the notice says why and where to set one up
  const noModelsNotice = settings.models.length === 0 && (
    <NoModelsNotice onSetUp={openProviderSettings} onOpenWelcome={() => setIsWelcomeOpen(true)} />
  );
  const openSkillSettings = () => openSettings("skills");
  const openFeatureSettings = () => openSettings("general", "features");
  const openSkill = (name: string) => openSettings("skills", undefined, name);
  function openMemories() {
    openSettings("personalization");
    setPersonalizationOption("memory");
  }

  async function deleteFolder(id: string) {
    await folders.remove(id);
    chat.forgetFolder(id);
  }

  function openSearchHit(hit: SearchHit, query: string) {
    openConversation(hit.conversationId);
    const { conversationId, messageIndex } = hit;
    setSearchRequest((previous) => ({ id: (previous?.id ?? 0) + 1, conversationId, query, messageIndex }));
  }

  // Choosing where to go closes the drawer of a narrow window, as it covers what was chosen
  function enterSpace(next: Space) {
    setSpace(next);
    saveSpace(next);
    code.setIsDrawerOpen(false);
  }

  // A conversation opens in the space it belongs to, wherever it was chosen from (a search, the quick bar)
  function openConversation(id: string | null, privacy: NewPrivacy = "normal") {
    // A new conversation starts normal unless asked to be private
    if (id === null) {
      settings.selectDefaultModel();
      setNewPrivacy(privacy);
      enterSpace("chat");
    } else {
      // The two windows never write to the same conversation: the quick bar starts afresh next time
      releaseFromQuick(id);
      const owner = chat.conversations.find((c) => c.id === id)?.projectId;
      // A project taken out of the list hides its conversations with it until it comes back
      if (owner && !code.isListed(owner)) return;
      if (owner) code.select(owner);
      enterSpace(owner ? "code" : "chat");
    }
    chat.openConversation(id);
    setView("chat");
  }

  const chatConversations = chat.conversations.filter((c) => !c.projectId);
  const isConversationShown = !!chat.active && (space === "code") === !!chat.active.projectId;
  // The folder read again when the user comes back to Nyra
  const shownFolder = isConversationShown ? (chat.active?.workspace?.path ?? null) : null;
  useEffect(() => workspaces.show(shownFolder), [workspaces, shownFolder]);

  // Whether a conversation can still be gone back to: not deleted, and not in a project taken out of the list
  const canReturnTo = (id: string | null) => {
    const conversation = chat.conversations.find((c) => c.id === id);
    return !!conversation && (!conversation.projectId || code.isListed(conversation.projectId));
  };

  // Each space comes back to what it had open, with the cursor in its composer; a conversation deleted meanwhile
  // leaves its new-conversation screen
  function switchSpace(next: Space) {
    if (next === space) return;
    focusComposer();
    lastOpen.current[space] = isConversationShown ? chat.activeId : null;
    const back = lastOpen.current[next];
    if (back && canReturnTo(back)) openConversation(back);
    else if (next === "chat") openConversation(null);
    else if (code.selectedProject) code.openHome(code.selectedProject);
    else {
      enterSpace("code");
      chat.openConversation(null);
    }
  }

  // Deleted here, the quick bar mustn't bring it back from the copy it kept
  function deleteConversation(id: string) {
    releaseFromQuick(id);
    chat.deleteConversation(id);
  }

  function newConversation() {
    if (space === "code" && code.selectedProject) code.openHome(code.selectedProject);
    else openConversation(null);
  }

  // From Settings too: it goes back to the space with a new conversation
  useShortcut(SHORTCUTS.newConversation, newConversation);
  // The same keys browsers use for a private window
  useShortcut(SHORTCUTS.newPrivateConversation, () => openConversation(null, "private"));
  useShortcut(SHORTCUTS.chatSpace, () => switchSpace("chat"), { enabled: !isSettingsOpen });
  useShortcut(SHORTCUTS.codeSpace, () => switchSpace("code"), { enabled: !isSettingsOpen });
  const chatIds = new Set(chatConversations.map((c) => c.id));
  const codeIds = new Set(code.conversations.map((c) => c.id));
  const withDrafts = {
    chat: draftPlaces.some((place) => place === "welcome" || chatIds.has(place)),
    code: draftPlaces.some((place) => place.startsWith("project:") || codeIds.has(place)),
  };
  const spaceSwitch = (vertical = false) => (
    <SpaceSwitch space={space} onChange={switchSpace} withDrafts={withDrafts} vertical={vertical} />
  );
  const projectChatProps = code.chatViewProps();
  // Folded by the user in either space; in Código a narrow window folds it anyway, with nothing to unfold to
  const sidebarFold = useSidebarFold(
    !isSettingsOpen && !(space === "code" && code.layout.sidebarFolded),
    space === "chat",
  );

  useShortcut(SHORTCUTS.settings, () => openSettings("general"), { enabled: !isSettingsOpen });

  // Settings open on top of the chat instead of replacing it, so the draft, unsent files and scroll survive
  return (
    <PreferencesContext.Provider value={preferencesState}>
      <ProviderSettingsContext.Provider value={settings}>
        <SkillsContext.Provider value={skillsState}>
        <ModelDownloadsContext.Provider value={modelDownloads}>
        <UpdatesContext.Provider value={updates}>
        <MemoriesContext.Provider value={memoriesState}>
        <WorkspacesContext.Provider value={workspaces}>
            <div className="app" inert={isSettingsOpen || isWelcomeOpen} aria-hidden={isSettingsOpen || isWelcomeOpen}>
              {space === "code" ? (
                <CodeSidebar
                  code={code}
                  fold={sidebarFold}
                  spaceSwitch={spaceSwitch}
                  activeConversationId={isConversationShown ? chat.activeId : null}
                  busyId={chat.streamingId}
                  onOpenConversation={(id) => openConversation(id)}
                  onRenameConversation={chat.renameConversation}
                  onDeleteConversation={deleteConversation}
                  onOpenSettings={() => openSettings("general")}
                  onOpenModels={openProviderSettings}
                  shortcutEnabled={!isSettingsOpen}
                  storageError={chat.storageError}
                />
              ) : sidebarFold.isFolded ? (
                <ChatRail
                  onUnfold={sidebarFold.unfold}
                  onNew={() => openConversation(null)}
                  onOpenSettings={() => openSettings("general")}
                  spaceSwitch={spaceSwitch(true)}
                />
              ) : (
                <Sidebar
                  onFold={sidebarFold.fold}
                  conversations={chatConversations}
                  activeId={chat.activeId}
                  busyId={chat.streamingId}
                  onSelect={(id) => openConversation(id)}
                  onNew={() => openConversation(null)}
                  onDelete={deleteConversation}
                  onSetPinned={chat.setConversationPinned}
                  onRename={chat.renameConversation}
                  onOpenSettings={() => openSettings("general")}
                  onOpenModels={openProviderSettings}
                  onOpenSearchHit={openSearchHit}
                  folders={folders.folders}
                  onCreateFolder={folders.create}
                  onRenameFolder={folders.rename}
                  onDeleteFolder={deleteFolder}
                  onMoveConversation={chat.setConversationFolder}
                  shortcutEnabled={!isSettingsOpen}
                  storageError={chat.storageError ?? folders.error}
                  spaceSwitch={spaceSwitch()}
                />
              )}
              {chat.active && isConversationShown ? (
                <ChatView
                  key={chat.active.id}
                  conversation={chat.active}
                  models={settings.models}
                  selectedModelId={shownModelId}
                  onSelectModel={settings.selectModel}
                  onSend={chat.send}
                  onChangeSkills={chat.setConversationSkills}
                  onChangeWorkspace={chat.setConversationWorkspace}
                  onManageSkills={openSkillSettings}
                  onShowCommands={() => openSettings("commands")}
                  onOpenFeatureSettings={openFeatureSettings}
                  onOpenSkill={openSkill}
                  onOpenMemories={openMemories}
                  onRegenerate={chat.regenerate}
                  onSelectReplyVersion={chat.selectReplyVersion}
                  onEditMessage={chat.editMessage}
                  onDeleteMessage={chat.deleteMessage}
                  onUpdateChange={chat.updateChange}
                  onUpdateCommit={chat.updateCommit}
                  onRestoreSheetVersion={chat.restoreSheetVersion}
                  onFixChange={chat.fixWorkspaceChange}
                  onDeleteConversation={() => chat.activeId && deleteConversation(chat.activeId)}
                  onBranch={chat.branchFrom}
                  onStop={chat.stop}
                  onOpenSettings={openProviderSettings}
                  onSummarize={chat.summarize}
                  onRetrySummary={chat.retrySummary}
                  onCancelSummary={chat.cancelSummary}
                  onNewConversation={newConversation}
                  canOpenBrowser={canOpenBrowser}
                  autoSummarize={
                    !!settings.selectedModel && settings.optionsFor(settings.selectedModel.providerId).autoSummarize
                  }
                  reservedTokens={chat.reservedTokens}
                  isStreaming={chat.isStreaming}
                  isReplying={chat.streamingId === chat.active.id}
                  searchSteps={
                    chat.searchProgress?.conversationId === chat.active.id ? chat.searchProgress.steps : undefined
                  }
                  loadingSkills={
                    chat.skillProgress?.conversationId === chat.active.id ? chat.skillProgress.names : undefined
                  }
                  workspaceSteps={
                    chat.workspaceProgress?.conversationId === chat.active.id ? chat.workspaceProgress.steps : undefined
                  }
                  isSummarizing={chat.isSummarizing}
                  isLoading={chat.isLoading}
                  isHidden={isSettingsOpen}
                  searchRequest={searchRequest}
                  error={chat.error}
                  summaryError={chat.summaryError}
                  {...projectChatProps}
                  aboveComposer={noModelsNotice}
                />
              ) : space === "code" ? (
                <CodeHome
                  code={code}
                  models={settings.models}
                  selectedModelId={shownModelId}
                  onSend={chat.send}
                  onOpenConversation={(id) => openConversation(id)}
                  onOpenSettings={openProviderSettings}
                  onManageSkills={openSkillSettings}
                  onOpenFeatureSettings={openFeatureSettings}
                  shortcutsEnabled={!isSettingsOpen}
                  isBusy={chat.isStreaming || chat.isSummarizing}
                />
              ) : (
                <WelcomeView
                  models={settings.models}
                  selectedModelId={shownModelId}
                  onSelectModel={settings.selectModel}
                  // The new conversation keeps its privacy; the toggle starts off again for the next one
                  onSend={(...args) => {
                    setNewPrivacy("normal");
                    chat.send(...args);
                  }}
                  onOpenSettings={openProviderSettings}
                  onManageSkills={openSkillSettings}
                  onOpenFeatureSettings={openFeatureSettings}
                  privacy={newPrivacy}
                  onPrivacyChange={setNewPrivacy}
                  shortcutsEnabled={!isSettingsOpen}
                  isBusy={chat.isStreaming || chat.isSummarizing}
                  aboveComposer={noModelsNotice}
                />
              )}
              {space === "code" && <CodePanel code={code} />}
            </div>

            {chat.modelOffer && <ModelOfferDialog {...chat.modelOffer} />}
            {isWelcomeOpen && (
              <WelcomeFlow
                onClose={closeWelcome}
                // The last step: what the features are is the end of the welcome, and «back to chat» goes to the chat
                onShowFeatures={() => {
                  closeWelcome();
                  openFeatureSettings();
                }}
                onAddMcpServer={() => openSettings("mcp")}
              />
            )}
            {isSettingsOpen && (
              <div className="settings-layer">
                <LoadErrorBoundary leave={{ label: t("settings.back"), onLeave: () => setView("chat") }}>
                  <Suspense fallback={null}>
                    <SettingsView
                      initialSection={settingsSection}
                      initialGeneralOption={generalOption}
                      initialPersonalizationOption={personalizationOption}
                      initialSkill={settingsSkill}
                      onBack={() => setView("chat")}
                      onConversationsImported={(ids) => {
                        void code.projects.reload();
                        void chat.refreshConversations(ids);
                      }}
                      // Private conversations are never stored, so "delete all" doesn't count them
                      conversationCount={chat.conversations.filter((c) => !c.isPrivate).length}
                      onDeleteAllConversations={() => {
                        clearQuickLast();
                        return chat.deleteAllConversations();
                      }}
                      conversationTitle={(id) => chat.conversations.find((c) => c.id === id)?.title}
                      onOpenConversation={(id) => openConversation(id)}
                      onShowWelcome={() => {
                        setView("chat");
                        setIsWelcomeOpen(true);
                      }}
                    />
                  </Suspense>
                </LoadErrorBoundary>
              </div>
            )}
            <UpdateDialog />
        </WorkspacesContext.Provider>
        </MemoriesContext.Provider>
        </UpdatesContext.Provider>
        </ModelDownloadsContext.Provider>
        </SkillsContext.Provider>
      </ProviderSettingsContext.Provider>
    </PreferencesContext.Provider>
  );
}

export default App;
