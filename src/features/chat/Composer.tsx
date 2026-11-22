import { ArrowUp, CircleAlert, Sparkles, Square } from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trans, useTranslation } from "react-i18next";
import { BrowserButton } from "@/features/browser/BrowserButton";
import { useMemoriesContext } from "@/features/memory/memoriesContext";
import { usePreferencesContext } from "@/features/settings/preferencesContext";
import { useProviderSettingsContext } from "@/features/models/providerSettingsContext";
import { useSkillsContext } from "@/features/skills/skillsContext";
import { useWorkspacesContext } from "@/features/workspace/workspacesContext";
import { useComposerAttachments } from "@/features/attachments/useComposerAttachments";
import { useContextLimit } from "@/features/chat/reply/useContextLimit";
import { useFileDrop } from "@/features/attachments/useFileDrop";
import type { InvokedSkill } from "@/features/skills/useInvokedSkill";
import type { Skill } from "@/features/skills/skills";
import { useSensitiveData } from "@/features/sensitive-data/useSensitiveData";
import { useShortcut } from "@/shared/hooks/useShortcut";
import { useSkillCommand } from "@/features/skills/useSkillCommand";
import type { ComposerCommand } from "@/features/chat/reply/commands";
import { menuModels } from "@/features/models/modelGroups";
import { SHORTCUTS } from "@/shared/lib/shortcuts";
import { errorMessage } from "@/shared/lib/errors";
import { indexBudget, indexText, plannedWorkspaceContext } from "@/features/workspace/workspace";
import { getProvider } from "@/providers";
import { ACCEPTED_FILES, pastedFiles } from "@/features/attachments/attachments";
import { hideSecrets, labelsOf } from "@/features/sensitive-data/sensitiveData";
import { linksIn } from "@/features/web/webLinks";
import type { ContextState } from "@/features/chat/reply/context";
import { contextParts } from "@/features/chat/reply/contextBreakdown";
import { buildUserRules, withoutPersonalData } from "@/features/chat/reply/userRules";
import { activeSkillsTokens, HEAVY_SKILLS_SHARE } from "@/features/skills/skills";
import type { Attachment, ConversationSummary, Message, Model, WorkspaceFolder } from "@/shared/types";
import { ComposerAttachments } from "@/features/attachments/ComposerAttachments";
import { FileErrorNotice } from "@/features/attachments/FileErrorNotice";
import { ComposerMenu } from "./ComposerMenu";
import { ContextIndicator } from "./ContextIndicator";
import { DropOverlay } from "@/features/attachments/DropOverlay";
import { DictationButton } from "@/features/dictation/DictationButton";
import { DictationNotice } from "@/features/dictation/DictationNotice";
import { MeetingButton } from "@/features/meeting/MeetingButton";
import { MeetingNotice } from "@/features/meeting/MeetingNotice";
import { useDictation } from "@/features/dictation/useDictation";
import { HeavySkillsNotice } from "@/features/skills/HeavySkillsNotice";
import { ModelSelector } from "@/features/models/ModelSelector";
import type { ModelPreference } from "@/features/models/ModelMenu";
import { RemoveButton } from "@/shared/ui/RemoveButton";
import { SensitiveDataIndicator } from "@/features/sensitive-data/SensitiveDataIndicator";
import { SkillCommandMenu } from "@/features/skills/SkillCommandMenu";
import { FileMentionMenu } from "@/features/workspace/FileMentionMenu";
import { useFileMention } from "@/features/workspace/useFileMention";
import { SkillPicker } from "@/features/skills/SkillPicker";
import { WorkspaceChip } from "@/features/workspace/WorkspaceChip";
import { WorkspaceNotice } from "@/features/workspace/WorkspaceNotice";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (attachments: Attachment[]) => void;
  models: Model[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  variant: "welcome" | "chat";
  // In place of the variant's own and of the invoked skill's
  placeholder?: string;
  // In a project of the Código space, its preferred model in the model menu
  modelPreference?: ModelPreference;
  isStreaming?: boolean;
  // A command of the reply waits for the user: what they write answers Nyra instead of running it. Text only, so
  // files attached meanwhile stay for a later message.
  answersCommand?: boolean;
  // Blocks sending without offering to stop, e.g. while the conversation is being summarized
  isLocked?: boolean;
  onStop?: () => void;
  onOpenSettings: () => void;
  contextState?: ContextState | null;
  // What the latest reply used while the model's context isn't known yet
  contextUsedWithoutLimit?: number;
  // The conversation, to break down what fills the context
  history?: { messages: Message[]; summary?: ConversationSummary };
  // Area that accepts dropped files and shows the drop overlay; larger than the composer itself
  dropZoneRef: RefObject<HTMLElement | null>;
  // Files from earlier in the conversation to send again with this message
  references?: Attachment[];
  onRemoveReference?: (id: string) => void;
  onSearch?: () => void;
  // With the browser feature on and a browser installed: the conversation whose browser the globe button opens
  browserConversationId?: string;
  // Names of the active skills; with a conversation open they belong to it, on the welcome screen to the next one
  skillNames: string[];
  onChangeSkills: (names: string[]) => void;
  // Controlled, because the chat header also opens the picker
  isSkillPickerOpen: boolean;
  onSkillPickerOpenChange: (open: boolean) => void;
  onManageSkills: () => void;
  // The skill chosen with "/" (or a welcome card) for the next message; the view that sends owns it
  invokedSkill: InvokedSkill;
  // The app's commands the "/" list offers above the skills
  commands?: ComposerCommand[];
  // Settings → Comandos y atajos, from the "/" list
  onShowCommands?: () => void;
  // Settings → General → Funciones de Nyra, from the sensitive data notice
  onOpenFeatureSettings?: () => void;
  // The folder connected to the conversation, or to the next one on the welcome screen
  workspace?: {
    folder: WorkspaceFolder | null;
    // A private conversation: its folder is allowed only until Nyra closes, and it doesn't use the memories
    isPrivate: boolean;
    // Missing when the folder can't be changed nor disconnected (a project's)
    onChange?: (folder: WorkspaceFolder | null) => void;
  };
  // Off while Settings cover the chat
  shortcutsEnabled?: boolean;
  // Only the model and the files: no skills, folder, browser nor pasted links read from the web
  isIsolated?: boolean;
};

const NO_COMMANDS: ComposerCommand[] = [];
const NO_SKILLS: Skill[] = [];

export function Composer(props: Props) {
  const {
    value,
    onChange,
    onSubmit,
    models,
    selectedModelId,
    onSelectModel,
    variant,
    placeholder,
    modelPreference,
    isStreaming,
    answersCommand = false,
    isLocked,
    onStop,
    onOpenSettings,
    contextState = null,
    contextUsedWithoutLimit,
    history,
    dropZoneRef,
    references = [],
    onRemoveReference,
    onSearch,
    browserConversationId,
    skillNames,
    onChangeSkills,
    isSkillPickerOpen,
    onSkillPickerOpenChange,
    onManageSkills,
    invokedSkill,
    commands = NO_COMMANDS,
    onShowCommands,
    onOpenFeatureSettings,
    shortcutsEnabled = true,
    isIsolated = false,
  } = props;
  const workspace = isIsolated ? undefined : props.workspace;
  // An isolated conversation is private as well
  const isPrivate = isIsolated || !!props.workspace?.isPrivate;
  const { skills: installedSkills } = useSkillsContext();
  const skills = isIsolated ? NO_SKILLS : installedSkills;
  const { optionsFor, hiddenModelIds } = useProviderSettingsContext();
  const { preferences } = usePreferencesContext();
  const { memories } = useMemoriesContext();
  const { t } = useTranslation();
  const {
    attachments,
    pendingPdfs,
    pendingPages,
    pendingAudios,
    fileError,
    addFiles,
    addAttachment,
    addLinks,
    cancelPage,
    cancelAudio,
    removeAttachment,
    replaceAttachments,
    cancelPdf,
    clearAttachments,
    dismissFileError,
  } = useComposerAttachments();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const drag = useFileDrop(dropZoneRef, addFiles);
  const visibleModels = menuModels(models, hiddenModelIds, selectedModelId);
  // /model is offered everywhere, also on the welcome screen, where there are no other commands
  const allCommands: ComposerCommand[] = [
    ...commands,
    {
      name: "model",
      unavailable: visibleModels.length === 0 ? t("chat.composer.noModels") : undefined,
    },
  ];
  const command = useSkillCommand({
    text: value,
    onTextChange: onChange,
    skills,
    commands: allCommands,
    invokedSkill,
    models: visibleModels,
    onSelectModel,
  });

  const isWelcome = variant === "welcome";
  const model = models.find((m) => m.id === selectedModelId);
  const outgoingFiles = [...attachments, ...references];
  const hasImages = outgoingFiles.some((a) => a.kind === "image");
  const imagesUnsupported = hasImages && model?.supportsImages === false;
  // A PDF of plain text has no pictures to lose
  const pdfImagesUnsupported =
    outgoingFiles.some((a) => a.kind === "pdf" && (a.visuals?.length || a.pages?.length)) &&
    model?.supportsImages === false;
  const hasContent = value.trim().length > 0 || outgoingFiles.length > 0;
  const isReadingFiles = pendingPdfs.length > 0 || pendingPages.length > 0 || pendingAudios.length > 0;
  const canSend = answersCommand
    ? value.trim().length > 0 && outgoingFiles.length === 0
    : hasContent &&
      !!model &&
      !isStreaming &&
      !isLocked &&
      !imagesUnsupported &&
      !isReadingFiles &&
      !command.isPickingModel;
  const activeSkills = skills.filter((s) => skillNames.includes(s.name));
  const skillsTokens = activeSkillsTokens(activeSkills);
  const modelContext = useContextLimit(model);
  const contextLimit = contextState?.limit ?? modelContext?.limit ?? model?.contextWindow;
  const areSkillsHeavy = !!contextLimit && skillsTokens > contextLimit * HEAVY_SKILLS_SHARE;
  const sensitive = useSensitiveData(value, outgoingFiles);
  const sensitiveLabels = labelsOf(sensitive.matches);
  // Said once the values are hidden, for screen readers and as the indicator goes away
  const [hiddenNotice, setHiddenNotice] = useState("");
  // What "Ocultar antes de enviar" can change: the text and the files attached here, not the ones sent before
  const canHide = sensitive.matches.some(
    (m) => m.place.type === "message" || attachments.some((a) => a.id === (m.place.type === "file" ? m.place.id : "")),
  );

  function hideSensitive() {
    const result = hideSecrets(value, attachments);
    if (result.hidden === 0) return;
    onChange(result.text);
    replaceAttachments(result.files);
    setHiddenNotice(t("chat.composer.hidden", { count: result.hidden }));
    textareaRef.current?.focus({ preventScroll: true });
  }
  const workspaces = useWorkspacesContext();
  const folder = workspace?.folder ?? null;
  const workspaceState = folder ? workspaces.stateOf(folder.path) : null;
  const folderFiles = useMemo(
    () => (workspaceState?.kind === "ready" ? workspaceState.files.map((f) => f.path) : null),
    [workspaceState],
  );
  // "@" lists the folder's files to mention one; "/" lists commands and skills, and only one list is open at a time
  const mention = useFileMention({ text: value, onTextChange: onChange, files: folderFiles, textareaRef });
  const dictation = useDictation({ inputRef: textareaRef, onChange });

  // «Mencionar un archivo» of the "+" menu: an "@" at the end, with the list open on it
  function startMention() {
    const next = value && !/\s$/.test(value) ? `${value} @` : `${value}@`;
    onChange(next);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(next.length, next.length);
      mention.track(textarea);
    });
  }
  const provider = model && getProvider(model.providerId);
  const configuredContext = model ? optionsFor(model.providerId).contextLength : undefined;
  const folderContext =
    model &&
    plannedWorkspaceContext(model, configuredContext);
  // As the selected model would get it, so the chip and the notices tell whether it fits
  const workspaceIndex = useMemo(
    () =>
      workspaceState?.kind === "ready" ? indexText(workspaceState.files, indexBudget(folderContext)) : undefined,
    [workspaceState, folderContext],
  );
  const cloudProvider = provider?.requiresApiKey ? provider.name : undefined;
  const [dismissedNotices, setDismissedNotices] = useState({ cloud: false });
  // Only when the breakdown is shown: going through the whole conversation on every frame of a reply would be waste
  const partsOfContext = () =>
    contextParts({
      messages: history?.messages ?? [],
      summary: history?.summary,
      skills: activeSkills,
      allSkills: skills,
      memories: preferences.memory && !isPrivate ? memories.map((m) => m.text) : [],
      rules: isIsolated
        ? null
        : buildUserRules(isPrivate ? withoutPersonalData(preferences.personalization) : preferences.personalization),
      webSearch: preferences.webSearch && !isIsolated,
      folder: folder && workspaceIndex ? { name: folder.name, indexTokens: workspaceIndex.tokens } : undefined,
    });
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const { refresh: refreshWorkspace } = workspaces;

  // A conversation opened with its folder already connected reads it, so the chip can say how it is
  useEffect(() => {
    if (folder && !workspaceState) void refreshWorkspace(folder.path);
  }, [folder, workspaceState, refreshWorkspace]);

  const changeWorkspace = workspace?.onChange;
  const disconnectWorkspace = changeWorkspace && (() => changeWorkspace(null));

  async function pickWorkspace() {
    if (!changeWorkspace || !workspace) return;
    setWorkspaceError(null);
    try {
      const picked = await workspaces.pick(!workspace.isPrivate);
      if (picked) changeWorkspace(picked);
    } catch (e) {
      setWorkspaceError(errorMessage(e));
    }
  }

  useShortcut(SHORTCUTS.workspace, pickWorkspace, { enabled: !!changeWorkspace && shortcutsEnabled });

  // A new screen (/new, /fork, ⌘N) takes away the box that was being typed in; the cursor is left ready to write
  // here. Only when nothing has the focus, so opening a conversation from the sidebar leaves it on the list.
  useEffect(() => {
    const focused = document.activeElement;
    if (!focused || focused === document.body) textareaRef.current?.focus({ preventScroll: true });
  }, []);

  // A pill set from outside (a welcome card) leaves the cursor ready to write
  useEffect(() => {
    if (invokedSkill.skill) textareaRef.current?.focus({ preventScroll: true });
  }, [invokedSkill.skill]);

  function submit() {
    if (!canSend) return;
    onSubmit(attachments);
    clearAttachments();
  }

  function selectText(secret: string) {
    const textarea = textareaRef.current;
    const at = value.indexOf(secret);
    if (!textarea || at === -1) return;
    textarea.focus();
    textarea.setSelectionRange(at, at + secret.length);
  }

  return (
    <div className="composer-wrap">
      {areSkillsHeavy && model && (
        <HeavySkillsNotice
          tokens={skillsTokens}
          contextLimit={contextLimit}
          modelName={model.name}
          onShowSkills={() => onSkillPickerOpenChange(true)}
        />
      )}
      {folder && workspace && (
        <WorkspaceNotice
          folder={folder}
          state={workspaceState}
          index={workspaceIndex}
          modelName={model?.name}
          cloudProvider={cloudProvider}
          dismissed={dismissedNotices}
          onDismiss={(notice) => setDismissedNotices((current) => ({ ...current, [notice]: true }))}
          onChange={changeWorkspace && pickWorkspace}
          onDisconnect={disconnectWorkspace}
        />
      )}
      {isSkillPickerOpen && !isIsolated && (
        <SkillPicker
          skills={skills}
          selected={skillNames}
          onChange={onChangeSkills}
          onClose={() => onSkillPickerOpenChange(false)}
          onManage={() => {
            onSkillPickerOpenChange(false);
            onManageSkills();
          }}
          contextLimit={contextLimit}
          placement={isWelcome ? "down" : "up"}
        />
      )}
      <div className={`composer ${variant}`}>
        {mention.isOpen && !command.isOpen && (
          <FileMentionMenu mention={mention} placement={isWelcome ? "down" : "up"} />
        )}
        {command.isOpen && (
          <SkillCommandMenu
            matches={command.matches}
            query={command.query}
            markedNames={skillNames}
            activeIndex={command.activeOption}
            listId={command.listId}
            replacing={invokedSkill.skill}
            placement={isWelcome ? "down" : "up"}
            onPick={command.pick}
            onHover={command.setActiveIndex}
            onManage={onManageSkills}
            onShowCommands={onShowCommands}
            isPickingModel={command.isPickingModel}
            selectedModelId={selectedModelId}
          />
        )}
        <ComposerAttachments
          invokedSkill={invokedSkill.skill}
          onRemoveSkill={invokedSkill.remove}
          attachments={attachments}
          onRemoveAttachment={removeAttachment}
          references={references}
          onRemoveReference={onRemoveReference}
          pendingPdfs={pendingPdfs}
          onCancelPdf={cancelPdf}
          pendingPages={pendingPages}
          onCancelPage={cancelPage}
          pendingAudios={pendingAudios}
          onCancelAudio={cancelAudio}
        />
        <textarea
          ref={textareaRef}
          // focusComposer finds it by this, whatever screen it is on
          data-composer
          aria-label={t("chat.composer.inputLabel")}
          {...(mention.isOpen && !command.isOpen ? mention.comboboxProps : command.comboboxProps)}
          rows={4}
          placeholder={
            placeholder ??
            (answersCommand
              ? t("chat.composer.placeholderAnswer")
              : invokedSkill.skill
                ? t("chat.composer.placeholderSkill", { name: invokedSkill.skill })
                : isWelcome
                  ? t("chat.composer.placeholderWelcome")
                  : t("chat.composer.placeholder"))
          }
          value={value}
          onChange={(e) => {
            command.changeText(e.target.value);
            mention.track(e.target);
          }}
          onSelect={(e) => mention.track(e.currentTarget)}
          onPaste={(e) => {
            const files = pastedFiles(e.clipboardData);
            if (files.length > 0) {
              e.preventDefault();
              addFiles(files);
              return;
            }
            // The link is pasted as text as usual; its page is read and attached next to it
            if (preferences.readLinks && !isIsolated) addLinks(linksIn(e.clipboardData.getData("text/plain")));
          }}
          onKeyDown={(e) => {
            // Enter or Tab that confirms text being composed (Japanese, Chinese…) is for the input method, not a
            // menu pick or a send. WebKit may only say so with keyCode 229.
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if ((!command.isOpen && mention.handleKey(e)) || command.handleKey(e)) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {imagesUnsupported && (
          <p role="alert" className="composer-warning">
            {t("attachments.imagesUnsupported")}
          </p>
        )}
        {pdfImagesUnsupported && (
          <p role="status" className="composer-warning caution">
            {t("chat.composer.pdfNoImages")}
          </p>
        )}
        {isIsolated && cloudProvider && (
          <p role="status" className="composer-warning caution">
            {t("chat.isolated.cloudWarning", { provider: cloudProvider })}
          </p>
        )}
        <DictationNotice dictation={dictation} />
        {preferences.transcription && <MeetingNotice />}
        <div className="composer-bar">
          <div className="composer-tools">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_FILES}
              hidden
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <ComposerMenu
              onAttachFile={() => fileInputRef.current?.click()}
              onUseSkill={isIsolated ? undefined : () => onSkillPickerOpenChange(true)}
              onSearch={onSearch}
              placement={isWelcome ? "down" : "up"}
              activeSkillNames={activeSkills.map((s) => s.name)}
              onMentionFile={folderFiles ? startMention : undefined}
              workspace={
                workspace && {
                  folder,
                  fileCount: workspaceState?.kind === "ready" ? workspaceState.files.length : undefined,
                  onPick: changeWorkspace && pickWorkspace,
                  onDisconnect: disconnectWorkspace,
                }
              }
            />
            {browserConversationId && !isIsolated && <BrowserButton conversationId={browserConversationId} />}
            <ModelSelector
              models={models}
              selectedId={selectedModelId}
              onSelect={onSelectModel}
              placement={isWelcome ? "down" : "up"}
              onOpenSettings={onOpenSettings}
              preference={modelPreference}
              withAuto
            />
            {folder && workspace && (
              <WorkspaceChip
                folder={folder}
                state={workspaceState}
                index={workspaceIndex}
                modelName={model?.name}
                cloudProvider={cloudProvider}
                placement={isWelcome ? "down" : "up"}
                meaning={preferences.semanticSearch ? workspaces.meaningOf(folder.path) : null}
                onChange={changeWorkspace && pickWorkspace}
                onDisconnect={disconnectWorkspace}
                onReveal={() => {
                  workspaces.reveal(folder.path).catch((e) => setWorkspaceError(errorMessage(e)));
                }}
              />
            )}
            <ContextIndicator
              state={contextState ?? null}
              usedWithoutLimit={contextUsedWithoutLimit}
              provider={provider ?? undefined}
              limit={modelContext}
              parts={partsOfContext}
            />
          </div>
          {/* Next to Send, because it is about what sending will do; the left group never moves */}
          <div className="composer-send">
            {sensitive.matches.length > 0 && (
              <SensitiveDataIndicator
                matches={sensitive.matches}
                placement={isWelcome ? "down" : "up"}
                onSelectText={selectText}
                onRemoveFile={(id) =>
                  attachments.some((a) => a.id === id) ? removeAttachment(id) : onRemoveReference?.(id)
                }
                onOpenSettings={onOpenFeatureSettings}
                onHideAll={canHide ? hideSensitive : undefined}
              />
            )}
            {preferences.transcription && <MeetingButton className="icon-button soft" onRecorded={addAttachment} />}
            <DictationButton dictation={dictation} className="icon-button soft" shortcutsEnabled={shortcutsEnabled} />
            {isStreaming && !answersCommand ? (
              <button type="button" className="send-button" aria-label={t("chat.composer.stop")} onClick={onStop}>
                <Square size={16} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                className="send-button"
                aria-label={t("chat.composer.send")}
                disabled={!canSend}
                onClick={submit}
              >
                <ArrowUp size={18} strokeWidth={2.2} />
              </button>
            )}
          </div>
        </div>
        {/* Announced when it appears, without taking the focus */}
        <span className="visually-hidden" role="status">
          {sensitiveLabels.length === 0 && hiddenNotice}
        </span>
        <span className="visually-hidden" role="status">
          {sensitiveLabels.length > 0 &&
            t("chat.composer.sensitiveAnnounce", {
              labels: sensitiveLabels.join(", "),
              destination: sensitive.destination,
            })}
        </span>
        <span className="visually-hidden" role="status">
          {invokedSkill.skill && t("chat.composer.skillAnnounce", { name: invokedSkill.skill })}
        </span>
      </div>
      {invokedSkill.isAutoMarked && (
        <p role="status" className="invoked-skill-note">
          <Sparkles size={12} strokeWidth={2} />
          <span>
            <Trans
              i18nKey="chat.composer.skillMarked"
              values={{ name: invokedSkill.skill }}
              components={{ name: <span className="mono" /> }}
            />
          </span>
        </p>
      )}
      {workspaceError && (
        <div role="alert" className="composer-error">
          <CircleAlert size={16} strokeWidth={2} />
          <span className="composer-error-text">
            <strong>{t("chat.composer.folderError")}</strong>
            <span className="composer-error-help"> {workspaceError}</span>
          </span>
          <RemoveButton label={t("chat.composer.closeError")} onClick={() => setWorkspaceError(null)} />
        </div>
      )}
      {fileError && <FileErrorNotice error={fileError} onDismiss={dismissFileError} />}
      {drag.zone && createPortal(<DropOverlay fileCount={drag.fileCount} />, drag.zone)}
    </div>
  );
}
