import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// The browser Nyra controls runs in Rust: the user's own Chrome, Edge or another Chromium browser, in a window of its
// own beside Nyra, one per conversation

// filled: only a password field says it, whether it holds something; its value is never read
export type PageElement = { n: number; kind: string; label: string; value: string; filled?: boolean };
export type PageState = { url: string; title: string; text: string; elements: PageElement[] };

// The name of the browser it would use, or null when none is installed
export const browserAvailable = () => invoke<string | null>("browser_available");

export const browserOpen = (conversationId: string, url: string) =>
  invoke<PageState>("browser_open", { conversationId, url });
// Opens it on an empty page, for the user, and brings its window to the front
export const browserStart = (conversationId: string) => invoke<void>("browser_start", { conversationId });
// Whether the address is on this computer or its network, by where its name points
export const browserIsLocal = (url: string) => invoke<boolean>("browser_is_local", { url });
// Its window in front of the others
export const browserShow = (conversationId: string) => invoke<void>("browser_show", { conversationId });
export const browserClick = (conversationId: string, n: number) =>
  invoke<PageState>("browser_click", { conversationId, n });
export const browserType = (conversationId: string, n: number, text: string) =>
  invoke<PageState>("browser_type", { conversationId, n, text });
export const browserKey = (conversationId: string, key: string) =>
  invoke<PageState>("browser_key", { conversationId, key });
// A PNG, base64; scale is how many pixels per point of the page
export const browserScreenshot = (conversationId: string, scale: number) =>
  invoke<string>("browser_screenshot", { conversationId, scale });
// A small JPEG of the window, base64, for the card that follows a reply's steps
export const browserThumbnail = (conversationId: string) => invoke<string>("browser_thumbnail", { conversationId });
export const browserClose = (conversationId: string) => invoke<void>("browser_close", { conversationId });
export const browserSnapshot = (conversationId: string) => invoke<PageState>("browser_snapshot", { conversationId });
// Where a text is on the whole page: how many times, a few passages around it, and the fields (by number) that hold it
type FoundText = { count: number; passages: string[]; fields: number[] };
export const browserFind = (conversationId: string, text: string) =>
  invoke<FoundText>("browser_find", { conversationId, text });
// What a mark points at: a numbered element, or a text as the page shows it
export type MarkTarget = { n: number } | { text: string };
// fresh: the first mark of a reply, which takes the earlier ones away
// color: the user's accent, as #rrggbb
type MarkRequest =
  | { from: MarkTarget; to?: MarkTarget; note: string; fresh: boolean; color?: string }
  | { clear: true };
// number: the mark's on the page; count: how many times its text shows; visible: whether the user sees it now, or it
// waits hidden (a carousel, a closed menu); missing: which end wasn't found
type MarkOutcome = {
  found: boolean;
  visible: boolean;
  number: number | null;
  count: number | null;
  missing: "from" | "to" | null;
};
export const browserMark = (conversationId: string, request: MarkRequest) =>
  invoke<MarkOutcome>("browser_mark", { conversationId, request });
// Where the page is and its title, after any change, also from the user's own clicks
export const onBrowserPage = (handler: (conversationId: string, page: { url: string; title: string }) => void) =>
  listen<{ conversationId: string; url?: string; title?: string }>("browser-page", ({ payload }) =>
    handler(payload.conversationId, { url: payload.url ?? "", title: payload.title ?? "" }),
  );

// The browser ended: closed by the user, or it quit on its own
export const onBrowserClosed = (handler: (conversationId: string) => void) =>
  listen<{ conversationId: string }>("browser-closed", (event) => handler(event.payload.conversationId));
