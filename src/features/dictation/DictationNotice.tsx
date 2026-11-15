import { CircleAlert, Mic } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RemoveButton } from "@/shared/ui/RemoveButton";
import type { useDictation } from "./useDictation";

type Props = {
  dictation: ReturnType<typeof useDictation>;
};

// Under the box: how to finish while recording, and what went wrong or is missing (a voice model, and where to add it)
export function DictationNotice({ dictation }: Props) {
  const { t } = useTranslation();
  const { state, notice, dismiss } = dictation;

  if (state === "recording" || state === "transcribing") {
    return (
      <p className="dictation-notice" role="status">
        <Mic size={14} strokeWidth={2} aria-hidden="true" />
        <span>{state === "recording" ? t("dictation.listening") : t("dictation.transcribing")}</span>
      </p>
    );
  }
  if (!notice) return null;

  return (
    <div className={`dictation-notice ${notice.kind === "error" ? "error" : ""}`} role="alert">
      <CircleAlert size={14} strokeWidth={2} aria-hidden="true" />
      <span className="dictation-notice-text">
        {notice.kind === "needsModel" && t("dictation.needsModel")}
        {notice.kind === "nothingHeard" && t("dictation.nothingHeard")}
        {notice.kind === "error" && notice.message}
      </span>
      <RemoveButton label={t("dictation.dismiss")} onClick={dismiss} />
    </div>
  );
}
