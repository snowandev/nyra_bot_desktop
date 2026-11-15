import { AudioLines, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { percentOf, useSpeechModels } from "./speechModels";
import { useTranscription } from "./transcriptionSession";

type Props = {
  conversationId: string;
};

// Above the composer while a reply transcribes an audio: how far it is, where to add a model when there is none (it
// goes on once one is added), and a way to stop it
export function TranscriptionStrip({ conversationId }: Props) {
  const { t } = useTranslation();
  const transcription = useTranscription(conversationId);
  const models = useSpeechModels();
  if (!transcription) return null;
  const { name, state, cancel } = transcription;
  const adding = models.adding;

  let label: string;
  let percent: number | null = null;
  if (state.kind === "needsModel") {
    percent = adding ? percentOf(adding) : null;
    label = adding ? t("transcription.strip.adding", { percent }) : t("transcription.strip.needsModel", { name });
  } else if (state.kind === "transcribing") {
    percent = Math.round(state.progress * 100);
    label = t("transcription.strip.transcribing", { name, percent });
  } else {
    label = t(`transcription.strip.${state.kind}`, { name });
  }
  const isWaitingForUser = state.kind === "needsModel" && !adding;
  const Icon = isWaitingForUser ? AudioLines : LoaderCircle;

  return (
    <div className="status-strip transcription-strip" role="group" aria-label={t("transcription.strip.label")}>
      <Icon size={16} strokeWidth={2} className={isWaitingForUser ? undefined : "spin"} aria-hidden="true" />
      <span className="transcription-strip-text" role="status">
        <b>{label}</b>
        {percent !== null && (
          <span className="progress-bar">
            <span style={{ width: `${Math.max(4, percent)}%` }} />
          </span>
        )}
        {models.error && state.kind === "needsModel" && <span className="transcription-error">{models.error}</span>}
      </span>
      <span className="status-strip-actions">
        <button type="button" className="outline-button small" onClick={cancel}>
          {t("transcription.strip.cancel")}
        </button>
      </span>
    </div>
  );
}
