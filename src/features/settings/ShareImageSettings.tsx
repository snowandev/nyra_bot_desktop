import { useId } from "react";
import { useTranslation } from "react-i18next";
import { IMAGE_QUALITIES, type ImageQuality } from "@/shared/storage/settings";
import { SettingsPanel } from "@/shared/ui/SettingsPanel";

type Props = {
  quality: ImageQuality;
  onChange: (quality: ImageQuality) => void;
};

export function ShareImageSettings({ quality, onChange }: Props) {
  const { t } = useTranslation();
  const titleId = useId();

  return (
    <SettingsPanel title={t("settings.shareImages.title")} description={t("settings.shareImages.description")}>
      <div className="settings-subsection">
        <div className="settings-subsection-header">
          <h4 id={titleId} className="settings-subsection-title">
            {t("settings.shareImages.quality")}
          </h4>
          <span className="setting-row-description">{t(`settings.shareImages.hints.${quality}`)}</span>
        </div>
        <div className="segmented" role="group" aria-labelledby={titleId}>
          {IMAGE_QUALITIES.map((option) => (
            <button key={option} type="button" aria-pressed={quality === option} onClick={() => onChange(option)}>
              {t(`settings.shareImages.qualities.${option}`)}
            </button>
          ))}
        </div>
      </div>
    </SettingsPanel>
  );
}
