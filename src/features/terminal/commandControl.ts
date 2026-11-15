import { useSyncExternalStore } from "react";
import { decisionStore } from "@/shared/lib/decisions";
import { stopCommand, writeCommandInput } from "./terminalStorage";

// Between the cards and the reply that waits on them: the reply asks for a decision and the card gives it

// answer: what the user wrote instead of running it, for the model to answer
type CommandDecision = { run: true; command: string; edited: boolean } | { run: false; answer?: string };

const decisions = decisionStore<CommandDecision>();
const stopped = new Set<string>();
// The command each conversation waits on: what the user writes meanwhile answers Nyra instead of running it
const waitingIn = new Map<string, string>();

// Settles when the user runs or rejects the command, or answers instead; with a rejection if the reply stops first
export async function waitForDecision(id: string, conversationId: string, signal: AbortSignal) {
  waitingIn.set(conversationId, id);
  try {
    return await decisions.wait(id, signal, { run: false });
  } finally {
    if (waitingIn.get(conversationId) === id) waitingIn.delete(conversationId);
  }
}

// The user wrote to Nyra while a command waited: it isn't run, and the reply answers what they wrote. False when
// nothing waits.
export function answerInstead(conversationId: string, text: string) {
  const id = waitingIn.get(conversationId);
  if (!id) return false;
  decisions.decide(id, { run: false, answer: text });
  return true;
}

// Whether a command of the conversation waits for the user, so the composer can answer it
export function useAwaitingCommand(conversationId: string) {
  const read = () => waitingIn.has(conversationId);
  return useSyncExternalStore(decisions.subscribe, read, read);
}

// Whether a card can still ask for a decision: false once the reply that asked stopped
export const isAwaitingDecision = decisions.isWaiting;

export const onDecisionsChange = decisions.subscribe;

export const approveCommand = (id: string, command: string, edited: boolean) =>
  decisions.decide(id, { run: true, command, edited });

export const rejectCommand = (id: string) => decisions.decide(id, { run: false });

// Remembered so the end reads as stopped by the user rather than as a failure
export async function stopRunningCommand(id: string) {
  stopped.add(id);
  await stopCommand(id);
}

// Programs left running after their reply, by conversation: deleting it, or every conversation, ends them
const live = new Map<string, Set<string>>();

export function keepRunning(conversationId: string, id: string) {
  live.set(conversationId, new Set([...(live.get(conversationId) ?? []), id]));
}

export function ended(conversationId: string, id: string) {
  live.get(conversationId)?.delete(id);
}

export function stopProgramsOf(conversationId: string) {
  for (const id of live.get(conversationId) ?? []) void stopRunningCommand(id).catch(() => {});
  live.delete(conversationId);
}

export function stopAllPrograms() {
  for (const conversationId of [...live.keys()]) stopProgramsOf(conversationId);
}

// Read once when the command ends
export function wasStopped(id: string) {
  const was = stopped.has(id);
  stopped.delete(id);
  return was;
}

export const answerCommand = (id: string, text: string) => writeCommandInput(id, text);
