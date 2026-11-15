import { invoke } from "@tauri-apps/api/core";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { loadPreferences } from "@/shared/storage/settings";
import { FALLBACK_LANGUAGE, type Language, type LanguagePreference, systemLanguage } from "./languages";
import en from "./locales/en.json";
import es from "./locales/es.json";

// The WebView reports the computer's languages, in the user's order; outside a window (tests in Node) there are none
const computerLanguages = () => (typeof navigator === "undefined" ? [] : navigator.languages);

export const resolveLanguage = (preference: LanguagePreference): Language =>
  preference === "system" ? systemLanguage(computerLanguages()) : preference;

// Every window imports this before rendering, so the first paint is already in the user's language. The catalogs go
// in the bundle: they are small, and switching language is instant and works offline.
void i18n.use(initReactI18next).init({
  resources: { es: { translation: es }, en: { translation: en } },
  // Outside a window (tests in Node) there are no saved preferences to read
  lng: typeof window === "undefined" ? FALLBACK_LANGUAGE : resolveLanguage(loadPreferences().language),
  fallbackLng: FALLBACK_LANGUAGE,
  initAsync: false,
  // React already escapes what it renders
  interpolation: { escapeValue: false },
});

// Rust writes its own messages and the tray menu; outside the app (tests) there is no Rust to tell
function tellRust(language: string) {
  if ("__TAURI_INTERNALS__" in globalThis) invoke("set_language", { language }).catch(() => {});
}

// Screen readers and the spell checker read the page in the language it declares
if (typeof document !== "undefined") document.documentElement.lang = i18n.language;
tellRust(i18n.language);

export function applyLanguage(preference: LanguagePreference) {
  const language = resolveLanguage(preference);
  if (typeof document !== "undefined") document.documentElement.lang = language;
  if (i18n.language !== language) void i18n.changeLanguage(language);
  tellRust(language);
}

// Numbers and dates follow the interface's language
export const currentLocale = () => i18n.language || FALLBACK_LANGUAGE;

export { i18n };
