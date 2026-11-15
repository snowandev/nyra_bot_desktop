import { decisionStore } from "@/shared/lib/decisions";

// Between a tool's card and the reply waiting on it: the reply asks, the card answers

type ToolDecision = "once" | "always" | "deny";

const decisions = decisionStore<ToolDecision>();

// Settles when the user decides, or as denied if the reply stops first
export const waitForToolDecision = (id: string, signal: AbortSignal) => decisions.wait(id, signal, "deny");

// False once the reply that asked stopped: its card no longer offers to decide
export const isAwaitingToolDecision = decisions.isWaiting;

export const decideTool = decisions.decide;

export const onToolDecisionsChange = decisions.subscribe;
