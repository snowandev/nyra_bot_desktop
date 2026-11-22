import { describe, expect, it } from "vitest";
import { webSearchRunner } from "./webSearchRunner";
import type { WebSearchResult } from "./webSearchStorage";

const result = (url: string): WebSearchResult => ({ url, title: url, snippet: "…", source: "duckduckgo" });

function runner(found: WebSearchResult[]) {
  return webSearchRunner({
    search: async () => found,
    read: async (url) => ({ url, title: url, text: "Texto de la página", truncated: false }),
    contextWindow: 32_000,
    signal: new AbortController().signal,
    canSearch: true,
    onProgress: () => {},
  });
}

describe("webSearchRunner", () => {
  it("doesn't take a search that only found pages already read for a failed one", async () => {
    const search = runner([result("https://ejemplo.org/a")]);
    await search.run("precio del cobre");
    const left = search.searchesLeft();
    const [, answer] = await search.run("cobre precio hoy");
    expect(answer.content).toContain("only found pages you already read");
    expect(search.record().failed).toBeUndefined();
    expect(search.searchesLeft()).toBe(left - 1);
  });

  it("says a search failed when it found nothing", async () => {
    const search = runner([]);
    const [, answer] = await search.run("algo");
    expect(answer.content).toContain("failed");
    expect(search.record().failed).toBe(true);
    expect(search.searchesLeft()).toBe(0);
  });
});
