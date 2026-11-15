// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InstalledModel } from "@/providers/ollamaModels";
import { EmbeddingStatus } from "./EmbeddingStatus";
import { InstalledModelRow } from "./InstalledModelRow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const embedding: InstalledModel = { name: "busca-mini", size: 6.39e8, isEmbedding: true };

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

function renderRow(isDefault: boolean, isInUse: boolean) {
  act(() => {
    root.render(
      <ul>
        <InstalledModelRow
          model={embedding}
          loaded={undefined}
          isDefault={isDefault}
          isInUse={isInUse}
          isNew={false}
          isUnloading={false}
          onToggleDefault={() => {}}
          onUnload={() => {}}
          onDelete={() => {}}
        />
      </ul>,
    );
  });
  return {
    toggle: container.querySelector<HTMLButtonElement>(".search-toggle"),
    pill: container.querySelector(".model-pill.embedding")?.textContent ?? null,
  };
}

describe("an embedding model's row", () => {
  it("has the search control instead of the chat star, in each of its three states", () => {
    const marked = renderRow(true, false);
    expect(container.querySelector(".default-star")).toBeNull();
    expect(marked.toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(marked.pill).toBe("Para buscar");

    const picked = renderRow(false, true);
    expect(picked.toggle?.getAttribute("aria-pressed")).toBe("false");
    expect(picked.toggle?.classList.contains("auto")).toBe(true);
    expect(picked.toggle?.getAttribute("aria-label")).toContain("porque no has marcado ninguno");
    expect(picked.pill).toBe("Para buscar · elegido por Nyra");

    const unused = renderRow(false, false);
    expect(unused.toggle?.getAttribute("aria-label")).toBe("Usar busca-mini para buscar en carpetas");
    expect(unused.pill).toBeNull();
  });
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
