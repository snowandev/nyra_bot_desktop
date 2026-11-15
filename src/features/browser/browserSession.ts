import { useSyncExternalStore } from "react";
import { errorMessage } from "@/shared/lib/errors";
import { decisionStore } from "@/shared/lib/decisions";
import { browserClose, browserStart, onBrowserClosed, onBrowserPage } from "./browserStorage";

// What Nyra asks before going on: to open the browser, to act in one the user opened, or to reach an address of this
// computer or its network
export type AskKind = "open" | "use" | "local";
// What the chat shows of a conversation's browser, whose page is in its own window; there is one while it is open or
// waiting for permission
type BrowserView = {
  url: string;
  title: string;
  // What a reply is doing in it now, in the words the model used or the app's; its steps are on the reply's card
  action: string | null;
  // What the reply wants, and where, waiting for the user
  asking: { site: string; kind: AskKind } | null;
  // The user opened it from the menu: it stays while its window has no page yet
  opened: boolean;
  // The user is using it while a reply works in it: the reply waits until they give it back
  userControl: boolean;
  // It couldn't open
  error: string | null;
};

const views = new Map<string, BrowserView>();
const answers = decisionStore<boolean>();
// Conversations whose browser the user let Nyra use: it goes to any page of the web in it without asking, until it closes
const trusted = new Set<string>();
// And those where it may also reach this computer and its network (a project on localhost, the router)
const localAllowed = new Set<string>();
// How many times each conversation's browser ended, so a reply knows the user closed it while it worked
const closes = new Map<string, number>();
// Replies waiting for the user to give the browser back
const waiting = new Map<string, (() => void)[]>();
const listeners = new Set<() => void>();
let listening = false;

const EMPTY_VIEW: BrowserView = {
  url: "",
  title: "",
  action: null,
  asking: null,
  opened: false,
  userControl: false,
  error: null,
};

function update(conversationId: string, change: Partial<BrowserView>) {
  views.set(conversationId, { ...(views.get(conversationId) ?? EMPTY_VIEW), ...change });
  listeners.forEach((listener) => listener());
}

function ended(conversationId: string) {
  closes.set(conversationId, closeCount(conversationId) + 1);
  trusted.delete(conversationId);
  localAllowed.delete(conversationId);
  answers.decide(conversationId, false);
  release(conversationId);
  forget(conversationId);
}

function forget(conversationId: string) {
  if (!views.delete(conversationId)) return;
  listeners.forEach((listener) => listener());
}

function release(conversationId: string) {
  waiting.get(conversationId)?.forEach((resume) => resume());
  waiting.delete(conversationId);
}

// Where the page went, also by the user's own clicks
function pageChanged(conversationId: string, page: { url: string; title: string }) {
  if (!views.has(conversationId)) return;
  update(conversationId, { url: page.url === "about:blank" ? "" : page.url, title: page.title, error: null });
}

// The events start with the first panel that looks, and last as long as Nyra
function listen() {
  if (listening) return;
  listening = true;
  void onBrowserClosed(ended);
  void onBrowserPage(pageChanged);
}

const subscribe = (listener: () => void) => {
  listen();
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const viewOf = (conversationId: string) => views.get(conversationId) ?? null;

export function useBrowserView(conversationId: string) {
  const read = () => viewOf(conversationId);
  return useSyncExternalStore(subscribe, read, read);
}

export const showPage = (conversationId: string, page: { url: string; title: string }) =>
  update(conversationId, { url: page.url, title: page.title });

// From the globe, for the user: its window opens at once, or comes to the front. Nyra asks before acting in it: the
// user may have signed in to their own accounts there.
export async function openBrowser(conversationId: string) {
  update(conversationId, { opened: true, error: null });
  try {
    await browserStart(conversationId);
  } catch (e) {
    update(conversationId, { error: errorMessage(e) });
  }
}

// Without a page or a question, the panel only stays while something is in progress or the user opened it
export function setAction(conversationId: string, action: string | null) {
  const view = views.get(conversationId);
  if (!action && view && !view.url && !view.asking && !view.opened) forget(conversationId);
  else if (view || action) update(conversationId, { action });
}

// The user touched the page while a reply works in it: the reply waits for them
export function takeControl(conversationId: string) {
  const view = views.get(conversationId);
  if (view?.action && !view.userControl) update(conversationId, { userControl: true });
}

export function giveBack(conversationId: string) {
  if (views.get(conversationId)?.userControl) update(conversationId, { userControl: false });
  release(conversationId);
}

// Before each action of a reply: true when it had to wait, so the page may not be as it left it
export function waitForTurn(conversationId: string, signal: AbortSignal) {
  if (!views.get(conversationId)?.userControl || signal.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const resume = () => {
      signal.removeEventListener("abort", resume);
      resolve(true);
    };
    signal.addEventListener("abort", resume);
    waiting.set(conversationId, [...(waiting.get(conversationId) ?? []), resume]);
  });
}

// Where the conversation's browser is, while it is open
export const openAddress = (conversationId: string) => views.get(conversationId)?.url || null;

export const closeCount = (conversationId: string) => closes.get(conversationId) ?? 0;

export const isTrusted = (conversationId: string) => trusted.has(conversationId);

export const mayReachLocal = (conversationId: string) => localAllowed.has(conversationId);

// Asked once per kind: allowed, Nyra goes on without asking until the browser closes. Resolves once the user answers;
// false if the reply stops first. site: where Nyra wants to go, or the page it wants to act on.
export async function askToOpen(conversationId: string, site: string, kind: AskKind, signal: AbortSignal) {
  if (signal.aborted) return false;
  update(conversationId, { asking: { site, kind } });
  const allowed = await answers.wait(conversationId, signal, false);
  if (allowed) trusted.add(conversationId);
  if (allowed && kind === "local") localAllowed.add(conversationId);
  // Nothing was opened yet: a refused first site leaves no panel behind
  const view = views.get(conversationId);
  if (!allowed && !view?.url && !view?.opened) forget(conversationId);
  else update(conversationId, { asking: null });
  return allowed;
}

export const answerAsk = answers.decide;

export async function closeBrowser(conversationId: string) {
  ended(conversationId);
  await browserClose(conversationId);
}
