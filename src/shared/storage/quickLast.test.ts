// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { clearQuickLast, loadQuickLast, releaseFromQuick, saveQuickLast } from "./settings";

describe("releaseFromQuick", () => {
  beforeEach(() => clearQuickLast());

  it("forgets the quick bar's conversation once the main window takes it", () => {
    saveQuickLast({ conversationId: "c1", leftAt: 1000 });
    releaseFromQuick("c2");
    expect(loadQuickLast()).toEqual({ conversationId: "c1", leftAt: 1000 });
    releaseFromQuick("c1");
    expect(loadQuickLast()).toBeNull();
  });
});
