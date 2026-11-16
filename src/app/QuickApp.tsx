import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { QuickAttachments } from "@/features/quick-bar/QuickAttachments";
import { QuickBar } from "@/features/quick-bar/QuickBar";
import { QuickChatHeader } from "@/features/quick-bar/QuickChatHeader";
import { QuickMessages } from "@/features/quick-bar/QuickMessages";
import { QuickModelOffer } from "@/features/quick-bar/QuickModelOffer";
import { QuickModelPicker } from "@/features/quick-bar/QuickModelPicker";
import { useModelRouting } from "@/features/models/useModelRouting";
import { QuickNoModel } from "@/features/quick-bar/QuickNoModel";
import { useChat } from "@/features/chat/reply/useChat";
import { useComposerAttachments } from "@/features/attachments/useComposerAttachments";
import { ACCEPTED_FILES } from "@/features/attachments/attachments";
import { useFileDrop } from "@/features/attachments/useFileDrop";
import { useAppEvent } from "@/shared/hooks/useAppEvent";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import { useMemories } from "@/features/memory/useMemories";
import { usePreferences } from "@/features/settings/usePreferences";
import { useProviderSettings } from "@/features/models/useProviderSettings";
import { menuModels } from "@/features/models/modelGroups";
import { type ComposerCommand, messageForNew } from "@/features/chat/reply/commands";
import { InvokedSkillPill } from "@/features/skills/InvokedSkillPill";
import { SkillCommandMenu } from "@/features/skills/SkillCommandMenu";
import { useSkillCommand } from "@/features/skills/useSkillCommand";
import { useSkills } from "@/features/skills/useSkills";
import { useQuickSkills } from "@/features/quick-bar/useQuickSkills";
import { DictationButton } from "@/features/dictation/DictationButton";
import { ScreenStrip } from "@/features/screen-look/ScreenStrip";
import { DictationNotice } from "@/features/dictation/DictationNotice";
import { useDictation } from "@/features/dictation/useDictation";
import {
  announceQuickSaved,
  canCaptureScreen,
  captureFromQuick,
  continueInMain,
  dragQuick,
  hideQuick,
  onQuickHidden,
  onQuickShown,
  openMainFromQuick,
  quickIsSolid,
  resetQuickPosition,
  resizeQuick,
  setQuickPinned,
  setQuickSize,
} from "@/features/quick-bar/quickWindow";
import { errorMessage } from "@/shared/lib/errors";
import { notifyNeedsYou, notifyReplyCompleted } from "@/shared/lib/notifications";
import { getProvider } from "@/providers";
import { clearQuickLast, loadQuickLast, saveQuickLast } from "@/shared/storage/settings";

// The bar has no folders
const noFolder = async () => null;

// Window actions only fail without the window, and then there is nothing to do
const ignore = () => {};

// Opened again before this, it goes on with the same conversation; later, it starts a new one
const RESUME_MS = 15 * 60 * 1000;

// The quick chat bar, in a window of its own that the global shortcut shows and hides. It answers with the same
// engine as the main window: providers, Personalization, memories, web search and documents, and its conversations
// are saved like any other.
export default function QuickApp() {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [isPickingModel, setIsPickingModel] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  // The most the chat may grow upwards: the size chosen in Settings, or less on a small screen
  const [maxHeight, setMaxHeight] = useState<number | null>(null);
  // Minutes since a conversation taken up again was left, until the next message
  const [resumedMinutes, setResumedMinutes] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dictation = useDictation({ inputRef: input, onChange: setText });
  const settings = useProviderSettings();
  const { preferences } = usePreferences();
  const { memories, saveFromReply } = useMemories();
  const memoryTexts = useMemo(() => memories.map((m) => m.text), [memories]);
  const model = settings.selectedModel;
  // «Automático» as in the main window: the main model, moving to the one for demanding tasks when the task needs it
  const { routing, mainModel, demandingModel } = useModelRouting(settings);
  const files = useComposerAttachments();
  // Dropped anywhere on the bar's window, the files go with the message, as pasted ones do
  const drop = useFileDrop(root, (dropped) => {
    if (model) void files.addFiles(dropped);
  });
  const skillsState = useSkills();
  const chat = useChat({
    model,
    routing,
    mainModel,
    configFor: settings.optionsFor,
    personalization: preferences.personalization,
    skills: skillsState.skills,
    webSearch: preferences.webSearch,
    memory: preferences.memory ? { texts: memoryTexts, save: saveFromReply } : null,
    prepareWorkspace: noFolder,
    smartTitles: preferences.smartTitles,
    // So the main window's list shows the bar's conversations at once
    onConversationSaved: (id) => void announceQuickSaved(id).catch(ignore),
    // As in the main window, when the user isn't looking at the bar (hidden, or behind another app while pinned); a
    // notification that fails never interrupts the chat
    onReplyCompleted: preferences.notifyOnReply ? () => void notifyReplyCompleted().catch(ignore) : undefined,
    onCommandNeedsYou: preferences.notifyOnAttention
      ? (need, count) => void notifyNeedsYou(need, count).catch(ignore)
      : undefined,
  });

  const quickSkills = useQuickSkills({
    skills: skillsState.skills,
    defaultSkillNames: skillsState.defaultSkillNames,
    active: chat.active,
    setConversationSkills: chat.setConversationSkills,
  });
  const visibleModels = model ? menuModels(settings.models, settings.hiddenModelIds, model.id) : [];
  // The commands that make sense in the bar: the others need the main window's conversation
  const commands: ComposerCommand[] = [
    { name: "new", run: startOver },
    { name: "model", unavailable: visibleModels.length === 0 ? t("chat.composer.noModels") : undefined },
  ];
  const command = useSkillCommand({
    text,
    onTextChange: setText,
    skills: skillsState.skills,
    commands,
    invokedSkill: quickSkills.invokedSkill,
    models: visibleModels,
    onSelectModel: chooseModel,
  });

  // The window takes the content's height, growing upwards from where the bar is
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      resizeQuick(Math.ceil(element.getBoundingClientRect().height)).catch(ignore);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Settings → Chat rápido changed the size, possibly from the main window while the bar is open
  const applySize = useStableCallback(() => void setQuickSize(preferences.quickSize).then(setMaxHeight).catch(ignore));
  useEffect(() => applySize(), [preferences.quickSize, applySize]);

  // Hidden with a conversation: remembered with the time, also across restarts, to take it up again soon after. A
  // hidden bar stays mounted, so a dictation is dropped here, or the microphone would stay open.
  const onHidden = useStableCallback(() => {
    setIsPickingModel(false);
    dictation.drop();
    const active = chat.active;
    if (active && active.messages.length > 0) saveQuickLast({ conversationId: active.id, leftAt: Date.now() });
  });

  // Shown: the latest conversation if it was left a moment ago, otherwise a new one; the cursor in the box
  const onShown = useStableCallback(() => {
    const last = loadQuickLast();
    if (last && Date.now() - last.leftAt < RESUME_MS) {
      if (chat.active?.id !== last.conversationId) chat.openConversation(last.conversationId);
      setResumedMinutes(Math.max(1, Math.round((Date.now() - last.leftAt) / 60_000)));
    } else {
      if (chat.active) chat.openConversation(null);
      // A new conversation starts with the default model, as in the main window
      settings.selectDefaultModel();
      setResumedMinutes(null);
    }
    // On another screen it may have more or less room
    applySize();
    input.current?.focus();
  });

  useAppEvent(onQuickShown, onShown);
  useAppEvent(onQuickHidden, onHidden);

  // Esc hides the bar, also while Nyra answers: the reply goes on and is there when it comes back. The model picker
  // handles its own Esc, which only closes it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Already used by the box: it closed the "/" list
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      hideQuick().catch(ignore);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const messages = chat.active?.messages ?? [];
  const isWriting = !!chat.active && chat.streamingId === chat.active.id;
  const searching = chat.searchProgress?.conversationId === chat.active?.id ? chat.searchProgress?.steps.at(-1) : null;
  const isLocalModel = !routing && !!model && !getProvider(model.providerId)?.requiresApiKey;
  // Offered where there are two models to choose between, as the main window's menu does
  const auto =
    mainModel && demandingModel && mainModel.id !== demandingModel.id
      ? {
          description: t("models.menu.autoDescription", { main: mainModel.name, demanding: demandingModel.name }),
          isOn: !!routing,
          onChoose: chooseAuto,
        }
      : undefined;
  const imagesUnsupported = model?.supportsImages === false && files.attachments.some((a) => a.kind === "image");
  const canSend = !!model && !isWriting && !imagesUnsupported && files.pendingPdfs.length === 0 && files.pendingAudios.length === 0;

  function send() {
    // "/new" alone starts over; "/new …" sends the rest in a new conversation
    const forNew = messageForNew(text.trim());
    if (forNew === "") return startOver();
    const message = forNew ?? text.trim();
    if (!message && files.attachments.length === 0) return;
    const attachments = files.attachments;
    const skill = quickSkills.invokedSkill.skill;
    setText("");
    files.clearAttachments();
    setResumedMinutes(null);
    quickSkills.invokedSkill.clear();
    void chat.send(message, attachments, [], {
      skills: quickSkills.skillNames,
      ...(skill && { skill }),
      ...(forNew !== null && { newConversation: true }),
    });
  }

  function togglePin() {
    const next = !isPinned;
    setIsPinned(next);
    setQuickPinned(next).catch(ignore);
    input.current?.focus();
  }

  async function capture() {
    setIsCapturing(true);
    try {
      const png = await captureFromQuick();
      if (png.byteLength > 0) await files.addFiles([new File([png], t("quick.captureFile"), { type: "image/png" })]);
    } catch (e) {
      files.reportFileError(errorMessage(e));
    } finally {
      setIsCapturing(false);
      input.current?.focus();
    }
  }

  function startOver() {
    chat.openConversation(null);
    settings.selectDefaultModel();
    quickSkills.reset();
    setText("");
    files.clearAttachments();
    setResumedMinutes(null);
    clearQuickLast();
    input.current?.focus();
  }

  // The main window opens it once it is on disk; the bar starts afresh and doesn't take it up again, so the two
  // windows never write to the same conversation
  async function continueInNyra() {
    const id = chat.active?.id;
    if (!id || isWriting) return;
    await chat.whenSaved(id);
    clearQuickLast();
    await continueInMain(id).catch(ignore);
    chat.openConversation(null);
    setResumedMinutes(null);
  }

  function chooseAuto() {
    settings.selectAuto();
    setIsPickingModel(false);
    input.current?.focus();
  }

  function chooseModel(id: string) {
    settings.selectModel(id);
    setIsPickingModel(false);
    input.current?.focus();
  }

  return (
    <div
      ref={root}
      className={`quick-window ${quickIsSolid ? "solid" : ""}`}
      style={maxHeight ? { maxHeight } : undefined}
      role="dialog"
      aria-label={t("quick.window")}
    >
      {isPickingModel && model ? (
        <QuickModelPicker
          models={menuModels(settings.models, settings.hiddenModelIds, model.id)}
          selectedId={model.id}
          onChoose={chooseModel}
          onClose={() => {
            setIsPickingModel(false);
            input.current?.focus();
          }}
          onManage={() => openMainFromQuick().catch(ignore)}
          auto={auto}
        />
      ) : (
        messages.length > 0 && (
          <div className="quick-chat">
            <QuickChatHeader
              title={chat.active?.title ?? t("quick.untitled")}
              resumedMinutes={resumedMinutes}
              onContinue={isWriting ? undefined : () => void continueInNyra()}
              onNew={startOver}
              onClose={() => hideQuick().catch(ignore)}
            />
            <QuickMessages
              messages={messages}
              isWriting={isWriting}
              status={searching ? t("quick.searching", { query: searching.query }) : undefined}
              error={chat.error}
              onRetry={() => void chat.regenerate()}
              resumedMinutes={resumedMinutes}
              onOpenInNyra={isWriting ? undefined : () => void continueInNyra()}
            />
          </div>
        )
      )}
      {!model && <QuickNoModel onOpenNyra={() => openMainFromQuick().catch(ignore)} />}
      {command.isOpen && (
        <SkillCommandMenu
          matches={command.matches}
          query={command.query}
          markedNames={quickSkills.skillNames}
          activeIndex={command.activeOption}
          listId={command.listId}
          replacing={quickSkills.invokedSkill.skill}
          placement="up"
          onPick={command.pick}
          onHover={command.setActiveIndex}
          onManage={() => openMainFromQuick().catch(ignore)}
          isPickingModel={command.isPickingModel}
          selectedModelId={model?.id ?? ""}
        />
      )}
      {quickSkills.invokedSkill.skill && (
        <div className="quick-skill">
          <InvokedSkillPill name={quickSkills.invokedSkill.skill} onRemove={quickSkills.invokedSkill.remove} />
        </div>
      )}
      <QuickAttachments
        attachments={files.attachments}
        onRemove={files.removeAttachment}
        pendingPdfs={files.pendingPdfs}
        onCancelPdf={files.cancelPdf}
        pendingAudios={files.pendingAudios}
        onCancelAudio={files.cancelAudio}
        fileError={files.fileError}
        onDismissError={files.dismissFileError}
        imagesUnsupported={imagesUnsupported}
      />
      <div className="quick-dictation">
        <DictationNotice dictation={dictation} />
      </div>
      {chat.modelOffer && (
        <div className="quick-screen">
          <QuickModelOffer {...chat.modelOffer} />
        </div>
      )}
      {/* Asking to look at the screen, the only place it is asked in the bar, or its marks to take them away */}
      {chat.active && (
        <div className="quick-screen">
          <ScreenStrip conversationId={chat.active.id} />
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        hidden
        onChange={(event) => {
          void files.addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
          input.current?.focus();
        }}
      />
      <QuickBar
        text={text}
        onAttach={() => fileInput.current?.click()}
        isDropping={drop.isDragging}
        onTextChange={command.changeText}
        onSubmit={canSend ? send : undefined}
        onStop={isWriting ? chat.stop : undefined}
        isDisabled={!model}
        modelName={routing ? t("models.menu.auto") : (model?.name ?? null)}
        isLocalModel={isLocalModel}
        onModelClick={() => setIsPickingModel((open) => !open)}
        isPickingModel={isPickingModel}
        onDragStart={() => dragQuick().catch(ignore)}
        onResetPosition={() => resetQuickPosition().catch(ignore)}
        onPasteFiles={(pasted) => void files.addFiles(pasted)}
        hasFiles={files.attachments.length > 0}
        onCapture={canCaptureScreen ? () => void capture() : undefined}
        isCapturing={isCapturing}
        isPinned={isPinned}
        onTogglePin={togglePin}
        onListKey={command.handleKey}
        comboboxProps={command.comboboxProps}
        placeholder={
          quickSkills.invokedSkill.skill
            ? t("chat.composer.placeholderSkill", { name: quickSkills.invokedSkill.skill })
            : undefined
        }
        inputRef={input}
        dictation={<DictationButton dictation={dictation} className="quick-capture" disabled={!model} />}
      />
    </div>
  );
}
