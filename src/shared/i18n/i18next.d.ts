import "i18next";
import type es from "./locales/es.json";

// Keys come from the Spanish catalog, so a key that doesn't exist is a type error
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof es };
  }
}
