import { useRef, useState } from "react";
import { contextLimitOf, contextStateOf } from "./context";
import { loadLoadedContexts } from "@/shared/storage/settings";
import { errorMessage } from "@/shared/lib/errors";
import { i18n } from "@/shared/i18n/i18n";
import { completeText, configForModel } from "./modelRequest";
import {
  fitsInTokens,
  planSummary,
  SUMMARY_SYSTEM,
  shortenRequest,
  summaryRequest,
  trimToTokens,
} from "./summary";
import { getProvider } from "@/providers";
import type { Conversation, ConversationSummary, Model, ProviderConfig } from "@/shared/types";

// Without a word from the model for this long, the summary is given up; a local model reading a long history
// before its first word stays well within it
const SUMMARY_IDLE_MS = 180_000;

type SummarizerSettings = {
  configFor: (providerId: string) => ProviderConfig;
  // Tokens every request carries besides the history (the user's rules); the summary leaves room for them
  reservedTokens: number;
  updateConversation: (id: string, update: (conversation: Conversation) => Conversation) => void;
};

// Replaces the older part of a conversation with a summary, so it keeps fitting in the model's context
export function useSummarizer({ configFor, reservedTokens, updateConversation }: SummarizerSettings) {
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [error, setError] = useState<{ conversationId: string; message: string } | null>(null);
  // "Reintentar" repeats the summary that failed, also one asked for with /compact
  const lastByHand = useRef(false);
  const running = useRef<AbortController | null>(null);

  // Stopping it leaves the history as it was: the summary only replaces it once complete
  async function summarize(conversation: Conversation, model: Model, byHand = false) {
    lastByHand.current = byHand;
    const provider = getProvider(model.providerId);
    const { id, messages, summary } = conversation;
    const limit = contextLimitOf(model, configFor(model.providerId), {
      loadsContext: !!provider?.loadsContextLength,
      loaded: loadLoadedContexts()[model.id],
    });
    // By hand, the context may not be measured yet; the limit then only sizes the summary
    const measured = contextStateOf(messages, limit)?.limit;
    const contextLimit = byHand ? (measured ?? limit?.limit ?? model.contextWindow) : measured;
    const plan = contextLimit ? planSummary(messages, summary, contextLimit, reservedTokens, byHand) : null;
    if (!provider || !plan) return;

    // The user's rules are left out on purpose: a style rule ("very short", "talk like a pirate") would distort
    // the summary, and replies get the rules anyway
    // Without reasoning: a summary doesn't need it, and a thinking model takes minutes before writing a word
    const config = { ...configForModel(configFor(provider.id), model), reasoning: false };
    const controller = new AbortController();
    running.current = controller;
    let stalled = false;
    let watchdog = 0;
    // A model that stops sending text would otherwise keep the chat locked
    const keepAlive = () => {
      window.clearTimeout(watchdog);
      watchdog = window.setTimeout(() => {
        stalled = true;
        controller.abort();
      }, SUMMARY_IDLE_MS);
    };
    const ask = (request: Conversation["messages"]) =>
      completeText(provider, config, model, request, {
        system: SUMMARY_SYSTEM,
        signal: controller.signal,
        onProgress: keepAlive,
      });

    setIsSummarizing(true);
    setError(null);
    keepAlive();
    try {
      let text = await ask(summaryRequest(messages, summary, plan));
      if (!text) throw new Error(i18n.t("reply.noSummary"));
      // Small models often ignore the word limit; one shortening pass usually fixes it
      if (!fitsInTokens(text, plan.maxTokens)) text = (await ask(shortenRequest(text, plan.maxTokens))) || text;

      const nextSummary: ConversationSummary = { text: trimToTokens(text, plan.maxTokens), fromIndex: plan.cut };
      // The stored usage measured the context before summarizing; the next reply measures it again
      updateConversation(id, (c) => ({
        ...c,
        summary: nextSummary,
        messages: c.messages.map((m) => ({ ...m, usage: undefined })),
      }));
    } catch (e) {
      if (stalled) setError({ conversationId: id, message: i18n.t("reply.summaryStalled") });
      else if (!controller.signal.aborted) setError({ conversationId: id, message: errorMessage(e) });
    } finally {
      window.clearTimeout(watchdog);
      running.current = null;
      setIsSummarizing(false);
    }
  }

  const retry = (conversation: Conversation, model: Model) => summarize(conversation, model, lastByHand.current);

  // Shown only in the conversation whose summary failed
  const errorOf = (conversationId: string | null) => (error?.conversationId === conversationId ? error.message : null);
  const clearError = (conversationId: string) =>
    setError((current) => (current?.conversationId === conversationId ? null : current));

  return { isSummarizing, errorOf, clearError, summarize, retry, cancel: () => running.current?.abort() };
}
