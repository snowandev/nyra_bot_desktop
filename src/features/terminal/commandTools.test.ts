// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandRun } from "@/shared/types";

// Every command is approved as it was asked, and ends when the test says so
const endings = new Map<string, (code: number) => void>();
const stopped: string[] = [];
let runs: CommandRun[] = [];
// Programs left running after their reply, and those of them that ended
const kept: string[] = [];
const endedLive: string[] = [];
// What a program left running wrote after its reply
const later: CommandRun[] = [];
// What the user writes instead of approving, when a test says so
let answering: string | null = null;
vi.mock("./commandControl", () => ({
  waitForDecision: async (id: string) =>
    answering
      ? { run: false, answer: answering }
      : {
          run: true,
          command: ((run) => run?.code?.source ?? run?.command ?? "")(runs.find((r) => r.id === id)),
          edited: false,
        },
  wasStopped: () => false,
  keepRunning: (conversationId: string, id: string) => kept.push(`${conversationId}:${id}`),
  ended: (conversationId: string, id: string) => endedLive.push(`${conversationId}:${id}`),
}));
vi.mock("./terminalStorage", () => ({
  runCommand: (id: string) => new Promise<number>((resolve) => endings.set(id, resolve)),
  stopCommand: async (id: string) => void stopped.push(id),
  commandInputHidden: async () => false,
}));

// The conversation's folder, where a program leaves a chart besides itself
const prepared: string[] = [];
// Saving a program waits for this when a test holds it
let saving: Promise<void> | null = null;
vi.mock("./codeStorage", () => ({
  codeSpace: async () => "/tmp/conversacion",
  prepareCode: async (_id: string, language: string, source: string) => {
    await saving;
    prepared.push(source);
    return `${language} "/tmp/conversacion/nyra-1.py"`;
  },
  codeFiles: async () => [
    { path: "grafico.png", size: 2048, modified: Date.now() },
    { path: "ventas.csv", size: 512, modified: Date.now() },
  ],
}));

const { commandTools, MAX_IN_BACKGROUND, settledRun, withCommandNotes } = await import("./commandTools");

const needs: [string, number][] = [];

const CODE = {
  conversationId: "c1",
  dir: "/tmp/conversacion",
  label: "conversación",
  languages: ["python" as const],
  packages: [],
  missingPackages: [],
  files: ["ventas.csv"],
  inputs: () => [{ name: "ventas.csv", data: "bWVzLGltcG9ydGU=" }],
};

function tools(options: Partial<Parameters<typeof commandTools>[0]> = {}) {
  return commandTools({
    onNeedsYou: (need, count) => needs.push([need, count]),
    conversationId: "c1",
    writeAfter: (run) => later.push(run),
    folder: { root: "/tmp/proyecto", name: "proyecto" },
    allowCommands: true,
    code: null,
    offset: () => 0,
    update: (change) => (runs = change(runs)),
    steps: { begin: () => 0, finish: () => {} },
    signal: new AbortController().signal,
    ...options,
  });
}

const end = (n: number, code = 0) => {
  const run = runs.find((r) => r.n === n);
  if (run) endings.get(run.id)?.(code);
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  runs = [];
  prepared.length = 0;
  stopped.length = 0;
  needs.length = 0;
  kept.length = 0;
  endedLive.length = 0;
  later.length = 0;
  answering = null;
  endings.clear();
});

describe("commands in the background", () => {
  it("says it started, goes on at once, and gives its result once, when it ends", async () => {
    const t = tools();
    const started = await t.run([{ command: "npm run build", background: true }]);
    expect(started.content).toContain('running-in-background="true"');
    expect(t.hasPending()).toBe(true);
    expect(t.takeFinished()).toBeNull();

    end(1);
    await tick();
    expect(t.takeFinished()?.content).toContain('exit-code="0"');
    expect(t.takeFinished()).toBeNull();
    expect(t.hasPending()).toBe(false);
  });

  it("waits for the one asked for", async () => {
    const t = tools();
    await t.run([{ command: "npm test", background: true }]);
    const waited = t.wait("1");
    end(1, 2);
    expect((await waited).content).toContain('exit-code="2"');
    expect((await t.wait("7")).content).toContain("There is no background command 7");
  });

  it(`runs at most ${MAX_IN_BACKGROUND} at once; the next one runs like any other`, async () => {
    const t = tools();
    const asked = Array.from({ length: MAX_IN_BACKGROUND + 1 }, (_, i) => ({ command: `build ${i}`, background: true }));
    const request = t.run(asked);
    await tick();
    expect(runs.filter((r) => r.background).length).toBe(MAX_IN_BACKGROUND);
    end(MAX_IN_BACKGROUND + 1);
    const results = await request;
    expect(results.content).toContain(`n="${MAX_IN_BACKGROUND + 1}"`);
    expect(results.content).toContain('exit-code="0"');
  });

  it("leaves one still running when the reply ends, as a server needs, and keeps its card up to date", async () => {
    const t = tools();
    await t.run([{ command: "python3 -m http.server", background: true }]);
    t.close();
    expect(stopped).toEqual([]);
    expect(runs[0]).toMatchObject({ detached: true, state: "running" });
    expect(kept).toEqual([`c1:${runs[0].id}`]);
    end(1);
    await tick();
    // Written in its own message, wherever it is by then
    expect(later.at(-1)).toMatchObject({ state: "done", exitCode: 0, detached: true });
    expect(endedLive).toEqual([`c1:${runs[0].id}`]);
  });

  it("stops one when the reply is stopped, and those that run in the foreground", async () => {
    const controller = new AbortController();
    const t = tools({ signal: controller.signal });
    await t.run([{ command: "npm run dev", background: true }]);
    controller.abort();
    t.close();
    expect(stopped).toContain(runs[0].id);
    expect(kept).toEqual([]);
  });
});

describe("telling the user", () => {
  it("says each command waits for approval, with how many are left in its request", async () => {
    const t = tools();
    const request = t.run([
      { command: "npm run lint", background: false },
      { command: "npm test", background: false },
    ]);
    await tick();
    end(1);
    await tick();
    end(2);
    await request;
    expect(needs).toEqual([
      ["approval", 2],
      ["approval", 1],
    ]);
  });
});

describe("the user answering instead of approving", () => {
  it("doesn't run it, keeps what they wrote on its card and gives it to the model to answer", async () => {
    answering = "¿Para qué sirve? No lo ejecutes, dime cómo hacerlo yo.";
    const result = await tools().run([
      { command: "rm -rf build", background: false },
      { command: "npm run build", background: false },
    ]);
    expect(endings.size).toBe(0);
    expect(runs.map((r) => r.state)).toEqual(["rejected", "queued"]);
    expect(runs[0].answer).toBe(answering);
    expect(result.content).toContain('not-run="the user wrote to you instead of running it"');
    expect(result.content).toContain(`<user-message>\n${answering}\n</user-message>`);
    // Later messages keep it too
    const [noted] = withCommandNotes([{ role: "assistant", content: "Listo.", commands: [runs[0]] }]);
    expect(noted.content).toContain(`the user wrote instead: "${answering}"`);
  });
});

describe("programs", () => {
  it("runs an approved program from the conversation's folder and lists what it created", async () => {
    const t = tools({ folder: null, allowCommands: false, code: CODE });
    const source = 'import csv\nprint("total")';
    const request = t.run([{ command: "", background: false, code: { language: "python", source } }]);
    await tick();
    await tick();
    expect(prepared).toEqual([source]);
    expect(runs[0]).toMatchObject({ root: "/tmp/conversacion", folder: "conversación", command: 'python "/tmp/conversacion/nyra-1.py"' });
    end(1);
    const result = await request;
    expect(result.content).toContain('program="python"');
    expect(result.content).toContain("grafico.png");
    expect(result.content).not.toContain("nyra-1.py");
    expect(runs[0].files).toEqual([{ path: "grafico.png", size: 2048 }]);
  });

  it("goes on at once with a program in the background, and gives its result when it ends", async () => {
    const t = tools({ folder: null, allowCommands: false, code: CODE });
    const started = await t.run([{ command: "", background: true, code: { language: "python", source: "print(1)" } }]);
    expect(started.content).toContain('running-in-background="true"');
    expect(t.hasPending()).toBe(true);
    end(1);
    await tick();
    await tick();
    expect(t.takeFinished()?.content).toContain('program="python"');
  });

  it("never waits on a language this computer can't run, nor on a command where only programs run", async () => {
    const t = tools({ folder: null, allowCommands: false, code: CODE });
    const result = await t.run([
      { command: "", background: false, code: { language: "ruby", source: "puts 1" } },
      { command: "ls", background: false },
    ]);
    expect(runs.map((r) => r.state)).toEqual(["failed", "failed"]);
    expect(needs).toEqual([]);
    expect(result.content).toContain('program="ruby"');
    expect(t.canRun()).toBe(false);
    expect(t.canRunCode()).toBe(true);
  });
});

describe("when the reply ends", () => {
  it("stops what still runs in the foreground and writes nothing more to the message", async () => {
    const t = tools();
    void t.run([{ command: "npm run build", background: false }]);
    await tick();
    const before = runs;
    t.close();
    end(1);
    await tick();
    expect(stopped).toEqual([runs[0].id]);
    expect(runs).toBe(before);
    expect(later).toEqual([]);
  });

  it("never starts a program the user approved if the reply stopped while it was being saved", async () => {
    const controller = new AbortController();
    const t = tools({ folder: null, allowCommands: false, code: CODE, signal: controller.signal });
    let saved = () => {};
    saving = new Promise((resolve) => (saved = resolve));
    const request = t.run([{ command: "", background: false, code: { language: "python", source: "print(1)" } }]);
    await tick();
    controller.abort();
    saved();
    await request;
    saving = null;
    expect(endings.size).toBe(0);
    expect(runs[0].state).toBe("rejected");
  });
});

describe("a program left running after its reply", () => {
  const server: CommandRun = {
    id: "cmd-1",
    command: "python3 -m http.server 8765",
    root: "/tmp/proyecto",
    folder: "proyecto",
    at: 0,
    n: 1,
    state: "running",
    background: true,
    detached: true,
    output: "Serving HTTP on :: port 8765\n",
  };
  const notesOf = (run: CommandRun) =>
    withCommandNotes([{ role: "assistant", content: "Ya está en marcha.", commands: [run] }])[0].content;

  it("tells the next replies it still runs", () => {
    expect(notesOf(server)).toContain("still running in the background");
  });

  it("brings its last lines once it ended, since no reply got its result", () => {
    const ended = { ...server, state: "failed" as const, exitCode: 1, output: "Serving\nOSError: Address already in use\n" };
    expect(notesOf(ended)).toContain("Address already in use");
    expect(notesOf({ ...ended, detached: false })).not.toContain("Address already in use");
  });

  it("shows as stopped when a Nyra that quit while it ran is opened again", () => {
    expect(settledRun(server).state).toBe("stopped");
  });
});

