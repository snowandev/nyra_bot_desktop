import { describe, expect, it } from "vitest";
import type { PageElement, PageState } from "./browserStorage";
import { changeReport, changeSummary, isUnchanged, pageChange } from "./pageChange";

const field = (value = ""): PageElement => ({ n: 4, kind: "input:text", label: "Search", value });
const searchButton: PageElement = { n: 5, kind: "button", label: "Search", value: "" };
const page = (elements: PageElement[], extra: Partial<PageState> = {}): PageState => ({
  url: "https://www.youtube.com/",
  title: "YouTube",
  text: "Try searching to get started",
  elements,
  ...extra,
});

describe("pageChange", () => {
  it("confirms what a field holds after typing, and names the elements that appeared", () => {
    const before = page([field(), searchButton]);
    const clear: PageElement = { n: 13, kind: "button", label: "Clear search query", value: "" };
    const after = page([field("Linkin Park"), clear, searchButton]);
    const change = pageChange(before, after, { n: 4, text: "Linkin Park" });
    expect(change.typed?.holds).toBe(true);
    expect(change.elementsAdded).toEqual([clear]);
    expect(isUnchanged(change)).toBe(false);
    const report = changeReport(change, after);
    expect(report).toContain("Field [4] now holds what you wrote.");
    expect(report).toContain('New elements: [13] "Clear search query".');
    expect(changeSummary(change, after)).toEqual({ key: "typed", label: "Search" });
  });

  it("says so when a field doesn't hold what was written", () => {
    const before = page([field(), searchButton]);
    const change = pageChange(before, page([field(), searchButton]), { n: 4, text: "Linkin Park" });
    expect(change.typed?.holds).toBe(false);
    expect(changeReport(change, before)).toContain("doesn't hold what you wrote");
    expect(changeSummary(change, before)).toEqual({ key: "notTyped", label: "Search" });
  });

  it("knows a password was filled without reading it", () => {
    const password = (filled: boolean): PageElement => ({ n: 2, kind: "input:password", label: "Clave", value: "", filled });
    expect(pageChange(page([password(false)]), page([password(true)]), { n: 2, text: "x" }).typed?.holds).toBe(true);
    const empty = pageChange(page([password(false)]), page([password(false)]), { n: 2, text: "x" });
    expect(changeReport(empty, page([]))).toContain("is still empty");
  });

  it("reports a new address and the text that came with it", () => {
    const before = page([field("Linkin Park"), searchButton]);
    const after = page([field("Linkin Park")], {
      url: "https://www.youtube.com/results?search_query=Linkin+Park",
      title: "Linkin Park - YouTube",
      text: "Linkin Park - Numb (Official Video)\nLinkin Park - In The End",
    });
    const change = pageChange(before, after);
    const report = changeReport(change, after);
    expect(report).toContain("The page changed to https://www.youtube.com/results?search_query=Linkin+Park.");
    expect(report).toContain('New text: "Linkin Park - Numb (Official Video)", "Linkin Park - In The End".');
    expect(changeSummary(change, after)).toEqual({ key: "navigated", site: "www.youtube.com/results" });
  });

  it("says nothing changed when nothing did", () => {
    const before = page([field(), searchButton]);
    const change = pageChange(before, page([field(), searchButton]));
    expect(isUnchanged(change)).toBe(true);
    expect(changeReport(change, before)).toContain("Nothing changed on the page");
    expect(changeSummary(change, before)).toEqual({ key: "unchanged" });
  });
});
