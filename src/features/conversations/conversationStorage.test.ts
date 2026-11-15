import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "@/shared/types";
import { mergeWithStored, toOutgoingData } from "./conversationStorage";
import {
  loadCollapsedSections,
  loadDefaultSkills,
  loadPreferences,
  loadProviderOptions,
  saveCollapsedSections,
  saveDefaultSkills,
} from "@/shared/storage/settings";

describe("mergeWithStored", () => {
  const conversation = (id: string, messages = 1): Conversation => ({
    id,
    title: id,
    messages: Array.from({ length: messages }, () => ({ role: "user", content: "hola" })),
  });

  it("keeps unsaved conversations first and stored ones in their saved order", () => {
    const current = [conversation("new"), conversation("b")];
    const stored = [
      { id: "a", title: "A", updatedAt: 2, pinned: false, folderId: null, projectId: null },
      { id: "b", title: "B", updatedAt: 1, pinned: false, folderId: null, projectId: null },
    ];
    expect(mergeWithStored(current, stored).map((c) => c.id)).toEqual(["new", "a", "b"]);
  });

  it("keeps loaded messages unless the conversation was rewritten on disk", () => {
    const loaded = conversation("a", 3);
    const stored = [{ id: "a", title: "A", updatedAt: 1, pinned: false, folderId: null, projectId: null }];
    expect(mergeWithStored([loaded], stored)[0]).toBe(loaded);
    expect(mergeWithStored([loaded], stored, new Set(["a"]))[0].messages).toEqual([]);
  });

  it("reads which conversations are pinned and their folder from disk", () => {
    const stored = [{ id: "a", title: "A", updatedAt: 1, pinned: true, folderId: "f", projectId: "p" }];
    expect(mergeWithStored([], stored)[0]).toMatchObject({ pinned: true, folderId: "f", projectId: "p" });
  });
});

describe("toOutgoingData", () => {
  const image = { id: "img", kind: "image" as const, name: "foto.png", mimeType: "image/png", data: "AAAA" };
  const conversation: Conversation = {
    id: "c",
    title: "t",
    messages: [
      { role: "user", content: "mira", attachments: [image, { ...image, id: "new" }] },
      { role: "assistant", content: "vale" },
    ],
  };

  it("keeps the project and the task's skill with the conversation", () => {
    const data = toOutgoingData({ ...conversation, projectId: "p", taskSkill: "debug" }, new Set());
    expect(data).toMatchObject({ projectId: "p", taskSkill: "debug" });
    expect(toOutgoingData(conversation, new Set())).not.toHaveProperty("taskSkill");
  });

  it("sends stored attachments as just their id and new ones in full", () => {
    const { messages } = toOutgoingData(conversation, new Set(["img"]));
    expect(messages[0].attachments).toEqual([{ id: "img" }, { ...image, id: "new" }]);
    expect(messages[1]).toBe(conversation.messages[1]);
  });

  it("sends a stored command without its output, and a new one whole", () => {
    const run = (id: string) => ({
      ...{ id, command: "npm test", root: "/p", folder: "p", at: 0, n: 1 },
      ...{ state: "done" as const, output: "ok" },
    });
    const commands = [run("viejo"), run("nuevo")];
    const withRuns: Conversation = {
      ...conversation,
      messages: [conversation.messages[0], { role: "assistant", content: "vale", commands }],
    };
    const { messages } = toOutgoingData(withRuns, new Set(), new Set(["viejo"]));
    expect(messages[1].commands?.[0]).not.toHaveProperty("output");
    expect(messages[1].commands?.[1].output).toBe("ok");
    expect(withRuns.messages[1].commands?.[0].output).toBe("ok");
  });

  it("leaves the conversation in memory untouched", () => {
    toOutgoingData(conversation, new Set(["img"]));
    expect(conversation.messages[0].attachments?.[0]).toBe(image);
  });
});

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
