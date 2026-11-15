import { useCallback, useEffect, useMemo, useState } from "react";
import { applyLanguage } from "@/shared/i18n/i18n";
import { applyFontScale } from "@/shared/lib/fontScale";
import { applyAccent, applyTheme, followSystemTheme } from "@/shared/lib/theme";
import { isPreferencesKey, loadPreferences, type Preferences, savePreferences } from "@/shared/storage/settings";

export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences);

  // Another window saved them (Settings in the main window, while the quick bar stays open): this one follows, so it
  // never goes on sending memories or searching once the user turned that off
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (isPreferencesKey(event.key)) setPreferences(loadPreferences());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    applyTheme(preferences.theme);
    if (preferences.theme === "system") return followSystemTheme();
  }, [preferences.theme]);

  useEffect(() => {
    applyAccent(preferences.accentColor);
  }, [preferences.accentColor]);

  useEffect(() => {
    applyFontScale(preferences.fontScale);
  }, [preferences.fontScale]);

  useEffect(() => {
    applyLanguage(preferences.language);
  }, [preferences.language]);

  const updatePreferences = useCallback(
    (changes: Partial<Preferences>) => {
      const next = { ...preferences, ...changes };
      setPreferences(next);
      savePreferences(next);
    },
    [preferences],
  );

  // Shared through a context and read inside the memoized chat messages: a new object only when something changed
  return useMemo(() => ({ preferences, updatePreferences }), [preferences, updatePreferences]);
}
