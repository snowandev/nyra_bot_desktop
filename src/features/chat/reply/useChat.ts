import { useMemo, useState } from "react";
import { stopAllPrograms, stopProgramsOf } from "@/features/terminal/commandControl";
import type { CommandNeed } from "@/features/terminal/commandTools";
import { i18n } from "@/shared/i18n/i18n";
import { LANGUAGES } from "@/shared/i18n/languages";
import { cleanTitle, titleRequest } from "./conversationTitle";
import { CHANGES_PROMPT } from "@/features/workspace/fileChanges";
import { memoriesPrompt } from "@/features/memory/memories";
import { completeText, configForModel, messagesForModel } from "./modelRequest";
import { withoutUserMessage } from "./messageRemoval";
import { activeSkillsOf, reservedTokensFor } from "./replyRequest";
import { nextVersion, selectVersion } from "./replyVersions";
import type { Skill } from "@/features/skills/skills";
import { estimateTokens, historyForModel, summaryStillValid } from "./summary";
import { buildUserRules, withoutPersonalData } from "./userRules";
import { indexBudget, plannedWorkspaceContext } from "@/features/workspace/workspace";
import { fixChange } from "@/features/workspace/workspaceChanges";
import { getProvider } from "@/providers";
import { loadLearnedContexts, loadLoadedContexts } from "@/shared/storage/settings";
import type { Personalization } from "@/shared/storage/settings";
import type { Attachment, CommitProposal, Conversation, Message, Model, ProposedChange, ProviderConfig, WorkspaceFolder } from "@/shared/types";
import { useConversationStorage } from "@/features/conversations/useConversationStorage";
import { backgroundModel, routeReply } from "@/features/models/modelRouting";
import type { MemoryAccess } from "./replyOutcome";
import { useReplyStream } from "./useReplyStream";
import type { WorkspaceSnapshot } from "@/features/workspace/useWorkspaces";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import { useSummarizer } from "./useSummarizer";
import { restoredVersion } from "@/features/attachments/sheetVersions";
import { audioIdsOf } from "@/features/transcription/audioFiles";
import { forgetAudio } from "@/features/transcription/transcriptionStorage";

type ChatSettings = {
  model: Model | undefined;
  configFor: (providerId: string) => ProviderConfig;
  // Read on every request, so a change applies from the next message, also in conversations already started
  personalization: Personalization;
  // Installed skills; each conversation activates some of them by name
  skills: Skill[];
  webSearch: boolean;
  // Commands in a connected folder, each approved by the user; off where there is no folder
  runCommands?: boolean;
  // Programs the model writes, each approved by the user, with or without a folder
  runCode?: boolean;
  // The browser installed on this computer, asking before each new site on the internet
  browser?: boolean;
  // null while memory is off
  memory: MemoryAccess | null;
  prepareWorkspace: (conversationId: string, folder: WorkspaceFolder) => Promise<WorkspaceSnapshot | null>;
  pauseMeaning?: () => () => void;
  // Folders let go because no conversation uses them any more; without it, this window never lets one go
  onWorkspacesReleased?: (paths: string[]) => void;
  // A conversation reached the disk, for another window to show it
  onConversationSaved?: (id: string) => void;
  // The model names new conversations after the first reply
  smartTitles: boolean;
  onReplyCompleted?: () => void;
  onCommandNeedsYou?: (need: CommandNeed, count: number) => void;
  // «Automático»: the main model, the one for demanding tasks, and whether a move to a cloud waits for the user;
  // null while a model is picked by hand
  routing?: { main: Model; demanding: Model; askBeforeCloud: boolean } | null;
  // The main model, for titles when it can take them without sending a conversation to a new cloud
  mainModel?: Model;
  // A project's own model, which «Automático» leaves as it is
  pinnedModelFor?: (conversation: Pick<Conversation, "projectId">) => Model | undefined;
};

// Before a reply: «Automático» suggests the model for demanding tasks, which would take the conversation to a cloud,
// and waits for the user to say yes or no
type ModelOffer = { target: Model; current: Model; accept: () => void; decline: () => void };

type ModelChoice = NonNullable<Conversation["modelChoice"]>;

// A branch of a branch keeps one suffix, whatever language each was made in
function withoutForkSuffix(title: string) {
  const suffixes = LANGUAGES.map((lng) => ` ${i18n.t("reply.forkSuffix", { lng })}`);
  const suffix = suffixes.find((s) => title.endsWith(s));
  return suffix ? title.slice(0, -suffix.length) : title;
}

export type SendOptions = {
  // Both only matter when the message starts a new conversation
  isPrivate?: boolean;
  // Private too, and without anything but the model and the files (Conversation.isIsolated)
  isIsolated?: boolean;
  skills?: string[];
  // Chosen by hand for this message ("/" or a welcome card)
  skill?: string;
  // /init: the reply writes the project's NYRA.md
  writesGuide?: boolean;
  // A folder chosen on the welcome screen for the new conversation
  workspace?: WorkspaceFolder;
  // Starts a new conversation with the message even with one open (/new followed by a message)
  newConversation?: boolean;
  // A new conversation of the Código space, inside this project
  projectId?: string;
  // A new conversation started for a task: its skill goes with every message (Conversation.taskSkill)
  taskSkill?: string;
  // Instead of the selected one, when the send also changes it (a project's task starts with the project's model):
  // the new selection only reaches this function on the next render
  model?: Model;
  // The user's answer when «Automático» asked whether to move to the model for demanding tasks
  modelChoice?: ModelChoice;
};

type ReserveOf = Pick<Conversation, "isPrivate" | "isIsolated" | "skills" | "workspace">;

// The conversations and what can be done with them; the reply being written is useReplyStream's
export function useChat(settings: ChatSettings) {
  const { configFor, personalization, skills, webSearch, memory, smartTitles, onReplyCompleted } = settings;
  const { onCommandNeedsYou, runCommands = false, runCode = false, browser = false } = settings;
  const { prepareWorkspace, pauseMeaning, routing } = settings;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [modelOffer, setModelOffer] = useState<ModelOffer | null>(null);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  // The model of a conversation: the selected one, or with «Automático» its project's own or the one it is on
  const modelFor = (conversation: Pick<Conversation, "projectId" | "modelChoice">) =>
    !routing
      ? settings.model
      : (settings.pinnedModelFor?.(conversation) ??
        (conversation.modelChoice === "demanding" ? routing.demanding : routing.main));
  // A new conversation starts on the main model with «Automático»
  const model = modelFor(active ?? {});
  const userRules = useMemo(() => buildUserRules(personalization), [personalization]);
  const privateUserRules = useMemo(() => buildUserRules(withoutPersonalData(personalization)), [personalization]);
  const activeSkillNames = active?.skills;
  const memoryTexts = memory?.texts;
  // The index of a connected folder is collapsed to fit this share of the model's context
  const indexTokensOf = (replyModel: Model) =>
    indexBudget(
      plannedWorkspaceContext(
        replyModel,
        !getProvider(replyModel.providerId)?.requiresApiKey,
        configFor(replyModel.providerId).contextLength,
        loadLearnedContexts(),
        loadLoadedContexts(),
      ),
    );
  // What every request of a conversation carries besides its history and a folder's index. Room for the memories
  // and the instruction to save them, which a private conversation doesn't get.
  const fixedTokensOf = useMemo(
    () => (conversation: ReserveOf) => {
      if (conversation.isIsolated) return reservedTokensFor(null, [], false);
      const memories = memoryTexts && !conversation.isPrivate ? memoriesPrompt(memoryTexts, true) : null;
      const marked = activeSkillsOf(skills, conversation.skills);
      const rules = conversation.isPrivate ? privateUserRules : userRules;
      return reservedTokensFor(rules, marked, webSearch, memories);
    },
    [skills, userRules, privateUserRules, webSearch, memoryTexts],
  );
  // Each reply measures its own conversation, which may not be the one open
  const reservedTokensOf = (conversation: ReserveOf, replyModel: Model) =>
    fixedTokensOf(conversation) + (conversation.workspace && !conversation.isIsolated ? indexTokensOf(replyModel) : 0);
  // Memoized: the conversation changes on every frame of a streaming reply, these inputs don't
  const activeIsPrivate = !!active?.isPrivate;
  const activeIsIsolated = !!active?.isIsolated;
  const activeFixedTokens = useMemo(
    () => fixedTokensOf({ isPrivate: activeIsPrivate, isIsolated: activeIsIsolated, skills: activeSkillNames }),
    [fixedTokensOf, activeIsPrivate, activeIsIsolated, activeSkillNames],
  );
  const reservedTokens =
    activeFixedTokens + (active?.workspace && !activeIsIsolated && model ? indexTokensOf(model) : 0);
  const reply = useReplyStream({
    configFor,
    skills,
    userRules,
    privateUserRules,
    webSearch,
    runCommands,
    runCode,
    browser,
    memory,
    prepareWorkspace,
    pauseMeaning,
    reservedTokensOf,
    updateMessages,
    updateReply,
    onReplyCompleted,
    onCommandNeedsYou,
  });
  const { isStreaming } = reply;
  const storage = useConversationStorage(
    conversations,
    setConversations,
    reply.streamingId,
    settings.onWorkspacesReleased,
    settings.onConversationSaved,
  );
  const summarizer = useSummarizer({ configFor, reservedTokens, updateConversation });
  // Until an opened conversation's messages arrive from disk, acting on it would build on an empty history
  const isLoadingActive = !!activeId && storage.isLoading(activeId);
  const isBusy = isStreaming || summarizer.isSummarizing || isLoadingActive;

  function updateConversation(conversationId: string, update: (conversation: Conversation) => Conversation) {
    setConversations((list) => list.map((c) => (c.id === conversationId ? update(c) : c)));
  }

  function updateMessages(conversationId: string, update: (messages: Message[]) => Message[]) {
    updateConversation(conversationId, (c) => ({ ...c, messages: update(c.messages) }));
  }

  function updateReply(conversationId: string, update: (reply: Message) => Message) {
    updateMessages(conversationId, (messages) => [...messages.slice(0, -1), update(messages[messages.length - 1])]);
  }

  // Starting a reply clears the errors of the last one and of the last summary, in that conversation
  function streamReply(...args: Parameters<typeof reply.streamReply>) {
    summarizer.clearError(args[0]);
    return reply.streamReply(...args);
  }

  // keptAudio: audio still used elsewhere (a branch of it, which holds the same files)
  function removeFromMemory(id: string, keptAudio: string[] = []) {
    reply.stop(id);
    // The audio of a private conversation is a file only while it is open; what a failure leaves goes when Nyra starts
    const gone = conversations.find((c) => c.id === id);
    const unused = gone?.isPrivate ? audioIdsOf(gone.messages).filter((a) => !keptAudio.includes(a)) : [];
    if (unused.length > 0) void forgetAudio(unused).catch(() => {});
    setConversations((list) => list.filter((c) => c.id !== id));
  }

  // opening: the conversation opened, when it isn't in the list yet (a branch just made)
  function openConversation(id: string | null, opening?: Conversation) {
    // A private conversation only lives while it is open
    if (active?.isPrivate && id !== active.id) {
      removeFromMemory(active.id, opening ? audioIdsOf(opening.messages) : []);
    }
    setActiveId(id);
    // A suggested change of model belongs to the conversation it was made in
    setModelOffer(null);
    if (id) storage.ensureLoaded(id);
  }

  // A re-import can rewrite the open conversation; it is read again so the chat doesn't show it empty
  async function refreshConversations(changedIds: string[]) {
    await storage.refresh(changedIds);
    if (activeId && changedIds.includes(activeId)) storage.ensureLoaded(activeId);
  }

  function deleteConversation(id: string) {
    stopProgramsOf(id);
    removeFromMemory(id);
    storage.forget(id);
    if (id === activeId) openConversation(null);
  }

  function setConversationPinned(id: string, pinned: boolean) {
    updateConversation(id, (c) => ({ ...c, pinned }));
    storage.setPinned(id, pinned);
  }

  function setConversationFolder(id: string, folderId: string | null) {
    updateConversation(id, (c) => ({ ...c, folderId }));
    storage.setFolder(id, folderId);
  }

  // The folder was deleted on disk, which already moved its conversations out; this mirrors it in memory
  function forgetFolder(folderId: string) {
    setConversations((list) => list.map((c) => (c.folderId === folderId ? { ...c, folderId: null } : c)));
  }

  // An empty name keeps the current one, so a cleared field can't leave the conversation unnamed
  function renameConversation(id: string, title: string) {
    const name = title.trim();
    if (!name) return;
    updateConversation(id, (c) => ({ ...c, title: name }));
    storage.rename(id, name);
  }

  async function deleteAllConversations() {
    reply.stop();
    stopAllPrograms();
    setConversations([]);
    openConversation(null);
    try {
      await storage.forgetAll();
    } catch (e) {
      // Whatever is still on disk comes back, so the list never claims a deletion that didn't happen
      await storage.refresh();
      throw e;
    }
  }

  function placeholderFor(replyModel: Model): Message {
    return { role: "assistant", content: "", model: replyModel.name, modelId: replyModel.id };
  }

  const isCloudModel = (m: Model) => !!getProvider(m.providerId)?.requiresApiKey;

  // With «Automático», which model answers the last message of history; null when a model is picked by hand
  function routeFor(
    conversation: Pick<Conversation, "modelChoice" | "isPrivate" | "workspace" | "projectId">,
    history: Message[],
    summary: Conversation["summary"],
    asked = false,
  ) {
    if (!routing || settings.pinnedModelFor?.(conversation)) return null;
    const tokens = estimateTokens(messagesForModel(historyForModel(history, summary), routing.main)) + reservedTokens;
    return routeReply({
      ...routing,
      conversation,
      message: history[history.length - 1],
      tokens,
      isCloud: isCloudModel,
      asked,
    });
  }

  // The same message answered again by another model, after the main one handed it over
  async function answerWith(
    conversationId: string,
    history: Message[],
    summary: Conversation["summary"],
    context: ReturnType<typeof contextOf>,
    replyModel: Model,
    modelChoice: ModelChoice,
  ) {
    const messages = [...history, placeholderFor(replyModel)];
    updateConversation(conversationId, (c) => ({ ...c, modelChoice, messages }));
    return streamReply(conversationId, history, replyModel, summary, context);
  }

  // The main model said the task is beyond it: the other one answers, once the user agrees if it is in a cloud
  function handOver(
    conversationId: string,
    conversation: Pick<Conversation, "modelChoice" | "isPrivate" | "workspace" | "projectId">,
    history: Message[],
    summary: Conversation["summary"],
    context: ReturnType<typeof contextOf>,
    onAnswer: (answer: string | null) => void,
  ) {
    const route = routeFor(conversation, history, summary, true);
    if (!route || !routing) return;
    const answer = (replyModel: Model, choice: ModelChoice) =>
      void answerWith(conversationId, history, summary, context, replyModel, choice).then(onAnswer);
    if (!route.needsConsent) {
      answer(route.model, route.model === routing.demanding ? "demanding" : "main");
      return;
    }
    setModelOffer({
      target: route.model,
      current: routing.main,
      accept: () => {
        setModelOffer(null);
        answer(route.model, "demanding");
      },
      decline: () => {
        setModelOffer(null);
        answer(routing.main, "main");
      },
    });
  }

  function contextOf(conversation: Conversation) {
    const { skills: skillNames, isPrivate, isIsolated, workspace } = conversation;
    return { skillNames, isPrivate: !!isPrivate, isIsolated: !!isIsolated, workspace };
  }

  // null disconnects it; the folder on disk is never touched
  function setConversationWorkspace(workspace: WorkspaceFolder | null) {
    if (!active) return;
    updateConversation(active.id, (c) => {
      const rest = { ...c };
      delete rest.workspace;
      return workspace ? { ...rest, workspace } : rest;
    });
  }

  // Removing the task's skill from the header; the skill stays among the conversation's skills
  function removeTaskSkill() {
    if (!active) return;
    updateConversation(active.id, (c) => {
      const rest = { ...c };
      delete rest.taskSkill;
      return rest;
    });
  }

  function setConversationSkills(names: string[]) {
    if (active) updateConversation(active.id, (c) => ({ ...c, skills: names }));
  }

  async function send(text: string, attachments: Attachment[], references: string[] = [], options: SendOptions = {}) {
    const { newConversation, projectId, taskSkill, model: chosenModel, modelChoice: answered } = options;
    if ((!text && attachments.length === 0 && references.length === 0) || isBusy || !settings.model) return;
    setModelOffer(null);
    // /new with a message: it leaves the open conversation as ⌘N would, and starts one with it
    const current = newConversation ? undefined : active;
    if (newConversation) openConversation(null);
    // Isolated (this new one, or the one open): no skills, not even one chosen for this message, no folder, and private
    const isIsolated = current ? !!current.isIsolated : !!options.isIsolated;
    const isPrivate = isIsolated || !!options.isPrivate;
    const skill = isIsolated ? undefined : options.skill;
    const newSkills = isIsolated ? [] : (options.skills ?? []);
    const newWorkspace = isIsolated ? undefined : options.workspace;

    const userMessage: Message = {
      role: "user",
      content: text,
      ...(attachments.length > 0 && { attachments }),
      ...(references.length > 0 && { references }),
      ...(skill && { skill }),
      ...(options.writesGuide && { writesGuide: true }),
    };
    // By characters, so an emoji at the cut isn't split in half
    const title = Array.from(text || attachments[0]?.name || "").slice(0, 40).join("");
    const history = [...(current?.messages ?? []), userMessage];
    const conversationId = current?.id ?? crypto.randomUUID();
    const skillNames = current ? (current.skills ?? []) : newSkills;
    const workspace = current ? current.workspace : newWorkspace;
    const routed = {
      ...(current ?? { isPrivate, workspace, projectId }),
      ...(answered && { modelChoice: answered }),
    };
    const route = chosenModel ? null : routeFor(routed, history, current?.summary);
    if (route?.needsConsent && routing) {
      const again = (modelChoice: ModelChoice) => {
        setModelOffer(null);
        void send(text, attachments, references, { ...options, modelChoice });
      };
      setModelOffer({
        target: route.model,
        current: routing.main,
        accept: () => again("demanding"),
        decline: () => again("main"),
      });
      return;
    }
    const model = chosenModel ?? route?.model ?? modelFor(routed) ?? settings.model;
    const modelChoice = answered ?? (route && route.model === routing?.demanding ? "demanding" : undefined);
    const pending = [...history, placeholderFor(model)];

    if (current) {
      updateConversation(conversationId, (c) => ({ ...c, messages: pending, ...(modelChoice && { modelChoice }) }));
    } else {
      // Never marked as new for storage, so a private conversation is never written to disk
      if (!isPrivate) storage.markNew(conversationId);
      setConversations((list) => [
        {
          id: conversationId,
          title,
          messages: pending,
          ...(isPrivate && { isPrivate }),
          ...(isIsolated && { isIsolated }),
          ...(skillNames.length > 0 && { skills: skillNames }),
          ...(workspace && { workspace }),
          ...(projectId && { projectId }),
          ...(taskSkill && { taskSkill }),
          ...(modelChoice && { modelChoice }),
        },
        ...list,
      ]);
      setActiveId(conversationId);
    }
    const context = current ? contextOf(current) : { skillNames, isPrivate, isIsolated, workspace };
    const question = text || attachments.map((a) => a.name).join(", ");
    const named = (answer: string | null, answerModel: Model) => {
      // An isolated one isn't sent to another model to be named: nothing lists it anyway
      if (smartTitles && !current && answer && question && !context.isIsolated) {
        const titleModel = backgroundModel(settings.mainModel, answerModel, isCloudModel);
        nameConversation(conversationId, title, question, answer, titleModel);
      }
    };
    // The main model may hand the task over before answering, once per message
    const mayHandOver = route?.reason === "main" && routed.modelChoice !== "main" && !context.isIsolated;
    let handedOver = false;
    const answer = await streamReply(conversationId, history, model, current?.summary, {
      ...context,
      ...(mayHandOver && { onEscalate: () => (handedOver = true) }),
    });
    if (handedOver) {
      handOver(conversationId, routed, history, current?.summary, context, (later) =>
        named(later, routing?.demanding ?? model),
      );
      return;
    }
    named(answer, model);
  }

  // "Pedir que lo corrija": the chosen model redoes the change in a request of its own, outside the conversation
  async function fixWorkspaceChange(change: ProposedChange, signal: AbortSignal) {
    const provider = model && getProvider(model.providerId);
    if (!model || !provider) throw new Error(i18n.t("reply.chooseModelToFix"));
    const config = configForModel(configFor(provider.id), model);
    return fixChange(change, model.contextWindow, (request) =>
      completeText(provider, config, model, [request], { system: CHANGES_PROMPT, signal }),
    );
  }

  // The first exchange names the conversation; meanwhile it shows the start of the first message
  async function nameConversation(id: string, provisional: string, question: string, answer: string, titleModel: Model) {
    const provider = getProvider(titleModel.providerId);
    if (!provider) return;
    const config = { ...configForModel(configFor(provider.id), titleModel), reasoning: false };
    try {
      const title = cleanTitle(await completeText(provider, config, titleModel, titleRequest(question, answer)));
      if (title) applyGeneratedTitle(id, provisional, title);
    } catch {
      // Not worth an error over the chat: the provisional title is still a fine name
    }
  }

  // Stable, so it sees the conversations as they are when the title arrives, not when it was asked for
  const applyGeneratedTitle = useStableCallback((id: string, provisional: string, title: string) => {
    // Deleted, or renamed by the user while the title was being written
    if (conversations.find((c) => c.id === id)?.title === provisional) renameConversation(id, title);
  });

  // A new version of the last reply, or a retry when the last message never got one, with the selected model.
  // The replies already there stay as earlier versions.
  async function regenerate() {
    if (!active || isBusy || !model) return;
    const messages = active.messages;
    const last = messages[messages.length - 1];
    const history = last?.role === "assistant" ? messages.slice(0, -1) : messages;
    if (history.length === 0) return;

    const summary = summaryStillValid(active.summary, history.length);
    const placeholder = last?.role === "assistant" ? nextVersion(last, placeholderFor(model)) : placeholderFor(model);
    updateConversation(active.id, (c) => ({ ...c, summary, messages: [...history, placeholder] }));
    await streamReply(active.id, history, model, summary, contextOf(active));
  }

  // Only the latest reply switches versions: the messages after an older one answered the version it had then
  function selectReplyVersion(index: number, version: number) {
    if (!active || isBusy || index !== active.messages.length - 1) return;
    updateMessages(active.id, (messages) => messages.map((m, i) => (i === index ? selectVersion(m, version) : m)));
  }

  // Copies the conversation up to this message into a new one and opens it; the original stays as it was
  function branchFrom(index: number) {
    if (!active || isBusy || !active.messages[index]) return;
    const id = crypto.randomUUID();
    const branch: Conversation = {
      id,
      title: `${withoutForkSuffix(active.title)} ${i18n.t("reply.forkSuffix")}`,
      messages: active.messages.slice(0, index + 1),
      // A summary of messages before the branch point still describes the start of the branch
      summary: summaryStillValid(active.summary, index + 1),
      ...(active.skills?.length && { skills: active.skills }),
      ...(active.folderId && { folderId: active.folderId }),
      ...(active.workspace && { workspace: active.workspace }),
      ...(active.projectId && { projectId: active.projectId }),
      // A branch of a private conversation stays private, and of an isolated one, isolated
      ...(active.isPrivate && { isPrivate: true }),
      ...(active.isIsolated && { isIsolated: true }),
    };
    if (!active.isPrivate) storage.markNew(id);
    setConversations((list) => [branch, ...list]);
    openConversation(id, branch);
  }

  // Rewrites a user message and answers again from that point; later messages are replaced. removedFiles are ids of
  // its attachments or references the user took out, e.g. a file too large for the model.
  async function editMessage(index: number, text: string, removedFiles: string[] = []) {
    const original = active?.messages[index];
    if (!active || isBusy || !model || original?.role !== "user") return;
    const attachments = original.attachments?.filter((a) => !removedFiles.includes(a.id)) ?? [];
    const references = original.references?.filter((id) => !removedFiles.includes(id)) ?? [];
    if (!text && attachments.length === 0 && references.length === 0) return;

    const edited: Message = { ...original, content: text };
    delete edited.attachments;
    delete edited.references;
    const summary = summaryStillValid(active.summary, index);
    const history = [
      ...active.messages.slice(0, index),
      {
        ...edited,
        ...(attachments.length > 0 && { attachments }),
        ...(references.length > 0 && { references }),
      },
    ];
    updateConversation(active.id, (c) => ({ ...c, summary, messages: [...history, placeholderFor(model)] }));
    await streamReply(active.id, history, model, summary, contextOf(active));
  }

  // A proposed change of a reply, by its conversation, so an answer from disk that arrives after switching chats still
  // lands where it belongs
  function updateChange(conversationId: string, index: number, change: ProposedChange) {
    updateMessages(conversationId, (messages) =>
      messages.map((m, i) =>
        i === index && m.workspaceChanges
          ? { ...m, workspaceChanges: m.workspaceChanges.map((c) => (c.id === change.id ? change : c)) }
          : m,
      ),
    );
  }

  // A reply's proposed commit, after the user made it, discarded it or edited its message
  function updateCommit(conversationId: string, index: number, proposal: CommitProposal) {
    updateMessages(conversationId, (messages) =>
      messages.map((m, i) => (i === index && m.commitProposal ? { ...m, commitProposal: proposal } : m)),
    );
  }

  // "Seguir desde esta" on an earlier version of an attached spreadsheet
  function restoreSheetVersion(fileId: string) {
    if (!active || isBusy) return;
    const restored = restoredVersion(active.messages, fileId);
    if (!restored) return;
    updateMessages(active.id, (messages) =>
      messages.map((m, i) =>
        i === restored.index
          ? {
              ...m,
              attachments: [...(m.attachments ?? []), restored.attachment],
              sheetVersions: [...(m.sheetVersions ?? []), restored.version],
            }
          : m,
      ),
    );
  }

  // Removes a user message and the reply that answers it; the rest stays. Returns how to undo it, or null if nothing
  // was removed. Removing the only exchange is deleting the conversation, which the view asks about first.
  function deleteMessage(index: number) {
    if (!active || isBusy) return null;
    const result = withoutUserMessage(active.messages, active.summary, index);
    if (!result || result.messages.length === 0) return null;
    const { id, messages, summary } = active;
    // The error belonged to the reply this message never got
    if (result.wasUnanswered) reply.clearError(id);
    updateConversation(id, (c) => ({ ...c, messages: result.messages, summary: result.summary }));
    return {
      text: active.messages[index].content,
      wasUnanswered: result.wasUnanswered,
      // Only while nothing else changed the conversation since
      undo: () =>
        updateConversation(id, (c) => (c.messages === result.messages ? { ...c, messages, summary } : c)),
    };
  }

  async function summarize(byHand = false) {
    if (!active || isBusy || !model) return;
    await summarizer.summarize(active, model, byHand);
  }

  async function retrySummary() {
    if (!active || isBusy || !model) return;
    await summarizer.retry(active, model);
  }

  return {
    conversations,
    activeId,
    active,
    openConversation,
    deleteConversation,
    setConversationPinned,
    setConversationFolder,
    forgetFolder,
    renameConversation,
    deleteAllConversations,
    reservedTokens,
    send,
    // The model the open conversation goes on with (the selected one, or the one «Automático» has it on)
    activeModel: model,
    modelOffer,
    setConversationSkills,
    removeTaskSkill,
    setConversationWorkspace,
    regenerate,
    selectReplyVersion,
    editMessage,
    deleteMessage,
    updateChange,
    updateCommit,
    restoreSheetVersion,
    fixWorkspaceChange,
    branchFrom,
    summarize,
    retrySummary,
    stop: () => reply.stop(),
    isStreaming,
    streamingId: reply.streamingId,
    searchProgress: reply.searchProgress,
    skillProgress: reply.skillProgress,
    workspaceProgress: reply.workspaceProgress,
    isSummarizing: summarizer.isSummarizing,
    cancelSummary: summarizer.cancel,
    isLoading: isLoadingActive,
    error: reply.errorOf(activeId),
    summaryError: summarizer.errorOf(activeId),
    storageError: storage.storageError,
    refreshConversations,
    whenSaved: storage.whenSaved,
  };
}
