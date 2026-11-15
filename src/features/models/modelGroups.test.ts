import { describe, expect, it } from "vitest";
import type { Model } from "@/shared/types";
import { groupByProvider, matchesQuery, menuModels, recentModels } from "./modelGroups";

const model = (id: string, providerId: string, name = id): Model => ({ id, name, description: "", providerId });
const qwen = model("qwen3.8:27b-mxfp8", "ollama");
const coder = model("qwen3-coder:30b", "ollama");
const opus = model("claude-opus-5-5", "anthropic", "Claude Opus 5.5");
const haiku = model("claude-haiku-4-5", "anthropic", "Claude Haiku 4.5");

describe("menuModels", () => {
  it("leaves out hidden models but keeps the one in use", () => {
    const ids = menuModels([qwen, coder, opus], [coder.id, opus.id], opus.id).map((m) => m.id);
    expect(ids).toEqual([qwen.id, opus.id]);
  });
});

describe("groupByProvider", () => {
  it("groups local models before cloud ones and skips providers without models", () => {
    expect(groupByProvider([opus, qwen, coder])).toEqual([
      { providerId: "ollama", label: "Ollama · en tu equipo", models: [qwen, coder] },
      { providerId: "anthropic", label: "Anthropic · en la nube", models: [opus] },
    ]);
    expect(groupByProvider([qwen]).map((g) => g.providerId)).toEqual(["ollama"]);
  });
});

describe("matchesQuery", () => {
  it("finds models by name or id, ignoring case and accents", () => {
    expect(matchesQuery(opus, "OPUS")).toBe(true);
    expect(matchesQuery(opus, "claude-opus")).toBe(true);
    expect(matchesQuery({ ...qwen, description: "Visión" }, "vision")).toBe(true);
    expect(matchesQuery(qwen, "haiku")).toBe(false);
    expect(matchesQuery(qwen, "  ")).toBe(true);
  });
});

describe("recentModels", () => {
  it("puts the default first, skips repeats and models that are gone, and keeps three", () => {
    const recent = recentModels([qwen, coder, opus, haiku], [opus.id, "gone", qwen.id, haiku.id, coder.id], qwen.id);
    expect(recent.map((m) => m.id)).toEqual([qwen.id, opus.id, haiku.id]);
  });
});
