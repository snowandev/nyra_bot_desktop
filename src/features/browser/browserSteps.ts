import type { BrowserOutcome, BrowserStep } from "@/shared/types";

// How a step went, as its card colors it: done, done without effect, or failed
export type StepTone = "ok" | "noEffect" | "failed";

export function toneOf(outcome: BrowserOutcome): StepTone {
  switch (outcome.key) {
    case "notTyped":
    case "unchanged":
    case "refused":
    case "markMissing":
    case "markHidden":
      return "noEffect";
    case "found":
      return outcome.count > 0 ? "ok" : "noEffect";
    case "failed":
      return "failed";
    default:
      return "ok";
  }
}

// How many steps went each way, for the line a finished card folds into
export function countsOf(steps: BrowserStep[]): Record<StepTone, number> {
  const counts: Record<StepTone, number> = { ok: 0, noEffect: 0, failed: 0 };
  for (const step of steps) if (step.outcome) counts[toneOf(step.outcome)]++;
  return counts;
}

// The reply stopped where a step failed: its card stays open on that step
export const endedInFailure = (steps: BrowserStep[]) => steps.at(-1)?.outcome?.key === "failed";

// The site and the page in it, short: "localhost:3000/panel"
export function placeOf(url: string) {
  try {
    const { host, pathname } = new URL(url);
    return host ? host + pathname.replace(/\/$/, "") : url;
  } catch {
    return url;
  }
}
