import { useTranslation } from "react-i18next";
import type { LanguagePreference } from "@/shared/i18n/languages";
import type { AccentColor, ThemePreference } from "@/shared/storage/settings";
import { AccentColorSetting } from "./AccentColorSetting";
import { FontSizeSetting } from "./FontSizeSetting";
import { LanguageSetting } from "./LanguageSetting";
import { SettingsPanel } from "@/shared/ui/SettingsPanel";
import { ThemeSetting } from "./ThemeSetting";

type Props = {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  accent: AccentColor;
  onAccentChange: (accent: AccentColor) => void;
  fontScale: number;
  onFontScaleChange: (scale: number) => void;
  language: LanguagePreference;
  onLanguageChange: (language: LanguagePreference) => void;
};

export function AppearanceSettings(props: Props) {
  const { theme, onThemeChange, accent, onAccentChange, fontScale, onFontScaleChange } = props;
  const { language, onLanguageChange } = props;
  const { t } = useTranslation();

  return (
    <SettingsPanel title={t("settings.general.appearance")} description={t("settings.appearance.description")}>
      <ThemeSetting theme={theme} onChange={onThemeChange} />

      <AccentColorSetting accent={accent} onChange={onAccentChange} />

      <FontSizeSetting scale={fontScale} onChange={onFontScaleChange} />

      <LanguageSetting language={language} onChange={onLanguageChange} />
    </SettingsPanel>
  );
}
