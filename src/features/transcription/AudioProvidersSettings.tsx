import { Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePreferencesContext } from "@/features/settings/preferencesContext";
import { SettingsOption } from "@/shared/ui/SettingsOption";
import { SettingsPanel } from "@/shared/ui/SettingsPanel";
import { activeModel, useSpeechModels } from "./speechModels";
import { TranscriptionSettings } from "./TranscriptionSettings";

// Settings → Proveedores de audio: who transcribes the audio the user attaches. Today only this computer; a service
// with an API would be one more in the list, with its own panel.
export function AudioProvidersSettings() {
  const { t } = useTranslation();
  const { preferences, updatePreferences } = usePreferencesContext();
  const { status } = useSpeechModels();
  const model = preferences.transcriptionModel;
  const active = activeModel(status, model);

  return (
    <div className="settings-content">
      <section aria-label={t("transcription.providers.list")} className="settings-list">
        <div className="section-label">{t("transcription.providers.list")}</div>
        <SettingsOption
          icon={<Server size={18} strokeWidth={1.8} />}
          name={t("transcription.providers.local")}
          status={
            <span className="settings-option-status">
              <span className={`status-dot ${active ? "loaded" : ""}`} />
              {active ? t("transcription.providers.ready", { model: active.name }) : t("transcription.providers.missing")}
            </span>
          }
          selected
          onSelect={() => {}}
        />
      </section>

      <SettingsPanel title={t("transcription.providers.local")} description={t("transcription.providers.localDescription")}>
        <TranscriptionSettings
          model={model}
          onModelChange={(transcriptionModel) => updatePreferences({ transcriptionModel })}
          speakers={preferences.transcriptionSpeakers}
          onSpeakersChange={(transcriptionSpeakers) => updatePreferences({ transcriptionSpeakers })}
        />
      </SettingsPanel>
    </div>
  );
}
