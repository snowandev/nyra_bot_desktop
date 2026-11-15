import { invoke } from "@tauri-apps/api/core";

// Searching and reading pages happen on the Rust side (web.rs): DuckDuckGo with Wikipedia as the fallback,
// and only public addresses are read

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  source: "duckduckgo" | "wikipedia";
};

export type WebPage = {
  // Where the page really is, after redirects
  url: string;
  title: string;
  text: string;
  truncated: boolean;
};

// Rejects with a message for the user when no source answered
export const webSearch = (query: string) => invoke<WebSearchResult[]>("web_search", { query });

export const fetchPage = (url: string) => invoke<WebPage>("fetch_page", { url });
