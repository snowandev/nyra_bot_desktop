// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EmbeddingStatus } from "./EmbeddingStatus";

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

describe("EmbeddingStatus", () => {
  function renderStatus(isChosen: boolean, isOnlyOne: boolean) {
    act(() => {
      root.render(<EmbeddingStatus inUse="busca-mini" isChosen={isChosen} isOnlyOne={isOnlyOne} onLetNyraChoose={() => {}} />);
    });
    return container.textContent ?? "";
  }

  it("says which model searches and why", () => {
    expect(renderStatus(true, false)).toContain("Lo elegiste tú.");
    expect(container.querySelector("button")?.textContent).toBe("Que elija Nyra");
    expect(renderStatus(false, true)).toContain("Es el único que tienes");
    expect(renderStatus(false, false)).toContain("No has marcado ninguno");
  });
});
