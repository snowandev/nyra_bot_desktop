import type { BrowserOutcome } from "@/shared/types";
import { shortened } from "@/shared/lib/format";
import type { PageElement, PageState } from "./browserStorage";
import { placeOf } from "./browserSteps";

// What an action really did, measured by the app on the page before and after it, not taken from the model's word:
// the address, text that appeared or went, elements added or gone, what a field holds. Told by these facts only, so it
// works on any site and in any language.

type PageChange = {
  navigated: boolean;
  retitled: boolean;
  textAdded: string[];
  textRemoved: number;
  elementsAdded: PageElement[];
  elementsRemoved: number;
  // A field typed in: whether it holds the text now (a password, whether it was filled); null when it can't be read
  typed: { element: PageElement | null; holds: boolean | null } | null;
};

const MAX_LINES_SHOWN = 3;
const MAX_ELEMENTS_SHOWN = 6;
const MAX_LINE_CHARS = 100;

const linesOf = (text: string) =>
  new Set(
    text
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean),
  );

// Values are read cut short and with their spaces joined, so the typed text is compared the same way
const comparable = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 80);

function holdsTyped(element: PageElement, typed: string) {
  if (element.kind === "input:password") return element.filled ?? null;
  // An editable area that isn't a field has no value to read; the text that appeared tells instead
  if (!element.kind.startsWith("input") && element.kind !== "textarea") return null;
  return comparable(element.value) === comparable(typed);
}

export function pageChange(before: PageState | null, after: PageState, typed?: { n: number; text: string }): PageChange {
  const beforeLines = linesOf(before?.text ?? "");
  const afterLines = linesOf(after.text);
  const beforeNumbers = new Set(before?.elements.map((e) => e.n) ?? []);
  const afterNumbers = new Set(after.elements.map((e) => e.n));
  const element = typed ? (after.elements.find((e) => e.n === typed.n) ?? null) : null;
  return {
    // Without a page before, the browser just went to this one
    navigated: !before || before.url !== after.url,
    retitled: !!before && before.title !== after.title,
    textAdded: [...afterLines].filter((line) => !beforeLines.has(line)),
    textRemoved: [...beforeLines].filter((line) => !afterLines.has(line)).length,
    elementsAdded: after.elements.filter((e) => !beforeNumbers.has(e.n)),
    elementsRemoved: [...beforeNumbers].filter((n) => !afterNumbers.has(n)).length,
    typed: typed ? { element, holds: element ? holdsTyped(element, typed.text) : false } : null,
  };
}

// Nothing the user could see moved: the action had no effect, or its effect hasn't arrived yet
export const isUnchanged = (change: PageChange) =>
  !change.navigated &&
  !change.retitled &&
  change.textAdded.length === 0 &&
  change.textRemoved === 0 &&
  change.elementsAdded.length === 0 &&
  change.elementsRemoved === 0 &&
  change.typed?.holds !== true;

const quoted = (text: string) => `"${shortened(text, MAX_LINE_CHARS)}"`;

// For the model, in English like the rest of its instructions; the page's own words go in quotes
export function changeReport(change: PageChange, after: PageState) {
  const lines: string[] = [];
  if (change.typed) {
    const { element, holds } = change.typed;
    if (!element) lines.push("The field is no longer on the page: the text may not have been written.");
    else if (holds === true) lines.push(`Field [${element.n}] now holds what you wrote.`);
    else if (holds === false) {
      lines.push(
        element.kind === "input:password"
          ? `Field [${element.n}] is still empty: nothing was written.`
          : `Field [${element.n}] doesn't hold what you wrote: it holds ${quoted(element.value)}.`,
      );
    }
  }
  if (change.navigated) lines.push(`The page changed to ${after.url}.`);
  else if (change.retitled) lines.push(`The page's title changed to ${quoted(after.title)}.`);
  if (change.textAdded.length > 0) {
    const shown = change.textAdded.slice(0, MAX_LINES_SHOWN).map(quoted).join(", ");
    const more = change.textAdded.length > MAX_LINES_SHOWN ? ` and ${change.textAdded.length - MAX_LINES_SHOWN} more` : "";
    lines.push(`New text: ${shown}${more}.`);
  }
  if (change.textRemoved > 0) lines.push(`${change.textRemoved} line(s) of text went away.`);
  if (change.elementsAdded.length > 0) {
    const shown = change.elementsAdded
      .slice(0, MAX_ELEMENTS_SHOWN)
      .map((e) => `[${e.n}] ${quoted(e.label)}`)
      .join(", ");
    lines.push(`New elements: ${shown}.`);
  }
  if (change.elementsRemoved > 0) lines.push(`${change.elementsRemoved} element(s) went away.`);
  if (isUnchanged(change)) {
    lines.push("Nothing changed on the page: the action had no visible effect, so it didn't do what you meant.");
  }
  return lines.join("\n");
}

// For the browser's card, as keys of the catalog: what the user reads about the action
export function changeSummary(change: PageChange, after: PageState): BrowserOutcome {
  if (change.typed?.element && change.typed.holds === false) return { key: "notTyped", label: change.typed.element.label };
  if (change.navigated) return { key: "navigated", site: placeOf(after.url) };
  if (change.typed?.element && change.typed.holds === true) return { key: "typed", label: change.typed.element.label };
  return isUnchanged(change) ? { key: "unchanged" } : { key: "changed" };
}
