import { Activity, AudioLines, FolderOpen, Lock, ShieldCheck, X } from "lucide-react";
import { Fragment, type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import type { SendOptions } from "@/features/chat/reply/useChat";
import { useChatSearch } from "./useChatSearch";
import { hasReplyCards } from "./reply/replyCards";
import { useContextLimit } from "@/features/chat/reply/useContextLimit";
import { useInvokedSkill } from "@/features/skills/useInvokedSkill";
import { useMessageShare } from "@/features/share/useMessageShare";
import { useMessageJump } from "./useMessageJump";
import { useMessageWindow } from "./useMessageWindow";
import { draftOf, setDraftOf } from "@/shared/hooks/useDraft";
import { whenRendered } from "@/shared/lib/whenRendered";
import type { ModelPreference } from "@/features/models/ModelMenu";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import { useStableList } from "./useStableList";
import { ConversationImagesContext, imagesByName, isConversationImage } from "@/features/markdown/conversationImages";
import { useStickToBottom } from "./useStickToBottom";
import { useWorkspaceFiles } from "@/features/workspace/useWorkspaceFiles";
import { fileOriginsOf, filesOf } from "@/features/attachments/attachments";
import { contextStateOf } from "@/features/chat/reply/context";
import { joinedList } from "./listFormat";
import { type ComposerCommand, initRequestOf, messageForNew } from "@/features/chat/reply/commands";
import { fileStatesOf, planSummary, SUMMARY_TRIGGER } from "@/features/chat/reply/summary";
import { cloudDestinations } from "@/features/sensitive-data/sensitiveData";
import type { SearchStepProgress } from "@/features/web/webSearchAgent";
import type { WorkspaceStep } from "@/features/workspace/workspaceTools";
import type { Attachment, CommitProposal, Conversation, Model, ProposedChange, WorkspaceFolder } from "@/shared/types";
import { AttachmentsPanel } from "@/features/attachments/AttachmentsPanel";
import { BrowserStrip } from "@/features/browser/BrowserStrip";
import { ScreenStrip } from "@/features/screen-look/ScreenStrip";
import { TranscriptionStrip } from "@/features/transcription/TranscriptionStrip";
import { ProcessesPanel } from "@/features/terminal/ProcessesPanel";
import { activeProcesses } from "@/features/terminal/processes";
import { answerInstead, useAwaitingCommand } from "@/features/terminal/commandControl";
import { LazyAttachmentViewer } from "@/features/attachments/LazyAttachmentViewer";
import { ChatSearchBar } from "./ChatSearchBar";
import { DraftComposer } from "./DraftComposer";
import { Disclaimer } from "@/shared/ui/Disclaimer";
import { ErrorNotice } from "@/shared/ui/ErrorNotice";
import { MessageItem } from "./MessageItem";
import { MessageUndoNotice } from "./MessageUndoNotice";
import { PendingChangesNotice } from "@/features/workspace/PendingChangesNotice";
import { CommandReminder } from "@/features/terminal/CommandReminder";
import { ReasoningSummary } from "./ReasoningSummary";
import { ShareCard } from "@/features/share/ShareCard";
import { SummaryDivider } from "./SummaryDivider";
import { modelChangesOf } from "./modelChanges";
import { SummaryStatus } from "./SummaryStatus";
import { WebSearchProgress } from "@/features/web/WebSearchProgress";
import { WorkspaceSteps } from "@/features/workspace/WorkspaceSteps";
import { useChatReviews } from "./useChatReviews";
import { retryingLazy } from "@/shared/lib/loadOnDemand";
import { LoadErrorBoundary } from "@/shared/ui/LoadErrorBoundary";

// The review panels load the first time something is reviewed, not when Nyra starts
const ChangeReviewPanel = retryingLazy(() =>
  import("@/features/workspace/ChangeReviewPanel").then((m) => m.ChangeReviewPanel),
);
const CellsReviewPanel = retryingLazy(() => import("@/features/workspace/CellsReviewPanel").then((m) => m.CellsReviewPanel));
const SheetVersionPanel = retryingLazy(() =>
  import("@/features/attachments/SheetVersionPanel").then((m) => m.SheetVersionPanel),
);

// Opening a result of the search across all conversations: start the in-chat search at that message
export type ChatSearchRequest = {
  // Tells two requests with the same text apart, so opening the same result again still jumps
  id: number;
  conversationId: string;
  query: string;
  messageIndex: number;
};

type Props = {
  conversation: Conversation;
  models: Model[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  onSend: (text: string, attachments: Attachment[], references: string[], options?: SendOptions) => void;
  onChangeSkills: (names: string[]) => void;
  // Connects, changes or (with null) disconnects the conversation's folder
  onChangeWorkspace: (folder: WorkspaceFolder | null) => void;
  onManageSkills: () => void;
  onShowCommands: () => void;
  onOpenFeatureSettings: () => void;
  onOpenSkill: (name: string) => void;
  onOpenMemories: () => void;
  onRegenerate: () => void;
  onSelectReplyVersion: (index: number, version: number) => void;
  onEditMessage: (index: number, text: string, removedFiles: string[]) => void;
  // How to undo it, or null when nothing was removed
  onDeleteMessage: (index: number) => { text: string; wasUnanswered: boolean; undo: () => void } | null;
  onDeleteConversation: () => void;
  // Keeps what the user decided about a change a reply proposed
  onUpdateChange: (conversationId: string, index: number, change: ProposedChange) => void;
  onUpdateCommit: (conversationId: string, index: number, proposal: CommitProposal) => void;
  // "Seguir desde esta" on an earlier version of an attached spreadsheet
  onRestoreSheetVersion: (fileId: string) => void;
  onFixChange: (change: ProposedChange, signal: AbortSignal) => Promise<ProposedChange>;
  onBranch: (index: number) => void;
  onStop: () => void;
  onOpenSettings: () => void;
  // Without arguments, the automatic summary; /compact asks for it by hand
  onSummarize: (byHand?: boolean) => void;
  onRetrySummary: () => void;
  onCancelSummary: () => void;
  // The same as ⌘N / Ctrl+N
  onNewConversation: () => void;
  // The browser feature is on and a browser is installed: the menu opens its panel
  canOpenBrowser?: boolean;
  autoSummarize: boolean;
  // Tokens every request carries besides the history (rules and skills); the summary leaves room for them
  reservedTokens: number;
  // A reply is being written somewhere; sending and editing wait for it
  isStreaming: boolean;
  // The reply being written belongs to this conversation
  isReplying: boolean;
  // The searches of the reply being written here, until it starts answering
  searchSteps: SearchStepProgress[] | undefined;
  // The skills the model asked for, while Nyra loads them for the reply being written
  loadingSkills?: string[];
  // What the reply being written here looks at in the folder
  workspaceSteps?: WorkspaceStep[];
  isSummarizing: boolean;
  // Messages are still being read from disk
  isLoading: boolean;
  // Settings cover the chat; it stays mounted underneath but must not react to shortcuts
  isHidden: boolean;
  error: string | null;
  summaryError: string | null;
  searchRequest: ChatSearchRequest | null;
  // In a project of the Código space: its preferred model in the model menu, and its notes above the composer
  modelPreference?: ModelPreference;
  aboveComposer?: ReactNode;
  // The skill of the task the conversation was started for, shown in the header until it is removed
  taskSkill?: { name: string; label: string; onRemove: () => void };
  // Something waiting for the user, chosen elsewhere (the project panel): a change to review or a command to run
  pendingRequest?: PendingRequest | null;
  // Whether a review takes the side of the chat, so the space around can make room for it
  onReviewChange?: (isOpen: boolean) => void;
  // The request was carried out (or its item is gone): it must not happen again when the conversation opens again
  onPendingHandled?: () => void;
};

export type PendingRequest = {
  // Tells two requests for the same item apart, so choosing it again still goes to it
  id: number;
  conversationId: string;
  kind: "change" | "command" | "commit";
  itemId: string;
};

export function ChatView(props: Props) {
  const {
    conversation,
    models,
    selectedModelId,
    onSelectModel,
    onSend,
    onChangeSkills,
    onChangeWorkspace,
    onManageSkills,
    onShowCommands,
    onOpenFeatureSettings,
    onOpenSkill,
    onOpenMemories,
    onRegenerate,
    onSelectReplyVersion,
    onEditMessage,
    onDeleteMessage,
    onDeleteConversation,
    onUpdateChange,
    onUpdateCommit,
    onRestoreSheetVersion,
    onFixChange,
    onBranch,
    onStop,
    onOpenSettings,
    onSummarize,
    onRetrySummary,
    onCancelSummary,
    onNewConversation,
    canOpenBrowser = false,
    autoSummarize,
    reservedTokens,
    isStreaming,
    isReplying,
    searchSteps,
    loadingSkills,
    workspaceSteps,
    isSummarizing,
    isLoading,
    isHidden,
    error,
    summaryError,
    searchRequest,
    modelPreference,
    aboveComposer,
    taskSkill,
    pendingRequest,
    onReviewChange,
    onPendingHandled,
  } = props;
  const { t } = useTranslation();
  const [isFilesPanelOpen, setIsFilesPanelOpen] = useState(false);
  const [isProcessesPanelOpen, setIsProcessesPanelOpen] = useState(false);
  const [openAttachmentId, setOpenAttachmentId] = useState<string | null>(null);
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [isSkillPickerOpen, setIsSkillPickerOpen] = useState(false);
  const skillNames = conversation.skills ?? [];
  const invokedSkill = useInvokedSkill(skillNames, onChangeSkills);
  const closeViewer = useCallback(() => setOpenAttachmentId(null), []);
  // The picture of a browser card isn't one of the conversation's files: it opens as it is
  const [looseImage, setLooseImage] = useState<Attachment | null>(null);
  const openViewer = useCallback((attachment: Attachment) => {
    setOpenAttachmentId(attachment.id);
    setLooseImage(attachment.id.startsWith("browser-") ? attachment : null);
  }, []);
  const scroll = useStickToBottom<HTMLElement, HTMLDivElement>();
  const { containerRef, contentRef } = scroll;
  const messageWindow = useMessageWindow(conversation.messages.length, scroll.containerRef);
  const { unpin } = scroll;
  const { showFrom } = messageWindow;
  // Draws up to an older message without the auto-scroll pulling the chat back to the end
  const showMessage = useCallback(
    (index: number) => {
      unpin();
      showFrom(index);
    },
    [unpin, showFrom],
  );
  const search = useChatSearch(conversation.messages, scroll.containerRef, showMessage, !isHidden);
  const jumpToMessage = useMessageJump(scroll.containerRef, showMessage);
  const fileOrigins = useMemo(() => fileOriginsOf(conversation.messages), [conversation.messages]);

  function showFileMessage(index: number) {
    // On narrow windows the panel floats over the chat (files-panel.css, same width), so it gets out of the way
    if (window.matchMedia("(max-width: 1100px)").matches) setIsFilesPanelOpen(false);
    jumpToMessage(index);
  }
  // Commands and programs still running, however far up their cards are
  const processes = useMemo(() => activeProcesses(conversation.messages), [conversation.messages]);
  function showProcessMessage(index: number) {
    if (window.matchMedia("(max-width: 1100px)").matches) setIsProcessesPanelOpen(false);
    jumpToMessage(index);
  }
  const { openAt } = search;
  const handledSearchId = useRef<number | null>(null);

  // Waits for the messages: a conversation opened from the search may still be loading from disk
  useEffect(() => {
    if (!searchRequest || isLoading || searchRequest.conversationId !== conversation.id) return;
    if (handledSearchId.current === searchRequest.id) return;
    handledSearchId.current = searchRequest.id;
    openAt(searchRequest.query, searchRequest.messageIndex);
  }, [searchRequest, isLoading, conversation.id, openAt]);
  const mainRef = useRef<HTMLElement>(null);
  const regenerate = useStableCallback(() => {
    scroll.pin();
    onRegenerate();
  });
  const editMessage = useStableCallback((index: number, text: string, removedFiles: string[]) => {
    scroll.pin();
    onEditMessage(index, text, removedFiles);
  });
  // The undo of the last deletion, while its notice is up
  const [undoDelete, setUndoDelete] = useState<(() => void) | null>(null);
  const deleteMessage = useStableCallback((index: number) => {
    const deleted = onDeleteMessage(index);
    if (!deleted) return;
    setUndoDelete(() => deleted.undo);
    // A message that never got a reply (its file didn't fit) can be sent again without the file
    if (deleted.wasUnanswered && !draftOf(conversation.id).trim()) setDraftOf(conversation.id, deleted.text);
  });
  const deleteConversation = useStableCallback(onDeleteConversation);
  const branch = useStableCallback(onBranch);
  const selectReplyVersion = useStableCallback(onSelectReplyVersion);
  // Also the screenshots of the reply being written: its document may already show them
  const imageList = useStableList(conversation.messages.flatMap((m) => m.attachments ?? []).filter(isConversationImage));
  const images = useMemo(() => imagesByName(imageList), [imageList]);
  const { share, shareCard, shareCardRef, shareError, dismissShareError } = useMessageShare(conversation.messages, images);
  // Attachment objects keep their identity while a reply streams, so these stay the same across frames
  // A reply being written isn't a file yet; leaving it out also keeps the list stable while tokens arrive
  const settledMessages = useMemo(
    () => (isReplying ? conversation.messages.slice(0, -1) : conversation.messages),
    [isReplying, conversation.messages],
  );
  const attachments = useStableList(filesOf(settledMessages));
  const byId = useMemo(() => new Map(attachments.map((a) => [a.id, a] as const)), [attachments]);
  // Stable, so the memoized messages don't re-render when the app passes a new function
  const openSkill = useStableCallback(onOpenSkill);
  const openMemories = useStableCallback(onOpenMemories);
  const workspaceFiles = useWorkspaceFiles();
  const openWorkspaceFile = useStableCallback(workspaceFiles.open);
  const showWorkspaceFile = useStableCallback(workspaceFiles.show);
  // Only depends on which model wrote each reply, not on the text arriving on every frame of a streaming reply
  const writtenBy = conversation.messages.map((m) => (m.role === "assistant" ? (m.model ?? "") : "")).join("\n");
  const sentTo = useMemo(() => cloudDestinations(writtenBy.split("\n"), models), [writtenBy, models]);
  const modelChanges = useMemo(
    () => modelChangesOf(writtenBy.split("\n").map((model) => ({ role: model ? "assistant" : "user", model }))),
    [writtenBy],
  );
  const pendingReferences = referenceIds.flatMap((id) => byId.get(id) ?? []);
  const { summary } = conversation;
  const fileStates = useMemo(
    () => (summary ? fileStatesOf(settledMessages, summary) : null),
    [settledMessages, summary],
  );
  const openAttachment =
    attachments.find((a) => a.id === openAttachmentId) ?? (looseImage?.id === openAttachmentId ? looseImage : undefined);
  const selectedModel = models.find((m) => m.id === selectedModelId);
  const modelLimit = useContextLimit(selectedModel);
  const contextState = contextStateOf(conversation.messages, modelLimit);
  const lastUsage = [...conversation.messages].reverse().find((m) => m.role === "assistant" && m.usage)?.usage;
  const lastMessage = conversation.messages[conversation.messages.length - 1];
  // The command of the reply that needs the user now: waiting for permission, running or asking something
  const activeCommand = lastMessage?.commands?.find((run) => ["pending", "running", "asking"].includes(run.state));
  // A reply that starts by asking for a command shows its card at once, before any text
  const isWaitingForFirstToken =
    isReplying && lastMessage?.role === "assistant" && !lastMessage.content && !hasReplyCards(lastMessage);
  const isSearching = searchSteps?.some((step) => step.phase !== "done") ?? false;
  const thinking = isWaitingForFirstToken && lastMessage.reasoning?.text.trim() ? lastMessage.reasoning : undefined;
  const loadingSkillPill = !!loadingSkills?.length && (
    <span
      className="typing-skill"
      role="status"
      aria-label={t("chat.view.usingSkills", { count: loadingSkills.length, names: joinedList(loadingSkills) })}
    >
      <span className="typing-skill-spinner" aria-hidden="true" />
      <span aria-hidden="true">
        <Trans
          i18nKey="chat.view.using"
          values={{ names: joinedList(loadingSkills) }}
          components={{ name: <span className="mono" /> }}
        />
      </span>
    </span>
  );
  const isBusy = isStreaming || isSummarizing || isLoading;
  // An audio is transcribed again by asking for it, so it shows its progress and lands in a reply like the first time
  function transcribe(audio: Attachment) {
    const key = audio.transcript ? "transcription.viewer.againMessage" : "transcription.viewer.transcribeMessage";
    closeViewer();
    scroll.pin();
    onSend(t(key, { name: audio.name }), [], [], { skill: taskSkill?.name });
  }
  const transcribeButton = openAttachment?.kind === "audio" && !isBusy && (
    <button type="button" className="outline-button small" onClick={() => transcribe(openAttachment)}>
      <AudioLines size={14} strokeWidth={2} aria-hidden="true" />
      {t(openAttachment.transcript ? "transcription.viewer.again" : "transcription.viewer.transcribe")}
    </button>
  );
  const answersCommand = useAwaitingCommand(conversation.id);
  const reviews = useChatReviews({
    conversation,
    settledMessages,
    onUpdateChange,
    onFixChange,
    onAsk: (text) => {
      if (isBusy) return;
      scroll.pin();
      onSend(text, [], []);
    },
    closeFilesPanel: () => setIsFilesPanelOpen(false),
    onReviewChange,
  });
  const { changes, sheetVersions, changeAction, viewSheetVersion, saveSheetVersion, openVersionId } = reviews;
  const { applyAllChanges, discardAllChanges, changeStatus, closeVersion, closeReview } = reviews;
  const updateCommit = useStableCallback((index: number, proposal: CommitProposal) =>
    onUpdateCommit(conversation.id, index, proposal),
  );
  // Proposals of earlier replies still waiting (the latest one shows its own cards); hiding the notice lasts until a
  // new one arrives
  const pendingChanges = conversation.messages.slice(0, -1).flatMap((m, index) =>
    (m.workspaceChanges ?? []).filter((c) => c.status === "pending").map((c) => ({ index, id: c.id })),
  );
  const [hiddenPending, setHiddenPending] = useState<string[]>([]);
  const showPendingNotice = !isReplying && pendingChanges.some((p) => !hiddenPending.includes(p.id));

  // A change opens in the review; a command is shown with its «Ejecutar» focused, once its message is drawn
  const handledPendingId = useRef<number | null>(null);
  useEffect(() => {
    if (!pendingRequest || isLoading || pendingRequest.conversationId !== conversation.id) return;
    if (handledPendingId.current === pendingRequest.id) return;
    handledPendingId.current = pendingRequest.id;
    onPendingHandled?.();
    const { kind, itemId } = pendingRequest;
    const index = conversation.messages.findIndex((m, i) =>
      kind === "change"
        ? m.workspaceChanges?.some((c) => c.id === itemId)
        : kind === "commit"
          ? `commit-${i}` === itemId && m.commitProposal?.status === "pending"
          : m.commands?.some((r) => r.id === itemId),
    );
    if (index < 0) return;
    if (kind === "change") {
      changeAction(index, itemId, "review");
      return;
    }
    jumpToMessage(index);
    // A command's «Ejecutar», or the message of a commit, once its message is drawn
    const target = () =>
      kind === "commit"
        ? document.querySelector<HTMLElement>(`[data-message-index="${index}"] .commit-card textarea`)
        : document.getElementById(itemId)?.querySelector<HTMLElement>("[data-command-focus]");
    // The message may need a moment to be drawn and scrolled to. Not given up when the request is cleared, which
    // happens right after this.
    whenRendered(target, (element) => element.focus({ preventScroll: true }), 30);
  }, [pendingRequest, isLoading, conversation.id, conversation.messages, changeAction, jumpToMessage, onPendingHandled]);

  // A failed summary waits for the next reply instead of retrying in a loop
  const shouldAutoSummarize =
    autoSummarize &&
    !isBusy &&
    !summaryError &&
    !!contextState &&
    contextState.fraction >= SUMMARY_TRIGGER &&
    planSummary(conversation.messages, conversation.summary, contextState.limit, reservedTokens) !== null;
  const summarize = useStableCallback(() => onSummarize());

  useEffect(() => {
    if (shouldAutoSummarize) summarize();
  }, [shouldAutoSummarize, summarize]);

  // /compact: the same summary, whenever the user wants, keeping only the latest exchange. The limit falls back as
  // the summarizer's does, so the command is offered only when it will do something.
  const compactLimit = contextState?.limit ?? modelLimit?.limit ?? selectedModel?.contextWindow;
  // Not while busy: the command says so instead
  const canCompact =
    !isBusy &&
    !!compactLimit &&
    planSummary(conversation.messages, conversation.summary, compactLimit, reservedTokens, true) !== null;
  const commands: ComposerCommand[] = [
    {
      name: "compact",
      run: () => onSummarize(true),
      unavailable: isBusy
        ? t("chat.view.compactBusy")
        : !selectedModel
          ? t("chat.view.compactNoModel")
          : !canCompact
            ? t("chat.view.compactNothing")
            : undefined,
    },
    // The same as "Crear conversación nueva desde aquí" on the latest message
    {
      name: "fork",
      run: () => branch(conversation.messages.length - 1),
      unavailable: isBusy
        ? t("chat.view.forkBusy")
        : conversation.messages.length === 0
          ? t("chat.view.forkEmpty")
          : undefined,
    },
    // Like ⌘N / Ctrl+N, also while a reply is being written: it goes on in its conversation
    { name: "new", run: onNewConversation },
    {
      name: "init",
      run: () => writeGuide("", []),
      unavailable: !conversation.workspace
        ? t("commands.init.noFolder")
        : isBusy
          ? t("commands.init.busy")
          : undefined,
    },
  ];

  // /init: the reply writes the project's NYRA.md; what the user adds goes as the message
  function writeGuide(extra: string, attachments: Attachment[]) {
    onSend(extra || t("commands.init.message"), attachments, referenceIds, { writesGuide: true });
  }

  function submit(attachments: Attachment[]) {
    scroll.pin();
    setUndoDelete(null);
    const text = draftOf(conversation.id).trim();
    // A command waits for the user: what they wrote answers Nyra in the same reply, and the command isn't run
    if (answersCommand) {
      if (answerInstead(conversation.id, text)) setDraftOf(conversation.id, "");
      return;
    }
    const forNew = messageForNew(text);
    const forGuide = conversation.workspace ? initRequestOf(text) : null;
    const skill = invokedSkill.skill ?? undefined;
    // Files referenced from this conversation don't exist in the new one; attached ones go with the message
    if (forNew || (forNew === "" && attachments.length > 0)) {
      // In a project, the new conversation stays in it, with its folder
      const project = conversation.projectId
        ? { projectId: conversation.projectId, workspace: conversation.workspace }
        : {};
      onSend(forNew, attachments, [], { skill, newConversation: true, ...project });
    } else if (forNew === "") {
      onNewConversation();
    } else if (forGuide !== null) {
      writeGuide(forGuide, attachments);
    } else {
      // The task's skill goes with every message, unless one was chosen for this one
      onSend(text, attachments, referenceIds, { skill: skill ?? taskSkill?.name });
    }
    invokedSkill.clear();
    setDraftOf(conversation.id, "");
    setReferenceIds([]);
  }

  function addReference(attachment: Attachment) {
    setReferenceIds((ids) => (ids.includes(attachment.id) ? ids : [...ids, attachment.id]));
  }

  // The documents in replies show the conversation's images they name, also in a shared image of the reply
  return (
    <ConversationImagesContext value={images}>
    <main className={`main chat-main ${changes.open || sheetVersions.open ? "reviewing" : ""}`} ref={mainRef}>
      <div className="chat-pane">
        <header className="chat-header">
          <div className="chat-header-title">
            <h1>{conversation.title}</h1>
            {conversation.isIsolated ? (
              <span className="private-badge" title={t("chat.isolated.description")}>
                <ShieldCheck size={12} strokeWidth={2.4} />
                {t("chat.isolated.label")}
              </span>
            ) : (
              conversation.isPrivate && (
                <span className="private-badge" title={t("chat.private.description")}>
                  <Lock size={12} strokeWidth={2.4} />
                  {t("chat.private.label")}
                </span>
              )
            )}
            {taskSkill && (
              <span className="task-skill-pill" title={t("chat.view.taskSkillTitle", { name: taskSkill.name })}>
                <span aria-hidden="true">✦</span>
                {taskSkill.label}
                <button
                  type="button"
                  aria-label={t("chat.view.removeTaskSkill", { name: taskSkill.label })}
                  title={t("chat.view.removeTaskSkillTitle")}
                  onClick={taskSkill.onRemove}
                >
                  <X size={12} strokeWidth={2.4} />
                </button>
              </span>
            )}
            {selectedModel && (
              <span className="model-badge">
                <span className="status-dot loaded" />
                {selectedModel.name}
              </span>
            )}
          </div>
          <div className="chat-header-actions">
            {(processes.length > 0 || isProcessesPanelOpen) && (
              <button
                type="button"
                className={`files-button ${isProcessesPanelOpen ? "active" : ""}`}
                aria-pressed={isProcessesPanelOpen}
                aria-label={t("chat.view.processesLabel", { count: processes.length })}
                onClick={() => {
                  setIsProcessesPanelOpen((open) => !open);
                  setIsFilesPanelOpen(false);
                }}
              >
                <Activity size={16} strokeWidth={1.9} />
                {t("chat.view.processes")}
                <span className={`files-count ${processes.length > 0 ? "has-files" : ""}`}>{processes.length}</span>
              </button>
            )}
            <button
              type="button"
              className={`files-button ${isFilesPanelOpen ? "active" : ""}`}
              aria-pressed={isFilesPanelOpen}
              aria-label={t("chat.view.filesLabel", { count: attachments.length })}
              onClick={() => {
                setIsFilesPanelOpen((open) => !open);
                setIsProcessesPanelOpen(false);
              }}
            >
              <FolderOpen size={16} strokeWidth={1.9} />
              {t("chat.view.files")}
              <span className={`files-count ${attachments.length > 0 ? "has-files" : ""}`}>{attachments.length}</span>
            </button>
          </div>
        </header>

        {search.isOpen && (
          <ChatSearchBar
            query={search.query}
            onQueryChange={search.changeQuery}
            matchCount={search.matchCount}
            currentNumber={search.currentNumber}
            onOlder={search.older}
            onNewer={search.newer}
            onClose={search.close}
          />
        )}

        <section
          aria-label={t("chat.view.messages")}
          className="messages"
          ref={containerRef}
          onScroll={() => {
            scroll.onScroll();
            messageWindow.onScroll();
          }}
        >
          <div className="column" ref={contentRef}>
            {messageWindow.first > 0 ? (
              <p role="status" className="earlier-messages">
                {t("chat.view.earlier", { count: messageWindow.first })}
              </p>
            ) : (
              <div className="date-divider">
                <span className="line" />
                <span className="diamond" />
                {t("chat.view.today")}
                <span className="diamond" />
                <span className="line" />
              </div>
            )}

            {isLoading && (
              <p role="status" className="earlier-messages">
                {t("chat.view.loading")}
              </p>
            )}

            {conversation.messages.slice(messageWindow.first).map((m, offset) => {
              const i = messageWindow.first + offset;
              const isLast = i === conversation.messages.length - 1;
              if (isLast && isWaitingForFirstToken) return null;
              return (
                <Fragment key={i}>
                  {conversation.summary?.fromIndex === i && <SummaryDivider summary={conversation.summary.text} />}
                  {modelChanges.has(i) && (
                    <div className="date-divider model-change" role="separator">
                      <span className="line" />
                      {t("chat.view.fromHere", { model: modelChanges.get(i) })}
                      <span className="line" />
                    </div>
                  )}
                  <MessageItem
                    message={m}
                    attachmentsById={byId}
                    isSummarized={!!conversation.summary && i < conversation.summary.fromIndex}
                    onOpenAttachment={openViewer}
                    onRegenerate={isLast && !isBusy && m.role === "assistant" ? regenerate : undefined}
                    index={i}
                    onEditMessage={isBusy ? undefined : editMessage}
                    onDeleteMessage={isBusy ? undefined : deleteMessage}
                    isOnlyExchange={i === 0 && conversation.messages.length <= 2}
                    onDeleteConversation={deleteConversation}
                    onChangeAction={changeAction}
                    onUpdateCommit={m.commitProposal ? updateCommit : undefined}
                    commitRoot={m.commitProposal ? conversation.workspace?.path : undefined}
                    onApplyAllChanges={applyAllChanges}
                    onDiscardAllChanges={discardAllChanges}
                    changeStatus={m.workspaceChanges ? changeStatus : undefined}
                    onBranch={isBusy ? undefined : branch}
                    hasLaterMessages={i < conversation.messages.length - 2}
                    onShare={isLast && isReplying ? undefined : share}
                    isWriting={isLast && isReplying}
                    onSelectVersion={isLast && !isBusy ? selectReplyVersion : undefined}
                    sentTo={sentTo[i]}
                    chosenSkill={m.role === "assistant" ? conversation.messages[i - 1]?.skill : undefined}
                    conversationId={m.browser ? conversation.id : undefined}
                    onOpenSkill={openSkill}
                    onOpenMemories={openMemories}
                    onOpenWorkspaceFile={openWorkspaceFile}
                    onShowWorkspaceFile={showWorkspaceFile}
                    onViewSheetVersion={viewSheetVersion}
                    onSaveSheetVersion={saveSheetVersion}
                    openSheetVersionId={m.sheetVersions ? openVersionId : undefined}
                  />
                </Fragment>
              );
            })}

            {isWaitingForFirstToken && (
              <div className="typing">
                <div className="typing-body">
                  {/* First and always while waiting, so it never moves: what comes up while Nyra works goes below it */}
                  <div className="typing-dots" role="status" aria-label={t("chat.view.writing")}>
                    <span />
                    <span />
                    <span />
                  </div>
                  {/* Where the ✦ will be once it answers, so it's clear where the button comes from */}
                  {thinking ? (
                    <ReasoningSummary reasoning={thinking} isThinking={!isSearching} aside={loadingSkillPill} />
                  ) : (
                    loadingSkillPill
                  )}
                  {searchSteps && <WebSearchProgress steps={searchSteps} />}
                  {workspaceSteps && workspaceSteps.length > 0 && <WorkspaceSteps steps={workspaceSteps} />}
                </div>
              </div>
            )}

            {sheetVersions.error && (
              <ErrorNotice title={sheetVersions.error}>
                <button type="button" className="link-button" onClick={sheetVersions.clearError}>
                  {t("chat.view.close")}
                </button>
              </ErrorNotice>
            )}

            {workspaceFiles.error && (
              <ErrorNotice title={workspaceFiles.error}>
                <button type="button" className="link-button" onClick={workspaceFiles.dismissError}>
                  {t("chat.view.close")}
                </button>
              </ErrorNotice>
            )}

            {shareError && (
              <ErrorNotice title={shareError}>
                <button type="button" className="link-button" onClick={dismissShareError}>
                  {t("chat.view.close")}
                </button>
              </ErrorNotice>
            )}

            {error && (
              <ErrorNotice title={error}>
                <div className="notice-actions">
                  <button type="button" className="link-button" onClick={regenerate}>
                    {t("common.retry")}
                  </button>
                  <button type="button" className="link-button" onClick={onOpenSettings}>
                    {t("chat.view.reviewSettings")}
                  </button>
                </div>
              </ErrorNotice>
            )}
          </div>
        </section>

        <div className="chat-footer">
          <div className="column">
            {(isSummarizing || summaryError) && (
              <SummaryStatus error={summaryError} onRetry={onRetrySummary} onCancel={onCancelSummary} />
            )}
            {isReplying && <CommandReminder run={activeCommand} />}
            {showPendingNotice && (
              <PendingChangesNotice
                count={pendingChanges.length}
                onShow={() => jumpToMessage(pendingChanges[0].index)}
                onDismiss={() => setHiddenPending(pendingChanges.map((p) => p.id))}
              />
            )}
            {undoDelete && (
              <MessageUndoNotice
                onUndo={() => {
                  undoDelete();
                  setUndoDelete(null);
                }}
                onExpire={() => setUndoDelete(null)}
              />
            )}
            {aboveComposer}
            <BrowserStrip conversationId={conversation.id} />
            <ScreenStrip conversationId={conversation.id} />
            <TranscriptionStrip conversationId={conversation.id} />
            <DraftComposer
              place={conversation.id}
              onSubmit={submit}
              models={models}
              selectedModelId={selectedModelId}
              onSelectModel={onSelectModel}
              modelPreference={modelPreference}
              variant="chat"
              isStreaming={isStreaming}
              answersCommand={answersCommand}
              isLocked={isSummarizing || isLoading}
              onStop={onStop}
              onOpenSettings={onOpenSettings}
              contextState={contextState}
              contextUsedWithoutLimit={contextState ? undefined : lastUsage?.used}
              history={{ messages: conversation.messages, summary: conversation.summary }}
              dropZoneRef={mainRef}
              references={pendingReferences}
              onRemoveReference={(id) => setReferenceIds((ids) => ids.filter((x) => x !== id))}
              onSearch={search.open}
              browserConversationId={canOpenBrowser ? conversation.id : undefined}
              skillNames={skillNames}
              onChangeSkills={onChangeSkills}
              invokedSkill={invokedSkill}
              commands={commands}
              isSkillPickerOpen={isSkillPickerOpen}
              onSkillPickerOpenChange={setIsSkillPickerOpen}
              onManageSkills={onManageSkills}
              onShowCommands={onShowCommands}
              onOpenFeatureSettings={onOpenFeatureSettings}
              workspace={{
                folder: conversation.workspace ?? null,
                isPrivate: !!conversation.isPrivate,
                // A project's conversation always works in the project's folder
                onChange: conversation.projectId ? undefined : onChangeWorkspace,
              }}
              shortcutsEnabled={!isHidden}
              isIsolated={!!conversation.isIsolated}
            />
            <Disclaimer />
          </div>
        </div>
      </div>

      <LoadErrorBoundary>
        <Suspense fallback={null}>
          {changes.open && changes.openChange && (
            changes.openChange.kind === "cells" ? (
              <CellsReviewPanel
                changes={conversation.messages[changes.open.index]?.workspaceChanges ?? []}
                change={changes.openChange}
                review={changes.openReview?.kind === "cells" ? changes.openReview : undefined}
                onSelect={(id) => changes.open && void changes.act(changes.open.index, id, "review")}
                onAction={(action) => changes.open && void changes.act(changes.open.index, changes.open.id, action)}
                onClose={closeReview}
                isBusy={changes.busy.has(changes.openChange.id)}
                error={changes.errors.get(changes.openChange.id)}
              />
            ) : (
              <ChangeReviewPanel
                changes={conversation.messages[changes.open.index]?.workspaceChanges ?? []}
                change={changes.openChange}
                review={changes.openReview?.kind === "text" ? changes.openReview : undefined}
                onSelect={(id) => changes.open && void changes.act(changes.open.index, id, "review")}
                onAction={(action) => changes.open && void changes.act(changes.open.index, changes.open.id, action)}
                onClose={closeReview}
                isBusy={changes.busy.has(changes.openChange.id) || changes.fixing.has(changes.openChange.id)}
                error={changes.errors.get(changes.openChange.id)}
              />
            )
          )}
          {sheetVersions.open && !changes.open && (
            <SheetVersionPanel
              {...sheetVersions.open}
              onSave={() => openVersionId && saveSheetVersion(openVersionId)}
              onClose={closeVersion}
            />
          )}
        </Suspense>
      </LoadErrorBoundary>
      <span className="visually-hidden" role="status">
        {changes.announcement}
      </span>
      {isProcessesPanelOpen && (
        <ProcessesPanel
          processes={processes}
          onShowMessage={showProcessMessage}
          onClose={() => setIsProcessesPanelOpen(false)}
        />
      )}
      {isFilesPanelOpen && (
        <AttachmentsPanel
          attachments={attachments}
          states={fileStates}
          pendingReferenceIds={referenceIds}
          onReference={addReference}
          openId={openAttachmentId}
          onOpen={openViewer}
          origins={fileOrigins}
          onShowMessage={showFileMessage}
          sheetVersions={sheetVersions.versions}
          onViewSheetVersion={viewSheetVersion}
          onSaveSheetVersion={saveSheetVersion}
          onRestoreSheetVersion={isBusy ? undefined : onRestoreSheetVersion}
          onClose={() => setIsFilesPanelOpen(false)}
        />
      )}
      {openAttachment && (
        <LazyAttachmentViewer
          attachment={openAttachment}
          onClose={closeViewer}
          actions={transcribeButton || undefined}
        />
      )}
      {workspaceFiles.file && <LazyAttachmentViewer attachment={workspaceFiles.file} onClose={workspaceFiles.close} />}
      {shareCard &&
        createPortal(
          <div className="share-stage" aria-hidden="true">
            <ShareCard ref={shareCardRef} {...shareCard} />
          </div>,
          document.body,
        )}
    </main>
    </ConversationImagesContext>
  );
}
