// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useShortcut } from "@/shared/hooks/useShortcut";
import { SHORTCUTS } from "@/shared/lib/shortcuts";
import { loadSidebarFolded } from "@/shared/storage/settings";
import { useSidebarFold } from "./useSidebarFold";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The list listens for its own search shortcut, as SidebarBody does
function List({ onSearch }: { onSearch: () => void }) {
  useShortcut(SHORTCUTS.searchAll, onSearch);
  return <aside className="sidebar" />;
}

function Layout({ onSearch }: { onSearch: () => void }) {
  const sidebar = useSidebarFold(true, true);
  return sidebar.isFolded ? (
    <nav className="sidebar-rail">
      <button type="button" className="sidebar-unfold" onClick={sidebar.unfold}>show</button>
    </nav>
  ) : (
    <>
      <List onSearch={onSearch} />
      <button type="button" className="sidebar-fold" onClick={sidebar.fold}>hide</button>
    </>
  );
}

// ⌘ on macOS and Ctrl elsewhere: happy-dom says it isn't a Mac
const press = (key: string, withShift = false) =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, shiftKey: withShift, bubbles: true }));
  });

let root: Root;
let container: HTMLElement;
const onSearch = vi.fn();

beforeEach(() => {
  localStorage.clear();
  onSearch.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Layout onSearch={onSearch} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("folding a sidebar", () => {
  it("folds and unfolds from its buttons, and remembers it", () => {
    act(() => container.querySelector<HTMLButtonElement>(".sidebar-fold")?.click());
    expect(container.querySelector(".sidebar-rail")).not.toBeNull();
    expect(loadSidebarFolded()).toBe(true);
    act(() => container.querySelector<HTMLButtonElement>(".sidebar-unfold")?.click());
    expect(container.querySelector(".sidebar")).not.toBeNull();
    expect(loadSidebarFolded()).toBe(false);
  });

  it("switches with its shortcut", () => {
    press("b");
    expect(container.querySelector(".sidebar-rail")).not.toBeNull();
    press("b");
    expect(container.querySelector(".sidebar")).not.toBeNull();
  });

  it("comes back for the list's own shortcuts, which then work as usual", async () => {
    press("b");
    press("f", true);
    expect(container.querySelector(".sidebar")).not.toBeNull();
    await vi.waitFor(() => expect(onSearch).toHaveBeenCalledTimes(1));
  });
});
