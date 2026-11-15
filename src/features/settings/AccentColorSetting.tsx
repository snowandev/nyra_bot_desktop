import { Check } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { ACCENT_COLORS, type AccentColor } from "@/shared/storage/settings";

type Props = {
  accent: AccentColor;
  onChange: (accent: AccentColor) => void;
};

export function AccentColorSetting({ accent, onChange }: Props) {
  const { t } = useTranslation();
  const titleId = useId();

  return (
    <div className="settings-subsection">
      <div className="settings-subsection-header">
        <h4 id={titleId} className="settings-subsection-title">
          {t("settings.appearance.accent")}
        </h4>
        <span className="setting-row-description">{t("settings.appearance.accentHint")}</span>
      </div>
      <div role="radiogroup" aria-labelledby={titleId} className="accent-options">
        {ACCENT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={accent === color}
            aria-label={t(`settings.appearance.accents.${color}`)}
            title={t(`settings.appearance.accents.${color}`)}
            className={`accent-option ${accent === color ? "selected" : ""}`}
            style={{ background: `var(--accent-${color})` }}
            onClick={() => onChange(color)}
          >
            {accent === color && <Check size={16} strokeWidth={2.6} aria-hidden="true" />}
          </button>
        ))}
      </div>
    </div>
  );
}
