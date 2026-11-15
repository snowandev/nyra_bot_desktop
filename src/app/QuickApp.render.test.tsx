// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What Rust is asked, and what it answers: one installed skill, and nothing else yet
const calls: { command: string; args: unknown }[] = [];
const SKILL = { name: "summarize", description: "Condenses a text.", body: "", files: [], metadata: {}, source: "nyra" };
const answerFor = (command: string) => {
  if (command === "list_skills") return { skills: [SKILL], installError: null };
  if (command === "saved_api_keys") return [];
  if (command === "secret_store") return "keychain";
  return command.startsWith("list_") ? [] : null;
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: unknown) => {
    calls.push({ command, args });
    return Promise.resolve(answerFor(command));
  },
  Channel: class {
    onmessage: unknown = null;
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
  emit: () => Promise.resolve(),
  emitTo: () => Promise.resolve(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setTheme: () => Promise.resolve(), isFocused: () => Promise.resolve(true) }),
}));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: () => Promise.reject(new Error("sin red en los tests")) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The bar measures itself to grow the window
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { default: QuickApp } = await import("./QuickApp");

let root: Root;
let container: HTMLElement;

beforeEach(async () => {
  calls.length = 0;
  localStorage.clear();
  const model = { id: "qwen", name: "qwen", description: "", providerId: "ollama" };
  localStorage.setItem("nyrabot.models", JSON.stringify([model]));
  localStorage.setItem("nyrabot.selectedModel", JSON.stringify("qwen"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<QuickApp />));
  await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const box = () => container.querySelector<HTMLTextAreaElement>("#quick-input")!;

function type(text: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(box(), text);
    box().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the quick bar", () => {
  it("offers skills and commands with /, and Enter chooses the skill for the message", () => {
    type("/");
    const options = [...container.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(options.some((o) => o?.startsWith("new"))).toBe(true);
    expect(options.some((o) => o?.startsWith("summarize"))).toBe(true);

    type("/su");
    act(() => {
      box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(container.querySelector(".quick-skill .invoked-skill")?.textContent).toContain("summarize");
    expect(box().value).toBe("");
  });

  it("tells Rust when it is pinned, so clicking another app doesn't hide it", () => {
    const pin = container.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!;
    act(() => pin.click());
    expect(pin.getAttribute("aria-pressed")).toBe("true");
    expect(calls).toContainEqual({ command: "set_quick_pinned", args: { pinned: true } });
  });
});
