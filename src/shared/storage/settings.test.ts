import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadCollapsedSections,
  loadDefaultSkills,
  loadPreferences,
  loadProviderOptions,
  saveCollapsedSections,
  saveDefaultSkills,
} from "./settings";

describe("settings in localStorage", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fills in defaults and drops personalization values that aren't text", () => {
    store.set("nyrabot.preferences", JSON.stringify({ theme: "light", personalization: { name: 42, occupation: "Dev" } }));
    const preferences = loadPreferences();
    expect(preferences.theme).toBe("light");
    expect(preferences.fontScale).toBe(1);
    expect(preferences.personalization).toEqual({ name: "", occupation: "Dev", instructions: "" });
  });

  it("shares images in high quality until the user picks another, and ignores an unknown one", () => {
    expect(loadPreferences().shareImageQuality).toBe("high");
    store.set("nyrabot.preferences", JSON.stringify({ shareImageQuality: "low" }));
    expect(loadPreferences().shareImageQuality).toBe("low");
    store.set("nyrabot.preferences", JSON.stringify({ shareImageQuality: "ultra" }));
    expect(loadPreferences().shareImageQuality).toBe("high");
  });

  it("moves the quick bar off the earlier default shortcut, and keeps one the user recorded", () => {
    store.set("nyrabot.preferences", JSON.stringify({ quickShortcut: "CommandOrControl+Shift+Space" }));
    expect(loadPreferences().quickShortcut).toBe("Control+Shift+Space");
    store.set("nyrabot.preferences", JSON.stringify({ quickShortcut: "Shift+Super+Space" }));
    expect(loadPreferences().quickShortcut).toBe("Shift+Super+Space");
  });

  it("moves the old per-option keys into the unified provider options and removes them", () => {
    store.set("nyrabot.baseUrls", JSON.stringify({ ollama: "http://otra:11434" }));
    store.set("nyrabot.contextLengths", JSON.stringify({ ollama: 8192 }));
    store.set("nyrabot.autoSummarize", JSON.stringify({ ollama: false }));

    expect(loadProviderOptions()).toEqual({
      ollama: { baseUrl: "http://otra:11434", contextLength: 8192, autoSummarize: false },
    });
    expect([...store.keys()]).toEqual(["nyrabot.providerOptions"]);
  });

  it("starts with three of Nyra's skills as defaults, and keeps the user's choice once made, even none", () => {
    expect(loadDefaultSkills()).toEqual(["writing", "summarize", "explain"]);
    saveDefaultSkills(["summarize"]);
    expect(loadDefaultSkills()).toEqual(["summarize"]);
    saveDefaultSkills([]);
    expect(loadDefaultSkills()).toEqual([]);
  });

  it("reads a list saved with the old Spanish names of Nyra's skills under their English names", () => {
    saveDefaultSkills(["resumir", "mia", "commit-y-pr"]);
    expect(loadDefaultSkills()).toEqual(["summarize", "mia", "commit-and-pr"]);
  });

  it("remembers collapsed sidebar sections and ignores unknown values", () => {
    expect(loadCollapsedSections()).toEqual([]);
    saveCollapsedSections(["chats"]);
    expect(loadCollapsedSections()).toEqual(["chats"]);
    store.set("nyrabot.collapsedSections", JSON.stringify(["pinned", "otra", 3]));
    expect(loadCollapsedSections()).toEqual(["pinned"]);
    store.set("nyrabot.collapsedSections", JSON.stringify({ chats: true }));
    expect(loadCollapsedSections()).toEqual([]);
  });
});
