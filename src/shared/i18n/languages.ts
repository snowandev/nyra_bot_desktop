// The languages of Nyra's interface; adding one means a catalog in locales/ and its name here
export const LANGUAGES = ["es", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

// "system" follows the computer's language when Nyra has it
export type LanguagePreference = Language | "system";

// Each one written in itself, so anyone finds theirs whatever the interface is in
export const LANGUAGE_NAMES: Record<Language, string> = { es: "Español", en: "English" };

// Shown when the computer's language isn't one of Nyra's
export const FALLBACK_LANGUAGE: Language = "en";

const isLanguage = (code: string): code is Language => (LANGUAGES as readonly string[]).includes(code);

export const isLanguagePreference = (value: unknown): value is LanguagePreference =>
  value === "system" || (typeof value === "string" && isLanguage(value));

// The first of the user's languages that Nyra has ("es-MX" counts as "es"); none of them, English
export function systemLanguage(preferred: readonly string[]): Language {
  return preferred.map((tag) => tag.toLowerCase().split("-")[0]).find(isLanguage) ?? FALLBACK_LANGUAGE;
}
