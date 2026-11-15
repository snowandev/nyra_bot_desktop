import { RotateCcw } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { clampFontScale, FONT_SCALE, formatFontScale } from "@/shared/lib/fontScale";

type Props = {
  scale: number;
  onChange: (scale: number) => void;
};

export function FontSizeSetting({ scale, onChange }: Props) {
  const { t } = useTranslation();
  const sliderId = useId();
  const value = clampFontScale(scale);
  const isDefault = value === FONT_SCALE.default;
  const step = (direction: 1 | -1) => onChange(clampFontScale(value + direction * FONT_SCALE.step));

  return (
    <div className="settings-subsection">
      <div className="settings-subsection-header">
        <label htmlFor={sliderId} className="settings-subsection-title">
          {t("settings.appearance.fontSize")}
        </label>
        <span className="setting-row-description">
          {t("settings.appearance.fontSizeHint", { size: formatFontScale(FONT_SCALE.default) })}
        </span>
      </div>
      <div className="font-size-setting">
        <div className="font-size-header">
          <span className="setting-row-description">{t("settings.appearance.currentSize")}</span>
          <span className="font-size-value">{formatFontScale(value)}</span>
          {!isDefault && (
            <button
              type="button"
              className="link-button font-size-reset"
              onClick={() => onChange(FONT_SCALE.default)}
            >
              <RotateCcw size={13} strokeWidth={2.2} />
              {t("settings.appearance.reset")}
            </button>
          )}
        </div>
        <div className="font-size-control">
          <button
            type="button"
            className="font-size-glyph small"
            aria-label={t("settings.appearance.smaller")}
            title={t("settings.appearance.smaller")}
            disabled={value <= FONT_SCALE.min}
            onClick={() => step(-1)}
          >
            A
          </button>
          <input
            id={sliderId}
            type="range"
            min={FONT_SCALE.min}
            max={FONT_SCALE.max}
            step={FONT_SCALE.step}
            value={value}
            aria-valuetext={formatFontScale(value)}
            onChange={(e) => onChange(clampFontScale(Number(e.target.value)))}
          />
          <button
            type="button"
            className="font-size-glyph large"
            aria-label={t("settings.appearance.larger")}
            title={t("settings.appearance.larger")}
            disabled={value >= FONT_SCALE.max}
            onClick={() => step(1)}
          >
            A
          </button>
        </div>
      </div>
    </div>
  );
}
