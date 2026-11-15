import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { ThemePreference } from "@/shared/storage/settings";
import { ThemePreview } from "./ThemePreview";

const THEMES = [
  { id: "dark", Icon: Moon },
  { id: "light", Icon: Sun },
  { id: "system", Icon: Monitor },
] as const;

type Props = {
  theme: ThemePreference;
  onChange: (theme: ThemePreference) => void;
};

// Dark, light or the system's, each with a small picture of the app; in Appearance and in the welcome
export function ThemeSetting({ theme, onChange }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <div className="settings-subsection">
      <div className="settings-subsection-header">
        <h4 id={titleId} className="settings-subsection-title">
          {t("settings.appearance.theme")}
        </h4>
        <span className="setting-row-description">{t("settings.appearance.themeHint")}</span>
      </div>
      <div role="radiogroup" aria-labelledby={titleId} className="theme-options">
        {THEMES.map(({ id, Icon }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={theme === id}
            className={`theme-option ${theme === id ? "selected" : ""}`}
            onClick={() => onChange(id)}
          >
            <span className="theme-preview-frame" aria-hidden="true">
              {id === "system" ? (
                <>
                  <ThemePreview theme="dark" />
                  <ThemePreview theme="light" />
                </>
              ) : (
                <ThemePreview theme={id} />
              )}
            </span>
            <span className="theme-option-label">
              <Icon size={16} strokeWidth={2} />
              {t(`settings.appearance.themes.${id}`)}
              {theme === id && <Check size={16} strokeWidth={2.4} className="theme-option-check" />}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
