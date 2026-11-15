import { useId } from "react";
import { useTranslation } from "react-i18next";
import { resolveLanguage } from "@/shared/i18n/i18n";
import { LANGUAGE_NAMES, LANGUAGES, type LanguagePreference } from "@/shared/i18n/languages";

type Props = {
  language: LanguagePreference;
  onChange: (language: LanguagePreference) => void;
};

const OPTIONS: LanguagePreference[] = ["system", ...LANGUAGES];

export function LanguageSetting({ language, onChange }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  // «Sistema» says which language it gives, since the computer may be in one Nyra doesn't have
  const labelOf = (option: LanguagePreference) =>
    option === "system"
      ? t("settings.appearance.languageSystem", { language: LANGUAGE_NAMES[resolveLanguage("system")] })
      : LANGUAGE_NAMES[option];

  return (
    <div className="settings-subsection">
      <div className="settings-subsection-header">
        <h4 id={titleId} className="settings-subsection-title">
          {t("settings.appearance.language")}
        </h4>
        <span className="setting-row-description">{t("settings.appearance.languageHint")}</span>
      </div>
      <div className="segmented" role="group" aria-labelledby={titleId}>
        {OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={language === option}
            // Each language's name is written in itself, so it is read with its own pronunciation
            lang={option === "system" ? undefined : option}
            onClick={() => onChange(option)}
          >
            {labelOf(option)}
          </button>
        ))}
      </div>
    </div>
  );
}
