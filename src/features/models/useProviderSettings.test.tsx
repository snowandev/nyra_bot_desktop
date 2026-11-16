// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Model } from "@/shared/types";
import { useProviderSettings } from "./useProviderSettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The keychain answers as on a computer with no keys saved
vi.mock("./secretStorage", () => ({
  secretStore: async () => "keychain",
  savedApiKeys: async () => [],
  loadApiKey: async () => null,
  saveApiKey: async () => {},
  forgetApiKey: async () => {},
}));

const model = (id: string): Model => ({ id, name: id, description: "", providerId: "ollama" });

let settings: ReturnType<typeof useProviderSettings>;
const keep = (current: ReturnType<typeof useProviderSettings>) => {
  settings = current;
};
function Probe({ onRender }: { onRender: typeof keep }) {
  onRender(useProviderSettings());
  return null;
}

let root: Root;

beforeEach(async () => {
  localStorage.clear();
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe onRender={keep} />));
});

afterEach(() => act(() => root.unmount()));

describe("useProviderSettings", () => {
  it("takes the default model, not the first one, when models arrive with none chosen (the first day)", async () => {
    expect(settings.selectedModelId).toBe("");
    act(() => settings.changeDefaultModel("qwen-chosen"));
    act(() => settings.replaceProviderModels("ollama", [model("llama-first"), model("qwen-chosen")]));
    expect(settings.selectedModelId).toBe("qwen-chosen");
  });

  it("keeps the first one when there is no default, and never changes a model already chosen", async () => {
    act(() => settings.replaceProviderModels("ollama", [model("a"), model("b")]));
    expect(settings.selectedModelId).toBe("a");
    act(() => settings.selectModel("b"));
    act(() => settings.changeDefaultModel("a"));
    act(() => settings.replaceProviderModels("ollama", [model("a"), model("b"), model("c")]));
    expect(settings.selectedModelId).toBe("b");
  });

  it("chooses the default one when another window brings the first models (the quick bar)", async () => {
    // What the main window saves, as the quick bar's window receives it
    localStorage.setItem("nyrabot.models", JSON.stringify([model("llama-first"), model("qwen-chosen")]));
    localStorage.setItem("nyrabot.defaultModel", JSON.stringify("qwen-chosen"));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "nyrabot.defaultModel" }));
    });
    expect(settings.selectedModel?.id).toBe("qwen-chosen");
  });

  it("starts a new conversation on the default model", async () => {
    act(() => settings.replaceProviderModels("ollama", [model("a"), model("b")]));
    act(() => settings.selectModel("b"));
    act(() => settings.changeDefaultModel("a"));
    act(() => settings.selectDefaultModel());
    expect(settings.selectedModelId).toBe("a");
  });
});
