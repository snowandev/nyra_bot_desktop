import { useTranslation } from "react-i18next";
import { AccentColorSetting } from "@/features/settings/AccentColorSetting";
import { ThemeSetting } from "@/features/settings/ThemeSetting";
import type { AccentColor, ThemePreference } from "@/shared/storage/settings";

type Props = {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  accent: AccentColor;
  onAccentChange: (accent: AccentColor) => void;
};

// The same pickers as Settings → Appearance; the welcome itself shows the choice at once
export function WelcomeAppearance({ theme, onThemeChange, accent, onAccentChange }: Props) {
  const { t } = useTranslation();
  return (
    <>
      <h1 className="welcome-title" tabIndex={-1}>
        {t("welcome.appearance.title")}
      </h1>
      <p className="welcome-lead">{t("welcome.appearance.lead")}</p>
      <ThemeSetting theme={theme} onChange={onThemeChange} />
      <AccentColorSetting accent={accent} onChange={onAccentChange} />
    </>
  );
}
