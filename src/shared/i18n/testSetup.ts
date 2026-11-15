import { i18n } from "./i18n";

// happy-dom says the computer is in English; the tests expect «Sistema» to give Spanish, like their texts
if (typeof navigator !== "undefined") {
  Object.defineProperty(navigator, "languages", { value: ["es-ES"], configurable: true });
}

await i18n.changeLanguage("es");
