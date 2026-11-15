import { describe, expect, it } from "vitest";
import type { Message, Model, ProviderConfig } from "@/shared/types";
import { contextLimitOf, contextStateOf } from "./context";

const model: Model = { id: "qwen", name: "qwen", description: "", providerId: "ollama", contextWindow: 262_144 };
const config: ProviderConfig = { baseUrl: "", apiKey: "" };
const reply = (used: number): Message => ({ role: "assistant", content: "…", model: "qwen", usage: { used } });

describe("contextLimitOf", () => {
  it("uses the size set in Settings, since Ollama loads exactly that", () => {
    expect(contextLimitOf(model, { ...config, contextLength: 70_000 }, { loadsContext: true, loaded: 262_144 })).toEqual({
      limit: 70_000,
      source: "configured",
    });
  });

  it("left automatic, uses what Ollama loaded the model with, not the model's maximum", () => {
    expect(contextLimitOf(model, config, { loadsContext: true, loaded: 32_768 })).toEqual({ limit: 32_768, source: "loaded" });
    expect(contextLimitOf(model, config, { loadsContext: true, loaded: 262_144 })).toEqual({ limit: 262_144, source: "loaded" });
  });

  it("doesn't guess a local model's context before Ollama loads it", () => {
    expect(contextLimitOf(model, config, { loadsContext: true })).toBeNull();
  });

  it("uses a cloud model's maximum", () => {
    const claude = { ...model, providerId: "anthropic", contextWindow: 1_000_000 };
    expect(contextLimitOf(claude, config, { loadsContext: false, loaded: 4096 })).toEqual({ limit: 1_000_000, source: "maximum" });
  });
});

describe("contextStateOf", () => {
  it("measures the latest reply against the real context", () => {
    const state = contextStateOf([reply(24_576)], { limit: 32_768, source: "loaded" });
    expect(state?.fraction).toBe(0.75);
    expect(state?.level).toBe("high");
    expect(state?.source).toBe("loaded");
  });

  it("has nothing to show before the first measured reply or without a known context", () => {
    expect(contextStateOf([{ role: "user", content: "hola" }], { limit: 32_768, source: "loaded" })).toBeNull();
    expect(contextStateOf([reply(1000)], null)).toBeNull();
  });
});
