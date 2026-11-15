import { ArrowUp, ChevronDown, Paperclip, Pin, PinOff, Square, SquareDashedMousePointer } from "lucide-react";
import { type KeyboardEvent, type ReactNode, type TextareaHTMLAttributes, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { pastedFiles } from "@/features/attachments/attachments";
import { BrandIcon } from "@/shared/ui/BrandIcon";

type Props = {
  text: string;
  onTextChange: (text: string) => void;
  // Undefined while it can't send
  onSubmit?: () => void;
  // While Nyra answers, send becomes stop
  onStop?: () => void;
  // No model set up yet: nothing can be written
  isDisabled: boolean;
  modelName: string | null;
  // Local model names read better in monospace, like in the model menu
  isLocalModel: boolean;
  onModelClick: () => void;
  isPickingModel: boolean;
  // Pressed on Nyra's mark: the window follows the mouse
  onDragStart: () => void;
  // Double-clicked on Nyra's mark: the bar goes back to its default place
  onResetPosition: () => void;
  // Pasted files (a screenshot, an image of code) go with the message, so it can be sent without text
  onPasteFiles: (files: File[]) => void;
  hasFiles: boolean;
  // Opens the system's file picker
  onAttach: () => void;
  // Files dragged over the bar: it shows where they go
  isDropping: boolean;
  // Undefined where the system can't capture yet
  onCapture?: () => void;
  isCapturing: boolean;
  // Pinned, it stays when the user clicks another app
  isPinned: boolean;
  onTogglePin: () => void;
  // The "/" list goes first: true when it handled the key
  onListKey: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  // What the box says to assistive technology while the "/" list is open
  comboboxProps: TextareaHTMLAttributes<HTMLTextAreaElement>;
  // With a skill chosen for the message, the box says what to write for it
  placeholder?: string;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  // The microphone, next to the model
  dictation?: ReactNode;
};

// Four lines; then the box scrolls
const MAX_INPUT_HEIGHT = 106;
// Timed by hand: the system drag that starts on the first press can swallow the browser's own double-click
const DOUBLE_PRESS_MS = 400;

// The bar where the user writes: Nyra's mark, the box, the model and send. It stays at the foot of the window
export function QuickBar(props: Props) {
  const { text, onTextChange, onSubmit, onStop, isDisabled, modelName, isLocalModel, onDragStart, inputRef } = props;
  const { onModelClick, isPickingModel, onResetPosition, onPasteFiles, hasFiles, onCapture, isCapturing } = props;
  const { onAttach, isDropping } = props;
  const { isPinned, onTogglePin, onListKey, comboboxProps, placeholder, dictation } = props;
  const { t } = useTranslation();
  const canSend = !!onSubmit && (!!text.trim() || hasFiles);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const lastPress = useRef(0);

  // Grows with the text up to four lines
  useLayoutEffect(() => {
    const input = box.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, [text]);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (onListKey(event)) {
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) onSubmit?.();
    }
  }

  return (
    <div className={`quick-bar ${isDropping ? "dropping" : ""}`}>
      <span
        className="quick-handle"
        title={t("quick.handle")}
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          const isDouble = event.timeStamp - lastPress.current < DOUBLE_PRESS_MS;
          lastPress.current = isDouble ? 0 : event.timeStamp;
          if (isDouble) onResetPosition();
          else onDragStart();
        }}
      >
        <BrandIcon size={24} />
      </span>
      <div className="quick-field">
        <label className="visually-hidden" htmlFor="quick-input">
          {t("quick.messageLabel")}
        </label>
        <textarea
          id="quick-input"
          ref={(element) => {
            box.current = element;
            inputRef.current = element;
          }}
          {...comboboxProps}
          rows={1}
          value={text}
          placeholder={
            isDropping ? t("quick.dropHere") : isDisabled ? t("quick.setUpModel") : (placeholder ?? t("quick.ask"))
          }
          disabled={isDisabled}
          aria-describedby="quick-help"
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            const files = pastedFiles(event.clipboardData);
            if (files.length === 0) return;
            event.preventDefault();
            onPasteFiles(files);
          }}
        />
        <span className="visually-hidden" id="quick-help">
          {t("quick.help")}
        </span>
      </div>
      <button
        type="button"
        className="quick-capture"
        aria-pressed={isPinned}
        aria-label={isPinned ? t("quick.unpin") : t("quick.pin")}
        title={isPinned ? t("quick.unpinHelp") : t("quick.pinHelp")}
        onClick={onTogglePin}
      >
        {isPinned ? (
          <PinOff size={16} strokeWidth={2} aria-hidden="true" />
        ) : (
          <Pin size={16} strokeWidth={2} aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        className="quick-capture"
        aria-label={t("quick.attach")}
        title={t("quick.attach")}
        disabled={isDisabled}
        onClick={onAttach}
      >
        <Paperclip size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      {onCapture && (
        <button
          type="button"
          className="quick-capture"
          aria-label={t("quick.capture")}
          title={t("quick.capture")}
          disabled={isDisabled || isCapturing}
          onClick={onCapture}
        >
          <SquareDashedMousePointer size={17} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
      {dictation}
      <button
        type="button"
        className={`quick-model ${modelName ? "" : "empty"}`}
        aria-label={modelName ? t("quick.modelButton", { name: modelName }) : t("quick.noModelConfigured")}
        title={modelName ?? undefined}
        aria-haspopup="listbox"
        aria-expanded={isPickingModel}
        disabled={!modelName}
        onClick={onModelClick}
      >
        <span className={`quick-model-name ${isLocalModel ? "mono" : ""}`}>{modelName ?? t("quick.noModel")}</span>
        <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
      </button>
      {onStop ? (
        <button type="button" className="quick-send stop" aria-label={t("quick.stop")} onClick={onStop}>
          <Square size={14} strokeWidth={0} fill="currentColor" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          className="quick-send"
          aria-label={t("quick.send")}
          aria-disabled={!canSend}
          onClick={() => canSend && onSubmit?.()}
        >
          <ArrowUp size={18} strokeWidth={2.3} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
