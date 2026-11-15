import { LoaderCircle, Mic } from "lucide-react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useShortcut } from "@/shared/hooks/useShortcut";
import { SHORTCUTS, shortcutLabelOf } from "@/shared/lib/shortcuts";
import type { useDictation } from "./useDictation";

type Props = {
  dictation: ReturnType<typeof useDictation>;
  // Each box draws its buttons its own way
  className: string;
  disabled?: boolean;
  // Off while Settings cover the box: it would record into a box no one sees
  shortcutsEnabled?: boolean;
};

// The microphone next to send: it grows with the voice while recording
export function DictationButton({ dictation, className, disabled = false, shortcutsEnabled = true }: Props) {
  const { t } = useTranslation();
  const { state, level, toggle } = dictation;
  const isRecording = state === "recording";
  const isBusy = state === "starting" || state === "transcribing";
  useShortcut(SHORTCUTS.dictate, toggle, { enabled: !disabled && shortcutsEnabled });

  const label = isRecording
    ? t("dictation.stop")
    : isBusy
      ? t("dictation.transcribing")
      : t("dictation.start", { shortcut: shortcutLabelOf(SHORTCUTS.dictate) });

  return (
    <button
      type="button"
      className={`${className} dictation-button ${isRecording ? "recording" : ""}`}
      style={{ "--dictation-level": isRecording ? level : 0 } as CSSProperties}
      aria-label={label}
      title={label}
      aria-pressed={isRecording}
      disabled={disabled || isBusy}
      onClick={toggle}
    >
      {isBusy ? (
        <LoaderCircle size={16} strokeWidth={2} className="spin" aria-hidden="true" />
      ) : (
        <Mic size={16} strokeWidth={2} aria-hidden="true" />
      )}
    </button>
  );
}
