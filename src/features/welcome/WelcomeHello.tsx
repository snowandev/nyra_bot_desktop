import { ArrowRight, Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LANGUAGE_NAMES, LANGUAGES, type LanguagePreference } from "@/shared/i18n/languages";
import { BrandIcon } from "@/shared/ui/BrandIcon";

type Props = {
  language: LanguagePreference;
  // The language "system" stands for on this computer
  systemLanguage: string;
  onLanguageChange: (language: LanguagePreference) => void;
  onStart: () => void;
};

// The cover: what Nyra is, in a sentence, and the language everything after it comes in
export function WelcomeHello({ language, systemLanguage, onLanguageChange, onStart }: Props) {
  const { t } = useTranslation();
  const shown = language === "system" ? systemLanguage : language;
  return (
    <div className="welcome-hello">
      <span className="welcome-emblem">
        <BrandIcon size={64} gradient />
      </span>
      <h1 className="welcome-title" tabIndex={-1}>
        {t("welcome.hello.title")}
      </h1>
      <p>{t("welcome.hello.text")}</p>
      <div className="welcome-language">
        <div role="group" aria-label={t("welcome.hello.language")} className="segmented">
          {LANGUAGES.map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={shown === code}
              onClick={() => onLanguageChange(code === systemLanguage ? "system" : code)}
            >
              {LANGUAGE_NAMES[code]}
            </button>
          ))}
        </div>
        <small>
          <Languages size={12} strokeWidth={2} aria-hidden="true" />
          {language === "system" ? t("welcome.hello.fromSystem") : t("welcome.hello.chosen")}
        </small>
      </div>
      <button type="button" className="primary-button welcome-start" onClick={onStart}>
        {t("welcome.hello.start")}
        <ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  );
}
