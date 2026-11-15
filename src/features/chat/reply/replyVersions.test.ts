import { describe, expect, it } from "vitest";
import type { Message } from "@/shared/types";
import { nextVersion, selectVersion, versionsOf, withoutEmptyVersion } from "./replyVersions";

const reply = (content: string, model: string): Message => ({ role: "assistant", content, model });
const placeholder = (model: string): Message => ({ role: "assistant", content: "", model });

// Three versions, as after regenerating twice
function threeVersions() {
  const second = { ...nextVersion(reply("A", "qwen3"), placeholder("claude")), content: "B" };
  return { ...nextVersion(second, placeholder("gemma")), content: "C" };
}

describe("reply versions", () => {
  it("keeps each version's cards with it: a tool, the browser, a screenshot", () => {
    const first: Message = {
      ...reply("Busqué en GitHub", "qwen3"),
      toolCalls: [{ id: "t1", at: 0, server: "github", serverName: "GitHub", tool: "search", arguments: "{}", state: "done" }],
      browser: { at: 3, steps: [{ kind: "open", target: "https://ejemplo.com" }] } as unknown as Message["browser"],
      attachments: [{ id: "shot", kind: "image", name: "page.png", mimeType: "image/png", data: "AA" }],
    };
    const regenerated = { ...nextVersion(first, placeholder("claude")), content: "Sin herramientas" };
    // The new version doesn't show the earlier one's cards
    expect(regenerated.toolCalls).toBeUndefined();
    expect(regenerated.browser).toBeUndefined();
    expect(regenerated.attachments).toBeUndefined();
    // Going back finds them all
    const back = selectVersion(regenerated, 0);
    expect(back.content).toBe("Busqué en GitHub");
    expect(back.toolCalls?.[0].id).toBe("t1");
    expect(back.browser).toEqual(first.browser);
    expect(back.attachments?.[0].id).toBe("shot");
    // And forward again, none of them
    expect(selectVersion(back, 1).toolCalls).toBeUndefined();
  });

  it("keeps every earlier reply when regenerating and shows the new one last", () => {
    const message = threeVersions();
    expect(message.content).toBe("C");
    expect(message.model).toBe("gemma");
    expect(message.versionIndex).toBe(2);
    expect(versionsOf(message).map((v) => [v.content, v.model])).toEqual([
      ["A", "qwen3"],
      ["B", "claude"],
      ["C", "gemma"],
    ]);
  });

  it("switches to another version with its own model and keeps the order", () => {
    const first = selectVersion(threeVersions(), 0);
    expect(first.content).toBe("A");
    expect(first.model).toBe("qwen3");
    expect(first.versionIndex).toBe(0);
    expect(versionsOf(first).map((v) => v.content)).toEqual(["A", "B", "C"]);
  });

  it("doesn't carry the stats or searches of one version into another", () => {
    const withStats = { ...reply("A", "qwen3"), stats: { outputTokens: 10, durationMs: 1000 } };
    const regenerated = { ...nextVersion(withStats, placeholder("claude")), content: "B" };
    expect(regenerated.stats).toBeUndefined();
    expect(selectVersion(regenerated, 0).stats).toEqual({ outputTokens: 10, durationMs: 1000 });
  });

  it("goes back to the latest version when a regeneration produced nothing", () => {
    const failed = nextVersion(threeVersions(), placeholder("phi"));
    const restored = withoutEmptyVersion(failed);
    expect(restored?.content).toBe("C");
    expect(versionsOf(restored as Message)).toHaveLength(3);
  });

  it("drops a first reply that produced nothing", () => {
    expect(withoutEmptyVersion(placeholder("qwen3"))).toBeNull();
  });

  it("ignores an index out of range", () => {
    const message = threeVersions();
    expect(selectVersion(message, 7)).toBe(message);
  });
});

it("keeps the skills each version used", () => {
  const first: Message = { role: "assistant", content: "Resumen", model: "qwen", skillsUsed: ["summarize"] };
  const regenerated = nextVersion(first, { role: "assistant", content: "", model: "claude" });
  expect(regenerated.skillsUsed).toBeUndefined();
  expect(selectVersion({ ...regenerated, content: "Otra" }, 0).skillsUsed).toEqual(["summarize"]);
});

it("keeps the memories each version saved", () => {
  const first: Message = { role: "assistant", content: "Anotado", memoriesSaved: [{ id: "m1", text: "Usa Tauri" }] };
  const regenerated = nextVersion(first, { role: "assistant", content: "" });
  expect(regenerated.memoriesSaved).toBeUndefined();
  expect(selectVersion({ ...regenerated, content: "Otra" }, 0).memoriesSaved).toEqual([{ id: "m1", text: "Usa Tauri" }]);
});
