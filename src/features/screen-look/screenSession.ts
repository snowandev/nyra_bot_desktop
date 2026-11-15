import { useSyncExternalStore } from "react";
import { decisionStore } from "@/shared/lib/decisions";
import { onScreenMarks } from "./screenStorage";

// What the chat shows of the user's screen, by conversation: Nyra asking to look at it or to use the mouse and keyboard,
// how many marks are on it, a guide going on, and Nyra acting. Allowed once, Nyra looks again in that conversation
// without asking, until Nyra closes; acting is allowed for one reply, the task.

// step: which one, from 1; task: what the user has to do now; waiting: Nyra is watching for it, rather than working
// out the next one
export type Guide = { step: number; task: string; waiting: boolean };
type ScreenState = { asking: "look" | "act" | null; marks: number; guide: Guide | null; acting: boolean };

// The user's word on a step: they did it (and the change wasn't seen), or the guide ends
export type GuideAnswer = "done" | "end";

const states = new Map<string, ScreenState>();
const answers = decisionStore<boolean>();
const guideAnswers = decisionStore<GuideAnswer>();
// Guides the user ended while Nyra wasn't waiting on a step: the next wait ends at once
const ended = new Set<string>();
// Tasks the user stopped from the strip: the next action doesn't happen
const stopped = new Set<string>();
const allowed = new Set<string>();
const listeners = new Set<() => void>();
// The conversation whose marks are on the screen: there is one marks window for all of them
let marked: string | null = null;
let listening = false;

function update(conversationId: string, change: Partial<ScreenState>) {
  const next: ScreenState = { asking: null, marks: 0, guide: null, acting: false, ...states.get(conversationId), ...change };
  if (!next.asking && next.marks === 0 && !next.guide && !next.acting) states.delete(conversationId);
  else states.set(conversationId, next);
  listeners.forEach((listener) => listener());
}

export const isAllowed = (conversationId: string) => allowed.has(conversationId);

// Resolves once the user answers on the strip above the composer; false if the reply stops first
// Using the mouse and keyboard also lets Nyra look, which it needs for it
export async function askToLook(conversationId: string, signal: AbortSignal, to: "look" | "act" = "look") {
  if (signal.aborted) return false;
  update(conversationId, { asking: to });
  const yes = await answers.wait(conversationId, signal, false);
  if (yes) allowed.add(conversationId);
  update(conversationId, { asking: null });
  return yes;
}

// While Nyra uses the mouse and keyboard, the strip says so and can stop it
export function showActing(conversationId: string, acting: boolean) {
  if (!acting) stopped.delete(conversationId);
  update(conversationId, { acting });
}

export function stopActing(conversationId: string) {
  stopped.add(conversationId);
  update(conversationId, { acting: false });
}

// Whether the user stopped the task from the strip
export const actingStopped = (conversationId: string) => stopped.has(conversationId);

export const answerLook = answers.decide;

// The guide's state as the strip shows it; null once the reply that guides ends
export function showGuide(conversationId: string, guide: Guide | null) {
  if (!guide) ended.delete(conversationId);
  update(conversationId, { guide });
}

// Whether the user ended the guide while Nyra wasn't waiting on a step; asked once, before the next wait
export const endedMeanwhile = (conversationId: string) => ended.delete(conversationId);

// Resolves when the user says they did the step or ends the guide
export const waitForGuide = (conversationId: string, signal: AbortSignal) =>
  guideAnswers.wait(conversationId, signal, "end");

export function answerGuide(conversationId: string, answer: GuideAnswer) {
  if (guideAnswers.isWaiting(conversationId)) guideAnswers.decide(conversationId, answer);
  else if (answer === "end") ended.add(conversationId);
}

// The marks of one conversation are on the screen now; those of another went away with them
export function showMarks(conversationId: string, count: number) {
  if (marked && marked !== conversationId) update(marked, { marks: 0 });
  marked = count > 0 ? conversationId : null;
  update(conversationId, { marks: count });
}

const subscribe = (listener: () => void) => {
  // The user closes marks from the screen itself, by their notes
  if (!listening) {
    listening = true;
    void onScreenMarks((marks) => marked && update(marked, { marks: marks.length })).catch(() => {
      listening = false;
    });
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useScreenState(conversationId: string) {
  const read = () => states.get(conversationId) ?? null;
  return useSyncExternalStore(subscribe, read, read);
}
