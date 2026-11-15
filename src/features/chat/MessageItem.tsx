import { GitBranchPlus, RotateCw } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { citationsOf } from "@/features/markdown/citations";
import { replyAsMarkdown } from "@/features/documents/documents";
import { formatDuration } from "@/shared/lib/format";
import { i18n } from "@/shared/i18n/i18n";
import type { ChangeAction } from "@/features/workspace/useWorkspaceChanges";
import { preparingChanges } from "@/features/workspace/fileChanges";
import { withoutMemoryTags } from "@/features/memory/memories";
import type { ShareAction } from "@/features/share/share";
import type { Attachment, CommitProposal, Message, ReplyStats } from "@/shared/types";
import { CitedSources } from "@/features/web/CitedSources";
import { CopyButton } from "@/shared/ui/CopyButton";
import { ChangeProposals } from "@/features/workspace/ChangeProposals";
import { CommitCard } from "@/features/projects/CommitCard";
import { withoutCommitTag } from "@/features/projects/commits";
import { SheetVersionCards } from "@/features/attachments/SheetVersionCards";
import { MemoriesSavedNotice } from "@/features/memory/MemoriesSavedNotice";
import { WorkspaceConsultButton } from "@/features/workspace/WorkspaceConsultButton";
import { PreparingChanges } from "@/features/workspace/PreparingChanges";
import { BrowserCard } from "@/features/browser/BrowserCard";
import { ReplyScreenshots } from "@/features/browser/ReplyScreenshots";
import { ScreenCard } from "@/features/screen-look/ScreenCard";
import { ReasoningSummary } from "./ReasoningSummary";
import { type ReplyCard, ReplyContent } from "./ReplyContent";
import { TranscriptCard } from "@/features/transcription/TranscriptCard";
import { ToolCallCard } from "@/features/mcp/ToolCallCard";
import { ReplyVersionSwitcher } from "./ReplyVersionSwitcher";
import { SearchFailedNotice } from "@/features/web/SearchFailedNotice";
import { ShareMenu } from "@/features/share/ShareMenu";
import { SkillsUsedButton } from "@/features/skills/SkillsUsedButton";
import { UserMessage } from "./UserMessage";
import { WebSearchSummary } from "@/features/web/WebSearchSummary";

type Props = {
  message: Message;
  // Stable across the frames of a streaming reply, so it doesn't undo the memoization below
  attachmentsById: Map<string, Attachment>;
  isSummarized: boolean;
  onOpenAttachment: (attachment: Attachment) => void;
  // Only the latest reply can be regenerated
  onRegenerate?: () => void;
  index: number;
  // Shared by every message (stable), so each message passes its own index
  onEditMessage?: (index: number, text: string, removedFiles: string[]) => void;
  // Stable like onEditMessage; undefined while a reply is being written
  onDeleteMessage?: (index: number) => void;
  // The conversation is only this message (and its reply): deleting it deletes the conversation
  isOnlyExchange?: boolean;
  onDeleteConversation?: () => void;
  // Stable like onEditMessage; undefined while a reply is being written
  onBranch?: (index: number) => void;
  hasLaterMessages: boolean;
  // Stable like onEditMessage; undefined while this reply is still being written
  onShare?: (index: number, action: ShareAction) => Promise<boolean>;
  // This reply is still arriving
  isWriting?: boolean;
  // Stable like onEditMessage; only for the latest reply, and not while a reply is being written
  onSelectVersion?: (index: number, version: number) => void;
  // For a user message: the cloud provider it reached through a later reply
  sentTo?: string;
  // For a reply: the skill the user chose with "/" for the message it answers
  chosenSkill?: string;
  // For a reply that used the browser: the conversation whose browser its card follows
  conversationId?: string;
  // Stable like onEditMessage: opens a skill in Settings
  onOpenSkill?: (name: string) => void;
  // Stable like onEditMessage: opens the memories in Settings
  onOpenMemories?: () => void;
  // Stable like onEditMessage: a file of the folder a reply consulted, in the viewer or the file manager
  onOpenWorkspaceFile?: (root: string, path: string) => void;
  onShowWorkspaceFile?: (root: string, path: string) => void;
  // Stable like onEditMessage: what the user does with the changes a reply proposed
  onChangeAction?: (index: number, id: string, action: ChangeAction) => void;
  // Versions of attached spreadsheets a reply made: reviewing and saving them (stable)
  onViewSheetVersion?: (id: string) => void;
  onSaveSheetVersion?: (id: string) => void;
  // Only for a reply that made versions, so the others keep their memoization
  openSheetVersionId?: string;
  onApplyAllChanges?: (index: number) => void;
  onDiscardAllChanges?: (index: number) => void;
  // Stable like onEditMessage: the user made, discarded or recovered the commit a reply proposed
  onUpdateCommit?: (index: number, proposal: CommitProposal) => void;
  // The folder a proposed commit is made in; the conversation's connected folder
  commitRoot?: string;
  // Only for a reply with proposed changes, so the others keep their memoization
  changeStatus?: {
    busy: ReadonlySet<string>;
    fixing: ReadonlySet<string>;
    errors: ReadonlyMap<string, string>;
    openId?: string;
  };
};

function statsLabel({ outputTokens, durationMs }: ReplyStats) {
  return i18n.t("chat.message.stats", { count: outputTokens, duration: formatDuration(durationMs) });
}

// Memoized so streaming tokens only re-render the message that changes, not the whole history
export const MessageItem = memo(function MessageItem(props: Props) {
  const { message, attachmentsById, isSummarized, onOpenAttachment, onRegenerate, index, onEditMessage } = props;
  const { onBranch, hasLaterMessages, onShare, isWriting = false, onSelectVersion, sentTo, chosenSkill } = props;
  const { onOpenSkill, onOpenMemories, onOpenWorkspaceFile, onShowWorkspaceFile } = props;
  const { onDeleteMessage, isOnlyExchange = false, onDeleteConversation, conversationId } = props;
  const { t } = useTranslation();
  const consult = message.workspaceConsult;
  const { onChangeAction, onApplyAllChanges, onDiscardAllChanges, changeStatus } = props;
  const { onViewSheetVersion, onSaveSheetVersion, openSheetVersionId, onUpdateCommit, commitRoot } = props;
  // While it arrives, the change and commit tags are hidden and the changed files show as being prepared
  const writing = isWriting ? preparingChanges(withoutCommitTag(withoutMemoryTags(message.content))) : null;
  const [areSourcesOpen, setAreSourcesOpen] = useState(false);
  const searched = message.webSearch;
  const citations = useMemo(() => (searched ? citationsOf(message.content, searched) : null), [searched, message.content]);
  const reasoning = message.reasoning?.text.trim() ? message.reasoning : undefined;
  const searchLine = searched && searched.steps.length > 0 && citations ? { steps: searched.steps, citations } : null;
  // A reply's own images are the screenshots it took in the browser; its other files have cards of their own
  const screenshots = message.attachments?.filter((a) => a.kind === "image") ?? [];
  // What the reply did in the browser, and the transcripts it got, as documents, each where it asked for it
  const replyCards: ReplyCard[] = [
    ...(message.browser?.steps.length && conversationId
      ? [
          {
            at: message.browser.at,
            key: "browser",
            card: (
              <BrowserCard
                record={message.browser}
                conversationId={conversationId}
                isLive={!!isWriting}
                onOpenImage={onOpenAttachment}
              />
            ),
          },
        ]
      : []),
    ...(message.screen?.steps.length
      ? [{ at: message.screen.at, key: "screen", card: <ScreenCard record={message.screen} /> }]
      : []),
    ...(message.toolCalls ?? []).map((call) => ({
      at: call.at,
      key: `tool-${call.id}`,
      card: <ToolCallCard call={call} />,
    })),
    ...(message.transcripts ?? []).flatMap(({ at, id }) => {
      const transcript = attachmentsById.get(id);
      return transcript ? [{ at, key: `transcript-${id}`, card: <TranscriptCard transcript={transcript} /> }] : [];
    }),
  ];
  // The one chosen with "/" first, then the ones the model asked for
  const skillNames = [...new Set([...(chosenSkill ? [chosenSkill] : []), ...(message.skillsUsed ?? [])])];
  const skillsButton = (compact: boolean) =>
    skillNames.length > 0 && (
      <SkillsUsedButton names={skillNames} chosenByUser={chosenSkill} compact={compact} onOpenSkill={onOpenSkill} />
    );
  if (message.role === "user") {
    return (
      <UserMessage
        index={index}
        message={message}
        attachmentsById={attachmentsById}
        isSummarized={isSummarized}
        onOpenAttachment={onOpenAttachment}
        onEdit={onEditMessage && ((text, removedFiles) => onEditMessage(index, text, removedFiles))}
        onDelete={onDeleteMessage && (() => onDeleteMessage(index))}
        isOnlyExchange={isOnlyExchange}
        onDeleteConversation={onDeleteConversation}
        hasLaterMessages={hasLaterMessages}
        sentTo={sentTo}
      />
    );
  }

  return (
    <div className="assistant-message" data-message-index={index}>
      <div className="assistant-body">
        <div className="assistant-meta">
          <span className="assistant-name">Nyra</span>
          {message.model && <span className="assistant-model">{message.model}</span>}
          {/* Without a reasoning or search line it sits here, so the reply doesn't get a row for one icon */}
          {!reasoning && !searchLine && skillsButton(true)}
        </div>
        {/* Always last on the line, so "Pensó…" and "Buscó…" stay where they are in every reply */}
        {reasoning && (
          <ReasoningSummary
            reasoning={reasoning}
            isThinking={isWriting && reasoning.thinkingSince !== undefined}
            aside={!searchLine && skillsButton(false)}
          />
        )}
        {searchLine && (
          <WebSearchSummary
            steps={searchLine.steps}
            citations={searchLine.citations}
            isExpanded={areSourcesOpen}
            onToggle={() => setAreSourcesOpen((open) => !open)}
            aside={skillsButton(false)}
          />
        )}
        {searched?.failed && searched.steps.length === 0 && <SearchFailedNotice onRetry={onRegenerate} />}
        {consult && (
          <WorkspaceConsultButton
            consult={consult}
            onOpenFile={onOpenWorkspaceFile && ((path) => onOpenWorkspaceFile(consult.root, path))}
            onReveal={onShowWorkspaceFile && ((path) => onShowWorkspaceFile(consult.root, path))}
          />
        )}
        {/* A tag to save a memory goes at the end, and is taken out once the reply ends */}
        <ReplyContent
          content={writing ? writing.text : message.content}
          isWriting={isWriting}
          citations={citations}
          commands={message.commands}
          cards={replyCards}
        />
        {/* The list above already shows them while it is open */}
        {citations && !isWriting && !areSourcesOpen && <CitedSources citations={citations} />}
        {screenshots.length > 0 && <ReplyScreenshots shots={screenshots} onOpen={onOpenAttachment} />}
        {writing && writing.paths.length > 0 && <PreparingChanges paths={writing.paths} />}
        {message.workspaceChanges && message.workspaceChanges.length > 0 && !isWriting && onChangeAction && (
          <ChangeProposals
            changes={message.workspaceChanges}
            onAction={(id, action) => onChangeAction(index, id, action)}
            onApplyAll={() => onApplyAllChanges?.(index)}
            onDiscardAll={() => onDiscardAllChanges?.(index)}
            busy={changeStatus?.busy ?? new Set()}
            fixing={changeStatus?.fixing ?? new Set()}
            errors={changeStatus?.errors ?? new Map()}
            openId={changeStatus?.openId}
          />
        )}
        {message.commitProposal && !isWriting && commitRoot && onUpdateCommit && (
          <CommitCard
            proposal={message.commitProposal}
            root={commitRoot}
            changesKey={(message.workspaceChanges ?? []).map((c) => `${c.id}:${c.status}`).join()}
            onUpdate={(proposal) => onUpdateCommit(index, proposal)}
          />
        )}
        {message.sheetVersions && message.sheetVersions.length > 0 && !isWriting && onViewSheetVersion && (
          <SheetVersionCards
            versions={message.sheetVersions}
            onView={onViewSheetVersion}
            onSave={(id) => onSaveSheetVersion?.(id)}
            openId={openSheetVersionId}
          />
        )}
        {message.memoriesSaved && message.memoriesSaved.length > 0 && !isWriting && (
          <MemoriesSavedNotice saved={message.memoriesSaved} onOpenMemories={onOpenMemories} />
        )}
        <div className="message-actions">
          {onSelectVersion && !!message.otherVersions?.length && (
            <ReplyVersionSwitcher
              current={message.versionIndex ?? message.otherVersions.length}
              total={message.otherVersions.length + 1}
              onSelect={(version) => onSelectVersion(index, version)}
            />
          )}
          <CopyButton text={() => replyAsMarkdown(message.content)} label={t("chat.message.copy")} />
          {onRegenerate && (
            <button
              type="button"
              className="icon-button small"
              aria-label={t("chat.message.regenerate")}
              title={t("chat.message.regenerateTitle")}
              onClick={onRegenerate}
            >
              <RotateCw size={16} strokeWidth={1.8} />
            </button>
          )}
          {onBranch && (
            <button
              type="button"
              className="icon-button small"
              aria-label={t("chat.message.branch")}
              title={t("chat.message.branchTitle")}
              onClick={() => onBranch(index)}
            >
              <GitBranchPlus size={16} strokeWidth={1.8} />
            </button>
          )}
          {onShare && <ShareMenu onShare={(action) => onShare(index, action)} />}
          {message.stats && (
            <span className="message-stats" title={t("chat.message.statsTitle")}>
              {statsLabel(message.stats)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});
