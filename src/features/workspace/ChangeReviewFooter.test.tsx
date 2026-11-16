// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { i18n } from "@/shared/i18n/i18n";
import type { ProposedChange } from "@/shared/types";
import { ChangeReviewFooter } from "./ChangeReviewFooter";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const change = (fields: Partial<ProposedChange>): ProposedChange => ({
  id: "c1",
  root: "/proyecto",
  path: "notas.md",
  kind: "edit",
  blocks: [],
  status: "pending",
  ...fields,
});

function render(shown: ProposedChange, copyNote?: string) {
  act(() =>
    root.render(
      <ChangeReviewFooter
        change={shown}
        isBusy={false}
        isReadyToApply
        onAction={() => {}}
        appliedNote="aplicado"
        pendingNote="pendiente"
        applyLabel="Aplicar"
        retryLabel="Rehacer"
        copyNote={copyNote}
      />,
    ),
  );
  return [...container.querySelectorAll("button")].map((b) => b.textContent ?? "");
}

const undo = () => i18n.t("changes.action.undo");
const convert = () => i18n.t("changes.action.convert");

describe("ChangeReviewFooter", () => {
  it("offers to undo only what Nyra applied, never what Claude Code did", () => {
    const applied = change({ status: "applied", applied: { backup: "copia", modified: 1 } });
    expect(render(applied)).toContain(undo());
    const byClaudeCode = change({ status: "applied", importedFrom: "claudeCode" });
    expect(render(byClaudeCode)).toEqual([]);
    expect(container.textContent).toContain(i18n.t("changes.review.appliedByClaudeCode"));
  });

  it("offers a copy of a read-only file only where the review can make one (cells)", () => {
    const readOnly = change({ status: "protected", reason: "readOnly" });
    expect(render(readOnly, "copia")).toContain(convert());
    expect(render(readOnly)).toEqual([]);
  });

  it("asks before applying, with each review's own words", () => {
    expect(render(change({}))).toEqual([i18n.t("changes.action.discard"), expect.stringContaining("Aplicar")]);
    expect(container.textContent).toContain("pendiente");
  });
});
