import { useEffect, useState } from "react";
import { errorMessage } from "@/shared/lib/errors";
import { type SearchHit, searchConversations } from "./conversationStorage";

// Waits for a short pause in typing, so every keystroke doesn't run a query
const TYPING_PAUSE_MS = 150;

type SearchState = {
  query: string;
  hits: SearchHit[];
  error: string | null;
};

const EMPTY: SearchState = { query: "", hits: [], error: null };

// Searches inside every saved conversation (messages and attached files) while the user types
export function useConversationSearch(query: string) {
  const trimmed = query.trim();
  const [state, setState] = useState<SearchState>(EMPTY);

  useEffect(() => {
    if (!trimmed) return;
    // A slower, older query must not replace the results of a newer one
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchConversations(trimmed)
        .then((hits) => {
          if (!cancelled) setState({ query: trimmed, hits, error: null });
        })
        .catch((e) => {
          if (!cancelled) setState({ query: trimmed, hits: [], error: errorMessage(e) });
        });
    }, TYPING_PAUSE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmed]);

  // Results of an earlier query stay visible while the new one runs, so the list doesn't flicker
  const current = trimmed ? state : EMPTY;
  return { ...current, isSearching: !!trimmed && state.query !== trimmed };
}
