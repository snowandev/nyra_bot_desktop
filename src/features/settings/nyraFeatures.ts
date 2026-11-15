import type { Preferences } from "@/shared/storage/settings";

// Each feature of «Funciones de Nyra» by the preference that turns it on: the panel lists them all and General counts
// them, so a new one can't be listed without being counted
export const FEATURE_PREFERENCES = {
  webSearch: "webSearch",
  readLinks: "readLinks",
  compatibleGuides: "compatibleGuides",
  memory: "memory",
  semanticSearch: "semanticSearch",
  runCommands: "runCommands",
  runCode: "runCode",
  browser: "browser",
  screenLook: "screenLook",
  transcription: "transcription",
  smartTitles: "smartTitles",
  sensitiveData: "sensitiveDataWarning",
} as const satisfies Record<string, keyof Preferences>;

export type FeatureId = keyof typeof FEATURE_PREFERENCES;
