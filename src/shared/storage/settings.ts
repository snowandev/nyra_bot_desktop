import { isLanguagePreference, type LanguagePreference } from "@/shared/i18n/languages";
import type { Model, ProviderOptions } from "@/shared/types";

// The quick chat bar's global shortcut until the user records another (a Tauri accelerator)
// Control on every system: on macOS no system shortcut uses ⌃⇧Space, and without ⌘ it can't set off the gesture that
// opens Siri (pressing ⌘ twice)
export const DEFAULT_QUICK_SHORTCUT = "Control+Shift+Space";
// The earlier default; the recorder writes ⌘ as "Super", so a saved one was never chosen by the user
const EARLIER_QUICK_SHORTCUT = "CommandOrControl+Shift+Space";

const PROVIDER_OPTIONS_KEY = "nyrabot.providerOptions";
const MODELS_KEY = "nyrabot.models";
const SELECTED_MODEL_KEY = "nyrabot.selectedModel";
const DEFAULT_MODEL_KEY = "nyrabot.defaultModel";
const DEMANDING_MODEL_KEY = "nyrabot.demandingModel";
const AUTO_MODEL_KEY = "nyrabot.autoModel";
const ASK_BEFORE_CLOUD_KEY = "nyrabot.askBeforeCloud";
const HIDDEN_MODELS_KEY = "nyrabot.hiddenModels";
const RECENT_MODELS_KEY = "nyrabot.recentModels";
const COLLAPSED_MODEL_GROUPS_KEY = "nyrabot.collapsedModelGroups";
const DEFAULT_SKILLS_KEY = "nyrabot.defaultSkills";
const DEFAULT_CODE_SKILLS_KEY = "nyrabot.defaultCodeSkills";
const PREFERENCES_KEY = "nyrabot.preferences";
// Whether a storage change is to the preferences (another window saved them)
export const isPreferencesKey = (key: string | null) => key === PREFERENCES_KEY;
// What the main window and the quick bar share about models; a null key is all storage cleared at once
const MODEL_SETTINGS_KEYS = new Set([
  PROVIDER_OPTIONS_KEY,
  MODELS_KEY,
  DEFAULT_MODEL_KEY,
  DEMANDING_MODEL_KEY,
  AUTO_MODEL_KEY,
  ASK_BEFORE_CLOUD_KEY,
  HIDDEN_MODELS_KEY,
]);
export const isModelSettingsKey = (key: string | null) => key === null || MODEL_SETTINGS_KEYS.has(key);
const COLLAPSED_SECTIONS_KEY = "nyrabot.collapsedSections";
const LEARNED_CONTEXTS_KEY = "nyrabot.learnedContexts";
const LOADED_CONTEXTS_KEY = "nyrabot.loadedContexts";
const TRAY_NOTICE_KEY = "nyrabot.trayNoticeShown";
const QUICK_LAST_KEY = "nyrabot.quickLast";
const SPACE_KEY = "nyrabot.space";
const LAST_PROJECT_KEY = "nyrabot.lastProject";
const PROJECT_PANEL_KEY = "nyrabot.projectPanel";
const SIDEBAR_FOLDED_KEY = "nyrabot.sidebarFolded";
const OPENED_VERSION_KEY = "nyrabot.openedVersion";

// Earlier versions kept each provider option under its own key
const LEGACY_BASE_URLS_KEY = "nyrabot.baseUrls";
const LEGACY_CONTEXT_LENGTHS_KEY = "nyrabot.contextLengths";
const LEGACY_AUTO_SUMMARIZE_KEY = "nyrabot.autoSummarize";

export type Theme = "dark" | "light";
export type ThemePreference = Theme | "system";

// How sharp a reply shared as an image comes out, against how much its file weighs
export const IMAGE_QUALITIES = ["high", "normal", "low"] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];
// How big the quick chat grows: its width and the most it grows upwards (quick.rs)
export const QUICK_SIZES = ["normal", "large", "extraLarge"] as const;
export type QuickSize = (typeof QUICK_SIZES)[number];
const isQuickSize = (value: unknown): value is QuickSize => QUICK_SIZES.includes(value as QuickSize);
const isImageQuality = (value: unknown): value is ImageQuality =>
  typeof value === "string" && (IMAGE_QUALITIES as readonly string[]).includes(value);

// The sizes of Whisper Nyra offers: small is quick on any computer, turbo hears better

// Violet is Nyra's own color and the default
export const ACCENT_COLORS = ["violet", "blue", "green", "amber", "pink", "graphite"] as const;
export type AccentColor = (typeof ACCENT_COLORS)[number];

function isAccentColor(value: unknown): value is AccentColor {
  return ACCENT_COLORS.some((color) => color === value);
}

// What the user tells Nyra about themselves and how to answer; an empty field means "not set"
export type Personalization = {
  name: string;
  occupation: string;
  instructions: string;
};

export type Preferences = {
  notifyOnReply: boolean;
  // A notice when a command waits for the user's approval or answer and Nyra is in the background
  notifyOnAttention: boolean;
  theme: ThemePreference;
  accentColor: AccentColor;
  // Multiplies every font size; 1 is the original size
  fontScale: number;
  personalization: Personalization;
  webSearch: boolean;
  smartTitles: boolean;
  // Ask before a message that looks like it holds a secret goes to a cloud provider
  sensitiveDataWarning: boolean;
  // Read the page of a pasted link and attach it to the message
  readLinks: boolean;
  // A connected folder's CLAUDE.md and AGENTS.md are followed like its NYRA.md, which is always
  compatibleGuides: boolean;
  // Send the saved memories with every message and let the model save new ones
  memory: boolean;
  semanticSearch: boolean;
  // The interface's language; "system" follows the computer's
  language: LanguagePreference;
  shareImageQuality: ImageQuality;
  // The Ollama embedding model for searching by meaning; null lets Nyra choose
  embeddingModel: string | null;
  // In a connected folder the model may ask to run commands, each one only once the user approves it
  runCommands: boolean;
  // The model may write a program and run it, each one only once the user approves it, with or without a folder
  runCode: boolean;
  // The model may open pages in the browser installed on this computer, asking once to open it unless the user did
  browser: boolean;
  // A model that sees images may look at the user's screen and point things out on it, asking once per conversation
  screenLook: boolean;
  // The welcome was seen (finished or skipped): it opens by itself only on a new install
  welcomeDone: boolean;
  // Attached audio is transcribed on this computer, by a Whisper of this size, with its speakers told apart or not
  transcription: boolean;
  // The Whisper the user chose among those added, by id; null, or one deleted since, means the first one there
  transcriptionModel: string | null;
  transcriptionSpeakers: boolean;
  // Closing the window hides Nyra in the system bar instead of quitting
  keepInTray: boolean;
  // On opening, Nyra asks GitHub for the latest published version
  checkUpdates: boolean;
  // The global shortcut that shows the quick chat bar, as the plugin reads it
  quickShortcutEnabled: boolean;
  quickShortcut: string;
  quickSize: QuickSize;
};

// API keys are intentionally left out: secrets never go to localStorage
export type StoredProviderOptions = Partial<Omit<ProviderOptions, "apiKey">>;

const EMPTY_PERSONALIZATION: Personalization = { name: "", occupation: "", instructions: "" };

const DEFAULT_PREFERENCES: Preferences = {
  notifyOnReply: true,
  notifyOnAttention: true,
  theme: "dark",
  accentColor: "violet",
  fontScale: 1,
  personalization: EMPTY_PERSONALIZATION,
  webSearch: true,
  smartTitles: true,
  sensitiveDataWarning: true,
  readLinks: true,
  compatibleGuides: true,
  memory: true,
  semanticSearch: true,
  language: "system",
  shareImageQuality: "high",
  embeddingModel: null,
  runCommands: true,
  runCode: true,
  browser: true,
  screenLook: true,
  welcomeDone: false,
  transcription: true,
  transcriptionModel: null,
  transcriptionSpeakers: true,
  keepInTray: true,
  checkUpdates: true,
  quickShortcutEnabled: true,
  quickShortcut: DEFAULT_QUICK_SHORTCUT,
  quickSize: "normal",
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable; settings then last only for this session
  }
}

function remove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to clean up if storage is unavailable
  }
}

function migrateLegacyProviderOptions() {
  const baseUrls = read<Record<string, string>>(LEGACY_BASE_URLS_KEY, {});
  const contextLengths = read<Record<string, number>>(LEGACY_CONTEXT_LENGTHS_KEY, {});
  const autoSummarize = read<Record<string, boolean>>(LEGACY_AUTO_SUMMARIZE_KEY, {});
  const providerIds = new Set([...Object.keys(baseUrls), ...Object.keys(contextLengths), ...Object.keys(autoSummarize)]);

  const options: Record<string, StoredProviderOptions> = {};
  providerIds.forEach((id) => {
    options[id] = { baseUrl: baseUrls[id], contextLength: contextLengths[id], autoSummarize: autoSummarize[id] };
  });
  saveProviderOptions(options);
  [LEGACY_BASE_URLS_KEY, LEGACY_CONTEXT_LENGTHS_KEY, LEGACY_AUTO_SUMMARIZE_KEY].forEach(remove);
  return options;
}

export const loadProviderOptions = () =>
  read<Record<string, StoredProviderOptions> | null>(PROVIDER_OPTIONS_KEY, null) ?? migrateLegacyProviderOptions();
export const saveProviderOptions = (options: Record<string, StoredProviderOptions>) =>
  write(PROVIDER_OPTIONS_KEY, options);

// Lists saved before the capability icons ended their description in "· Visión"; the icon says it now
export const loadModels = () =>
  read<Model[]>(MODELS_KEY, []).map((m) => ({ ...m, description: m.description.replace(/ · Visión$/, "") }));
export const saveModels = (models: Model[]) => write(MODELS_KEY, models);

export const loadSelectedModel = () => read<string | null>(SELECTED_MODEL_KEY, null);
export const saveSelectedModel = (id: string) => write(SELECTED_MODEL_KEY, id);

export const loadDefaultModel = () => read<string | null>(DEFAULT_MODEL_KEY, null);
export const saveDefaultModel = (id: string | null) => (id ? write(DEFAULT_MODEL_KEY, id) : remove(DEFAULT_MODEL_KEY));

// The model for demanding tasks, next to the main one (the default); none means the main one does everything
export const loadDemandingModel = () => {
  const id = read<unknown>(DEMANDING_MODEL_KEY, null);
  return typeof id === "string" ? id : null;
};
export const saveDemandingModel = (id: string | null) =>
  id ? write(DEMANDING_MODEL_KEY, id) : remove(DEMANDING_MODEL_KEY);

// With a model for demanding tasks, whether Nyra picks between the two (on until the user picks a model by hand)
export const loadAutoModel = () => read<unknown>(AUTO_MODEL_KEY, true) !== false;
export const saveAutoModel = (auto: boolean) => write(AUTO_MODEL_KEY, auto);

// A conversation moves to a cloud model only once the user says so, unless they turned this off
export const loadAskBeforeCloud = () => read<unknown>(ASK_BEFORE_CLOUD_KEY, true) !== false;
export const saveAskBeforeCloud = (ask: boolean) => write(ASK_BEFORE_CLOUD_KEY, ask);

// Model ids from localStorage; anything that isn't text is dropped
// fallback is for a key never saved; a saved empty list stays empty
function readIds(key: string, fallback: string[] = []): string[] {
  const stored = read<unknown>(key, null);
  if (stored === null) return fallback;
  return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [];
}

export const loadHiddenModels = () => readIds(HIDDEN_MODELS_KEY);
export const saveHiddenModels = (ids: string[]) => write(HIDDEN_MODELS_KEY, ids);

export const loadRecentModels = () => readIds(RECENT_MODELS_KEY);
export const saveRecentModels = (ids: string[]) => write(RECENT_MODELS_KEY, ids);

// Groups of the chat's model menu the user collapsed: provider ids and "recent"
export const loadCollapsedModelGroups = () => readIds(COLLAPSED_MODEL_GROUPS_KEY);
export const saveCollapsedModelGroups = (ids: string[]) => write(COLLAPSED_MODEL_GROUPS_KEY, ids);

// The names Nyra's own skills had before they were in English; a list saved back then still has them
const OLD_BUILTIN_NAMES = new Map([
  ["escribir", "writing"],
  ["resumir", "summarize"],
  ["explicar", "explain"],
  ["explicar-proyecto", "explain-project"],
  ["revisar-codigo", "code-review"],
  ["escribir-tests", "write-tests"],
  ["depurar", "debug"],
  ["refactorizar", "refactor"],
  ["commit-y-pr", "commit-and-pr"],
  ["actualizar-dependencias", "update-dependencies"],
  ["documentar-codigo", "document-code"],
]);
const withCurrentNames = (names: string[]) => names.map((name) => OLD_BUILTIN_NAMES.get(name) ?? name);

// Skills that come marked in every new conversation, by name. Until the user changes the list, three of the skills
// that come with Nyra; once changed (even to none), their choice stays.
const INITIAL_DEFAULT_SKILLS = ["writing", "summarize", "explain"];
export const loadDefaultSkills = () => withCurrentNames(readIds(DEFAULT_SKILLS_KEY, INITIAL_DEFAULT_SKILLS));
export const saveDefaultSkills = (names: string[]) => write(DEFAULT_SKILLS_KEY, names);

// The same for new conversations of a code project. Until changed, the coding skills that come with Nyra, as every
// project had them on before this list existed.
const INITIAL_DEFAULT_CODE_SKILLS = [
  "explain-project",
  "code-review",
  "write-tests",
  "debug",
  "refactor",
  "commit-and-pr",
  "update-dependencies",
  "document-code",
];
export const loadDefaultCodeSkills = () =>
  withCurrentNames(readIds(DEFAULT_CODE_SKILLS_KEY, INITIAL_DEFAULT_CODE_SKILLS));
export const saveDefaultCodeSkills = (names: string[]) => write(DEFAULT_CODE_SKILLS_KEY, names);

// Older versions stored no personalization, and a field added later would be missing; non-text values are dropped
function readPersonalization(stored: unknown): Personalization {
  const fields = typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
  const text = (key: keyof Personalization) => {
    const value = fields[key];
    return typeof value === "string" ? value : "";
  };
  return { name: text("name"), occupation: text("occupation"), instructions: text("instructions") };
}

export function loadPreferences(): Preferences {
  const stored = read<Partial<Preferences>>(PREFERENCES_KEY, {});
  return {
    ...DEFAULT_PREFERENCES,
    ...stored,
    accentColor: isAccentColor(stored.accentColor) ? stored.accentColor : DEFAULT_PREFERENCES.accentColor,
    personalization: readPersonalization(stored.personalization),
    embeddingModel: typeof stored.embeddingModel === "string" ? stored.embeddingModel : null,
    language: isLanguagePreference(stored.language) ? stored.language : DEFAULT_PREFERENCES.language,
    shareImageQuality: isImageQuality(stored.shareImageQuality)
      ? stored.shareImageQuality
      : DEFAULT_PREFERENCES.shareImageQuality,
    transcriptionModel: typeof stored.transcriptionModel === "string" ? stored.transcriptionModel : null,
    quickSize: isQuickSize(stored.quickSize) ? stored.quickSize : DEFAULT_PREFERENCES.quickSize,
    // Preferences saved before the welcome existed are someone who already uses Nyra: it doesn't open for them
    welcomeDone: typeof stored.welcomeDone === "boolean" ? stored.welcomeDone : Object.keys(stored).length > 0,
    ...(stored.quickShortcut === EARLIER_QUICK_SHORTCUT && { quickShortcut: DEFAULT_QUICK_SHORTCUT }),
  };
}
export const savePreferences = (preferences: Preferences) => write(PREFERENCES_KEY, preferences);

// Where the app opens: the Chat space or the Código one, with the project that was open last
export type Space = "chat" | "code";
export const loadSpace = (): Space => (read<string>(SPACE_KEY, "chat") === "code" ? "code" : "chat");
export const saveSpace = (space: Space) => write(SPACE_KEY, space);
// Whether the project panel is open next to the chat; it starts open
export const loadProjectPanelOpen = () => read<unknown>(PROJECT_PANEL_KEY, true) !== false;
export const saveProjectPanelOpen = (open: boolean) => write(PROJECT_PANEL_KEY, open);
// Whether the user folded the sidebar into icons, for more room, in both spaces; it starts whole
export const loadSidebarFolded = () => read<unknown>(SIDEBAR_FOLDED_KEY, false) === true;
export const saveSidebarFolded = (folded: boolean) => write(SIDEBAR_FOLDED_KEY, folded);

// The version that opened last time: a newer one now means it was just updated
export function loadOpenedVersion() {
  const version = read<unknown>(OPENED_VERSION_KEY, null);
  return typeof version === "string" ? version : null;
}
export const saveOpenedVersion = (version: string) => write(OPENED_VERSION_KEY, version);

export function loadLastProject() {
  const id = read<unknown>(LAST_PROJECT_KEY, null);
  return typeof id === "string" ? id : null;
}
export const saveLastProject = (id: string) => write(LAST_PROJECT_KEY, id);

// The notice that closing only hid Nyra is shown once
export const loadTrayNoticeShown = () => read<unknown>(TRAY_NOTICE_KEY, false) === true;
export const saveTrayNoticeShown = () => write(TRAY_NOTICE_KEY, true);

// The quick chat bar's latest conversation and when it was left, to take it up again if it was a moment ago
type QuickLast = { conversationId: string; leftAt: number };
export function loadQuickLast(): QuickLast | null {
  const stored = read<unknown>(QUICK_LAST_KEY, null);
  if (typeof stored !== "object" || stored === null) return null;
  const { conversationId, leftAt } = stored as Partial<QuickLast>;
  return typeof conversationId === "string" && typeof leftAt === "number" ? { conversationId, leftAt } : null;
}
export const saveQuickLast = (last: QuickLast) => write(QUICK_LAST_KEY, last);
export const clearQuickLast = () => remove(QUICK_LAST_KEY);
// The main window opened or deleted it: the bar keeps an older copy of it, so it must not take it up again
export function releaseFromQuick(conversationId: string) {
  if (loadQuickLast()?.conversationId === conversationId) clearQuickLast();
}

// Sidebar sections the user collapsed
// A folder's section is "folder:<id>", and a project's of the Código space "project:<id>"
export type SidebarSection = "pinned" | "folders" | "chats" | `folder:${string}` | `project:${string}`;

const isSidebarSection = (value: unknown): value is SidebarSection =>
  value === "pinned" ||
  value === "folders" ||
  value === "chats" ||
  (typeof value === "string" && (value.startsWith("folder:") || value.startsWith("project:")));

// It comes from localStorage, so anything that isn't a known section is dropped
export function loadCollapsedSections(): SidebarSection[] {
  const stored = read<unknown>(COLLAPSED_SECTIONS_KEY, []);
  return Array.isArray(stored) ? stored.filter(isSidebarSection) : [];
}

export const saveCollapsedSections = (sections: SidebarSection[]) => write(COLLAPSED_SECTIONS_KEY, sections);

// Tokens by model id. Only positive numbers are kept; anything else in storage is dropped.
function readTokensByModel(key: string): Record<string, number> {
  const stored = read<unknown>(key, {});
  if (typeof stored !== "object" || stored === null) return {};
  return Object.fromEntries(
    Object.entries(stored).filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0),
  );
}

// The context each local model managed on this computer before running out of memory
export const loadLearnedContexts = () => readTokensByModel(LEARNED_CONTEXTS_KEY);
export const saveLearnedContext = (modelId: string, tokens: number) =>
  write(LEARNED_CONTEXTS_KEY, { ...loadLearnedContexts(), [modelId]: tokens });

// The context Ollama last loaded each model with while its size was left automatic. Ollama picks it from the memory
// free when it loads the model, so it changes; this is the latest seen, for before the model is loaded again.
export const loadLoadedContexts = () => readTokensByModel(LOADED_CONTEXTS_KEY);
export const saveLoadedContext = (modelId: string, tokens: number) => {
  if (loadLoadedContexts()[modelId] !== tokens) write(LOADED_CONTEXTS_KEY, { ...loadLoadedContexts(), [modelId]: tokens });
};
