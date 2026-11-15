import type { Message, WebSearchRecord, WebSearchStep } from "@/shared/types";
import { domainOf } from "@/shared/lib/links";
import { shortened } from "@/shared/lib/format";
import { tagged } from "@/features/chat/reply/replyTags";
import { untilStopped } from "@/features/chat/reply/stopped";
import {
  MAX_SEARCHES,
  PAGES_PER_SEARCH,
  pageCharBudget,
  type ReadPage,
  resultsMessage,
  type SearchStepProgress,
  searchFailedMessage,
} from "./webSearchAgent";
import type { WebPage, WebSearchResult } from "./webSearchStorage";

type Options = {
  search: (query: string) => Promise<WebSearchResult[]>;
  read: (url: string) => Promise<WebPage>;
  contextWindow: number | undefined;
  signal: AbortSignal;
  canSearch: boolean;
  onProgress: (steps: SearchStepProgress[]) => void;
};

// The web searches of one reply: up to MAX_SEARCHES, each page read once and its sources numbered across searches
export function webSearchRunner({ search, read, contextWindow, signal, canSearch, onProgress }: Options) {
  const steps: WebSearchStep[] = [];
  const progress: SearchStepProgress[] = [];
  const usedUrls = new Set<string>();
  let failed = false;
  let nextNumber = 1;
  const show = () => onProgress(progress.map((step) => ({ ...step, pages: [...step.pages] })));
  const searchesLeft = () => (canSearch && !failed ? MAX_SEARCHES - steps.length : 0);

  return {
    searchesLeft,
    hasSearched: () => steps.length > 0,
    // Something to keep with the reply: the searches made, or that searching failed
    hasRecord: () => steps.length > 0 || failed,
    record: (): WebSearchRecord => ({ steps: [...steps], ...(failed && { failed }) }),

    // The turns it adds: the model's request and its results, or that nothing was found
    async run(query: string): Promise<Message[]> {
      const step: SearchStepProgress = { query, phase: "searching", pages: [] };
      progress.push(step);
      show();
      // No source answered: the model is told nothing was found and answers from what it knows
      const results = await untilStopped(
        search(query).catch((): WebSearchResult[] => []),
        signal,
      );
      const chosen = results.filter((r) => !usedUrls.has(r.url)).slice(0, PAGES_PER_SEARCH);
      const asked: Message = { role: "assistant", content: tagged("search", query) };
      if (chosen.length === 0) {
        failed = true;
        progress.pop();
        show();
        return [asked, searchFailedMessage(query)];
      }

      step.phase = "reading";
      step.engine = chosen[0].source;
      step.pages = chosen.map((r) => ({ domain: domainOf(r.url), state: "pending" }));
      show();
      const budget = pageCharBudget(contextWindow, chosen.length);
      const pages: ReadPage[] = await untilStopped(
        Promise.all(
        chosen.map(async (result, i) => {
          usedUrls.add(result.url);
          step.pages[i] = { ...step.pages[i], state: "reading" };
          show();
          // A page that can't be read still counts with what the search said about it
          const page = await read(result.url).catch(() => null);
          step.pages[i] = { ...step.pages[i], state: "done" };
          show();
          const text = page?.text.trim() ? page.text : result.snippet;
          return { n: nextNumber + i, title: page?.title || result.title, url: result.url, text: shortened(text, budget) };
        }),
        ),
        signal,
      );
      nextNumber += pages.length;
      const done: WebSearchStep = {
        query,
        engine: step.engine,
        sources: pages.map(({ n, title, url }) => ({ n, title, url })),
      };
      steps.push(done);
      step.phase = "done";
      show();
      return [asked, resultsMessage(done, pages, searchesLeft())];
    },
  };
}
