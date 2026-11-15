import { FolderOpen, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatBytes } from "@/shared/lib/format";
import { Switch } from "@/shared/ui/Switch";
import {
  activeModel,
  addFromFolder,
  addFromHuggingFace,
  cancelAdding,
  percentOf,
  removeModel,
  useSpeechModels,
} from "./speechModels";

type Props = {
  model: string | null;
  onModelChange: (model: string) => void;
  speakers: boolean;
  onSpeakersChange: (speakers: boolean) => void;
};

// Under «Transcribir audio»: the Whisper models the user added, which one to use, adding one from Hugging Face or a
// folder, and telling speakers apart
export function TranscriptionSettings({ model, onModelChange, speakers, onSpeakersChange }: Props) {
  const { t } = useTranslation();
  const { status, adding, error } = useSpeechModels();
  const [isAdding, setIsAdding] = useState(false);
  const [repository, setRepository] = useState("");
  const models = status?.models ?? [];
  const active = activeModel(status, model);

  // The one added becomes the one in use
  async function added(adding: Promise<{ id: string } | null>) {
    const newModel = await adding;
    if (!newModel) return;
    onModelChange(newModel.id);
    setRepository("");
    setIsAdding(false);
  }

  return (
    <div className="transcription-settings">
      <span className="setting-row-model-use">{t("transcription.settings.model")}</span>
      {models.length === 0 && !isAdding && <p className="transcription-empty">{t("transcription.settings.empty")}</p>}
      {models.length > 0 && (
        <div className="transcription-models" role="radiogroup" aria-label={t("transcription.settings.model")}>
          {models.map((m) => (
            <div key={m.id} className={`transcription-model ${active?.id === m.id ? "selected" : ""}`}>
              <button
                type="button"
                role="radio"
                aria-checked={active?.id === m.id}
                className="transcription-model-pick"
                onClick={() => onModelChange(m.id)}
              >
                <b>{m.name}</b>
                <span className="transcription-model-origin" title={m.origin}>
                  {t(`transcription.settings.from.${m.source}`, { origin: m.origin })}
                </span>
                <span className="transcription-model-state">
                  {formatBytes(m.bytes)} · {t(`transcription.settings.formats.${m.format}`)}
                </span>
              </button>
              <button type="button" className="outline-button small" disabled={!!adding} onClick={() => void removeModel(m.id)}>
                {t("transcription.settings.delete")}
              </button>
            </div>
          ))}
        </div>
      )}
      {adding ? (
        <div className="transcription-adding" role="status">
          <span>
            {adding.total > 0
              ? t("transcription.settings.adding", { percent: percentOf(adding) })
              : t("transcription.settings.preparing")}
          </span>
          <span className="progress-bar">
            <span style={{ width: `${Math.max(4, percentOf(adding))}%` }} />
          </span>
          <button type="button" className="outline-button small" onClick={cancelAdding}>
            {t("transcription.settings.cancel")}
          </button>
        </div>
      ) : isAdding ? (
        <div className="transcription-add">
          <form
            className="transcription-add-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (repository.trim()) void added(addFromHuggingFace(repository));
            }}
          >
            <label htmlFor="transcription-repository">{t("transcription.settings.huggingFace")}</label>
            <span className="transcription-add-field">
              <input
                id="transcription-repository"
                value={repository}
                placeholder={t("transcription.settings.repositoryExample")}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => setRepository(e.target.value)}
              />
              <button type="submit" className="primary-button small" disabled={!repository.trim()}>
                {t("transcription.settings.add")}
              </button>
            </span>
            <span className="transcription-add-hint">{t("transcription.settings.format")}</span>
          </form>
          <div className="transcription-add-actions">
            <button type="button" className="outline-button small" onClick={() => void added(addFromFolder())}>
              <FolderOpen size={14} strokeWidth={2} aria-hidden="true" />
              {t("transcription.settings.fromFolder")}
            </button>
            <button type="button" className="ghost-button small" onClick={() => setIsAdding(false)}>
              {t("transcription.settings.cancel")}
            </button>
          </div>
          {models.length === 0 && (status?.sharedDownloadBytes ?? 0) > 0 && (
            <span className="transcription-add-hint">
              {t("transcription.settings.sharedFirst", { size: formatBytes(status?.sharedDownloadBytes ?? 0) })}
            </span>
          )}
        </div>
      ) : (
        <button type="button" className="outline-button small transcription-add-button" onClick={() => setIsAdding(true)}>
          <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
          {t("transcription.settings.addModel")}
        </button>
      )}
      {error && (
        <p className="transcription-error" role="alert">
          {error}
        </p>
      )}
      <div className="transcription-speakers">
        <span>
          <b>{t("transcription.settings.speakers")}</b>
          <span>{t("transcription.settings.speakersHint")}</span>
        </span>
        <Switch checked={speakers} onChange={onSpeakersChange} label={t("transcription.settings.speakers")} />
      </div>
    </div>
  );
}
