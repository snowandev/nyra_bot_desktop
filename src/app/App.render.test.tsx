// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What Rust answers on start, as for a new user; a test can change it before rendering
const answers = new Map<string, unknown>();
// Lists start empty; anything else isn't there yet
const NO_SKILLS = { skills: [], installError: null };
const answerFor = (command: string) => {
  if (answers.has(command)) return answers.get(command);
  if (command === "list_skills") return NO_SKILLS;
  return command.startsWith("list_") ? [] : null;
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string) => Promise.resolve(answerFor(command)),
  Channel: class {
    onmessage: unknown = null;
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: () => Promise.resolve(() => {}),
    setTheme: () => Promise.resolve(),
    listen: () => Promise.resolve(() => {}),
  }),
}));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: () => Promise.resolve("/Users/marta") }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("0.0.0") }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: () => Promise.reject(new Error("sin red en los tests")) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: () => Promise.resolve() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: () => Promise.resolve() }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: () => Promise.resolve(false),
  requestPermission: () => Promise.resolve("denied"),
  sendNotification: () => {},
}));

// Tells React these renders run in a test, so it waits for their effects inside act()
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: App } = await import("./App");

let root: Root;
let container: HTMLElement;
let errors: unknown[];

async function render() {
  await act(async () => {
    root.render(<App />);
  });
  // Lets the first reads from Rust arrive
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const button = (name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(name));

beforeEach(() => {
  answers.clear();
  answers.set("list_conversations", []);
  answers.set("list_folders", []);
  answers.set("list_projects", []);
  answers.set("projects_pending", []);
  answers.set("saved_api_keys", []);
  answers.set("secret_store", "keychain");
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args) => errors.push(args));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

// Catches what only shows when the app is drawn, such as a hook read outside its provider: the screen stays blank
describe("the app draws", () => {
  it("opens on the chat with its welcome screen", async () => {
    await render();
    expect(container.textContent).toContain("¿En qué te ayudo hoy?");
    expect(button("Código")).toBeDefined();
    expect(errors).toEqual([]);
  });

  it("goes to Código, with and without projects", async () => {
    await render();
    await act(async () => button("Código")?.click());
    expect(container.textContent).toContain("Programa con Nyra en tus carpetas");

    act(() => root.unmount());
    root = createRoot(container);
    answers.set("list_projects", [
      { id: "p1", name: "tienda", path: "/Users/marta/dev/tienda", model: null, disabledSkills: [] },
    ]);
    answers.set("project_status", { missing: false, git: { kind: "repo", branch: "main", ahead: 0 } });
    answers.set("project_git_changes", { files: [], total: 0 });
    await render();
    expect(container.textContent).toContain("tienda");
    expect(container.textContent).toContain("Conversaciones recientes");
    expect(errors).toEqual([]);
  });
});
