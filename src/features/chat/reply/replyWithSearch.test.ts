import { describe, expect, it } from "vitest";
import type { Message, WebSearchRecord } from "@/shared/types";
import { ANSWER_NOW, ANSWER_OR_ASK, CONTINUE_AFTER_COMMANDS, KEEP_GOING, replyWithSearch } from "./replyWithSearch";
import type { CommandAsked } from "./replyTags";
import { NO_MORE_SEARCHES } from "@/features/web/webSearchAgent";
import type { WebSearchResult } from "@/features/web/webSearchStorage";

// Each round of the fake model replies with the next scripted text, token by token
function scriptedChat(replies: string[]) {
  const requests: Message[][] = [];
  const chat = async (messages: Message[], onToken: (token: string) => void, signal: AbortSignal) => {
    requests.push(messages);
    const reply = replies[requests.length - 1] ?? "";
    for (const token of reply.match(/.{1,4}/gs) ?? []) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      onToken(token);
    }
    return undefined;
  };
  return { chat, requests };
}

const result = (n: number): WebSearchResult => ({
  title: `Page ${n}`,
  url: `https://example${n}.com/`,
  snippet: `Snippet ${n}`,
  source: "duckduckgo",
});

type Overrides = {
  forcedQuery?: string;
  results?: WebSearchResult[];
  canSearch?: boolean;
  skillTurn?: (names: string[], canAskAnother: boolean) => Message;
  browser?: Parameters<typeof replyWithSearch>[0]["browser"];
  screen?: Parameters<typeof replyWithSearch>[0]["screen"];
};

function run(replies: string[], overrides: Overrides = {}) {
  const { chat, requests } = scriptedChat(replies);
  const queries: string[] = [];
  const records: WebSearchRecord[] = [];
  let text = "";
  // Everything that reached the screen, also what was cleared afterwards
  let everShown = "";
  const reply = replyWithSearch({
    chat,
    history: [{ role: "user", content: "¿Qué hay de nuevo en Python?" }],
    canSearch: overrides.canSearch ?? true,
    forcedQuery: overrides.forcedQuery ?? null,
    contextWindow: 8192,
    signal: new AbortController().signal,
    onText: (t) => {
      text += t;
      everShown += t;
    },
    onClearText: () => (text = ""),
    onProgress: () => {},
    onRecord: (r) => records.push(r),
    search: async (query) => {
      queries.push(query);
      return overrides.results ?? [result(queries.length * 10 + 1), result(queries.length * 10 + 2)];
    },
    read: async (url) => ({ url, title: "", text: `Text of ${url}`, truncated: false }),
    skillTurn: overrides.skillTurn,
    browser: overrides.browser,
    screen: overrides.screen,
  });
  return { reply, requests, queries, records, text: () => text, everShown: () => everShown };
}

describe("replyWithSearch", () => {
  it("tells the model when it writes a tag's closing without its opening, and never leaves it on screen", async () => {
    const asked: string[] = [];
    const screen = {
      run: async (kind: string, value: string) => {
        asked.push(`${kind}:${value}`);
        return { role: "user" as const, content: "<screen-view>changed</screen-view>" };
      },
    };
    const r = run(
      [
        "Mueve el alfil de c1 a c4.\n\nPor qué: apunta a f7. </nyra-watch>",
        "Mueve el alfil de c1 a c4.\n<nyra-watch>Mueve el alfil a c4</nyra-watch>",
        "¡Bien hecho!",
      ],
      { canSearch: false, screen },
    );
    await r.reply;
    expect(asked).toEqual(["watch:Mueve el alfil a c4"]);
    expect(r.requests[1].at(-1)?.content).toContain("</nyra-watch> without its opening tag");
    expect(r.text()).not.toContain("</nyra-watch>");
  });

  it("answers without searching when the model doesn't ask", async () => {
    const r = run(["Python es un lenguaje."]);
    await expect(r.reply).resolves.toMatchObject({ received: true });
    expect(r.text()).toBe("Python es un lenguaje.");
    expect(r.queries).toEqual([]);
    expect(r.records).toEqual([]);
    expect(r.requests[0].at(-1)?.content).toContain("<nyra-search>");
  });

  it("searches when the model asks and never shows the tag", async () => {
    const r = run(["<nyra-search>python 3.14</nyra-search>", "Salió Python 3.14 [1]."]);
    await r.reply;
    expect(r.queries).toEqual(["python 3.14"]);
    expect(r.text()).toBe("Salió Python 3.14 [1].");
    expect(r.records.at(-1)?.steps[0].sources.map((s) => s.n)).toEqual([1, 2]);
    expect(r.requests[1].at(-1)?.content).toContain("[1] Page 11");
  });

  it("searches first when the user asked explicitly", async () => {
    const r = run(["Respuesta [1]."], { forcedQuery: "qué es python" });
    await r.reply;
    expect(r.queries).toEqual(["qué es python"]);
    expect(r.requests).toHaveLength(1);
    expect(r.requests[0].at(-1)?.content).toContain("<search-results");
  });

  it("answers from memory when the search finds nothing", async () => {
    const r = run(["<nyra-search>python</nyra-search>", "Por lo que sé…"], { results: [] });
    await r.reply;
    expect(r.records.at(-1)).toEqual({ steps: [], failed: true });
    expect(r.requests[1].at(-1)?.content).toContain("failed");
    expect(r.text()).toBe("Por lo que sé…");
  });

  it("stops offering searches after the limit and numbers pages across searches", async () => {
    const ask = (q: string) => `<nyra-search>${q}</nyra-search>`;
    const r = run([ask("a"), ask("b"), ask("c"), `${ask("d")} Final [5].`]);
    await r.reply;
    expect(r.queries).toEqual(["a", "b", "c"]);
    expect(r.records.at(-1)?.steps.map((s) => s.sources[0].n)).toEqual([1, 3, 5]);
    expect(r.requests[3].at(-1)?.content).toContain(NO_MORE_SEARCHES);
  });

  it("never searches when search is off", async () => {
    const r = run(["<nyra-search>x</nyra-search>"], { canSearch: false, forcedQuery: "x" });
    await r.reply;
    expect(r.queries).toEqual([]);
    expect(r.requests[0].at(-1)?.content).not.toContain("<app-instructions>");
  });
});

describe("replyWithSearch with skills", () => {
  const skillTurn = (names: string[], canAskAnother: boolean): Message => ({
    role: "user",
    content: `<skill name="${names.join(", ")}">Instrucciones</skill>${canAskAnother ? " (puede pedir otra)" : ""}`,
  });

  it("loads the skill the model asks for and answers with it, without showing the tag", async () => {
    const r = run(["<nyra-skill>summarize</nyra-skill>", "Resumen: …"], { canSearch: false, skillTurn });
    await expect(r.reply).resolves.toMatchObject({ received: true });
    expect(r.text()).toBe("Resumen: …");
    expect(r.requests).toHaveLength(2);
    expect(r.requests[1].slice(-2)).toEqual([
      { role: "assistant", content: "<nyra-skill>summarize</nyra-skill>" },
      { role: "user", content: '<skill name="summarize">Instrucciones</skill> (puede pedir otra)' },
    ]);
  });

  it("can still search after loading a skill", async () => {
    const r = run(["<nyra-skill>explain</nyra-skill>", "<nyra-search>python 3.14</nyra-search>", "Python 3.14 trae…"], {
      skillTurn,
    });
    await r.reply;
    expect(r.queries).toEqual(["python 3.14"]);
    expect(r.requests[1].at(-3)?.content).toContain("<nyra-search>your search query</nyra-search>");
    expect(r.text()).toBe("Python 3.14 trae…");
  });

  it("loads several skills from one request, in a single round", async () => {
    const r = run(["<nyra-skill>summarize, plan</nyra-skill>", "Resumen y plan"], { canSearch: false, skillTurn });
    await r.reply;
    expect(r.requests).toHaveLength(2);
    expect(r.requests[1].at(-1)?.content).toBe('<skill name="summarize, plan">Instrucciones</skill>');
    expect(r.text()).toBe("Resumen y plan");
  });

  it("never loads more than two, however many are asked for", async () => {
    const r = run(["<nyra-skill>a, b, c</nyra-skill>", "Respuesta"], { canSearch: false, skillTurn });
    await r.reply;
    expect(r.requests[1].slice(-2)[0].content).toBe("<nyra-skill>a, b</nyra-skill>");
  });

  it("stops loading skills after two, so a model can't loop", async () => {
    const r = run(["<nyra-skill>a</nyra-skill>", "<nyra-skill>b</nyra-skill>", "<nyra-skill>c</nyra-skill>"], {
      canSearch: false,
      skillTurn,
    });
    await r.reply;
    // The third request is refused: one more round tells it to answer with what it has
    expect(r.requests).toHaveLength(4);
    expect(r.requests[2].at(-1)?.content).not.toContain("puede pedir otra");
    expect(r.requests[3].at(-1)?.content).toBe(ANSWER_NOW.content);
  });

  it("doesn't wait for a skill tag when there are no skills", async () => {
    const r = run(["<nyra-skill>summarize</nyra-skill>"], { canSearch: false });
    await r.reply;
    expect(r.requests).toHaveLength(1);
    expect(r.text()).toBe("<nyra-skill>summarize</nyra-skill>");
  });
});

describe("connected folder", () => {
  function folderRun(replies: string[], canAsk = () => true) {
    const asked: string[][] = [];
    const { chat, requests } = scriptedChat(replies);
    let text = "";
    const reply = replyWithSearch({
      chat,
      history: [{ role: "user", content: "¿Dónde se usa useChat?" }],
      canSearch: false,
      forcedQuery: null,
      contextWindow: 8192,
      signal: new AbortController().signal,
      onText: (t) => (text += t),
      onClearText: () => (text = ""),
      onProgress: () => {},
      onRecord: () => {},
      workspace: {
        canAsk,
        run: async (requested, notes) => {
          asked.push([...notes.map((n) => `note:${n}`), ...requested.map((r) => `${r.kind}:${r.value}`)]);
          return { role: "user", content: `<folder-results>${requested.map((r) => r.kind).join(",")}</folder-results>` };
        },
        compact: () => null,
        readNames: () =>
          asked.flat().flatMap((a) => (a.startsWith("read:") ? a.slice(5).split("\n").map((p) => p.split("/").pop() ?? p) : [])),
      },
    });
    return { reply, asked, requests, text: () => text };
  }

  it("runs everything asked in one reply together, with the model's notes, and answers after", async () => {
    const r = folderRun([
      "<nyra-note>Busco useChat y miro la estructura.</nyra-note>\n<nyra-grep>useChat</nyra-grep>\n<nyra-outline>src</nyra-outline>",
      "<nyra-note>Se define en useChat.ts.</nyra-note><nyra-read>src/hooks/useChat.ts\nsrc/App.tsx</nyra-read>",
      "Está en App.tsx, línea 3.",
    ]);
    const reply = await r.reply;
    expect(r.asked).toEqual([
      ["note:Busco useChat y miro la estructura.", "grep:useChat", "outline:src"],
      ["note:Se define en useChat.ts.", "read:src/hooks/useChat.ts\nsrc/App.tsx"],
    ]);
    expect(r.requests).toHaveLength(3);
    // The notes stay in the conversation of the reply, with the requests
    expect(r.requests[2].at(-2)?.content).toContain("<nyra-note>Se define en useChat.ts.</nyra-note>");
    expect(r.text()).toBe("Está en App.tsx, línea 3.");
    expect(reply.received).toBe(true);
  });

  it("takes plain text before the tags as the plan, and drops what it writes after them", async () => {
    const r = folderRun(["Voy a buscarlo.\n<nyra-grep>useChat</nyra-grep>\nSeguro que está en App.tsx.", "Hecho."]);
    await r.reply;
    expect(r.asked).toEqual([["note:Voy a buscarlo.", "grep:useChat"]]);
    expect(r.requests[1].at(-2)?.content).toBe("Voy a buscarlo.\n<nyra-grep>useChat</nyra-grep>");
  });

  it("asks for the answer when the analysis stays in a note left open", async () => {
    const r = folderRun([
      "<nyra-read>src/App.tsx</nyra-read>",
      "<nyra-note>App.tsx monta el chat y usa useChat para…",
      "useChat se usa en App.tsx, que monta el chat.",
    ]);
    const reply = await r.reply;
    expect(r.requests).toHaveLength(3);
    expect(r.requests[2].at(-1)?.content).toBe(KEEP_GOING.content);
    expect(r.text()).toBe("useChat se usa en App.tsx, que monta el chat.");
    expect(reply.received).toBe(true);
  });

  it("asks for the answer when the model ends with nothing after reading", async () => {
    const r = folderRun(["<nyra-read>src/App.tsx</nyra-read>", "", "Está en App.tsx."]);
    await r.reply;
    expect(r.text()).toBe("Está en App.tsx.");
  });

  it("doesn't repeat the same round when it only wrote a closed note", async () => {
    const r = folderRun(["<nyra-grep>useChat</nyra-grep>", "<nyra-note>Ya lo tengo.</nyra-note>", "Está en App.tsx."]);
    await r.reply;
    expect(r.requests[2].at(-2)?.content).toBe("<nyra-note>Ya lo tengo.</nyra-note>");
    expect(r.text()).toBe("Está en App.tsx.");
  });

  it("goes on when, after reading, it only says what it will look at next", async () => {
    const r = folderRun([
      "<nyra-read>src/App.tsx</nyra-read>",
      "Ahora voy a revisar los componentes.",
      "<nyra-read>src/components/Chat.tsx</nyra-read>",
      "El chat vive en Chat.tsx y lo monta App.tsx.",
    ]);
    await r.reply;
    expect(r.asked).toHaveLength(2);
    expect(r.text()).toBe("El chat vive en Chat.tsx y lo monta App.tsx.");
  });

  it("goes on in any language when it only announces, and not when it answers", async () => {
    const portuguese = folderRun([
      "<nyra-read>src/App.tsx</nyra-read>",
      "Agora vou verificar os componentes.",
      "O chat está em App.tsx.",
    ]);
    await portuguese.reply;
    expect(portuguese.requests).toHaveLength(3);
    expect(portuguese.text()).toBe("O chat está em App.tsx.");

    const colon = folderRun(["<nyra-read>src/App.tsx</nyra-read>", "Estos son los archivos que revisaré:", "Listo: App.tsx."]);
    await colon.reply;
    expect(colon.text()).toBe("Listo: App.tsx.");

    const answered = folderRun(["<nyra-read>src/App.tsx</nyra-read>", "Está en App.tsx, línea 3."]);
    await answered.reply;
    expect(answered.requests).toHaveLength(2);
  });

  it("takes a short answer that names nothing it read once the model says it again", async () => {
    const r = folderRun(["<nyra-read>src/App.tsx</nyra-read>", "No, no hay tests.", "No, no hay tests."]);
    await r.reply;
    expect(r.requests).toHaveLength(3);
    expect(r.requests[2].at(-1)?.content).toBe(ANSWER_OR_ASK.content);
    expect(r.text()).toBe("No, no hay tests.");
  });

  it("holds a short reply back until it ends, so an announcement never shows", async () => {
    const shown: string[] = [];
    const { chat } = scriptedChat([
      "<nyra-read>src/App.tsx</nyra-read>",
      "Ahora voy a revisar los componentes:",
      "El chat vive en App.tsx. " + "Detalle. ".repeat(60),
    ]);
    await replyWithSearch({
      chat,
      history: [{ role: "user", content: "¿Dónde está el chat?" }],
      canSearch: false,
      forcedQuery: null,
      contextWindow: 8192,
      signal: new AbortController().signal,
      onText: (t) => shown.push(t),
      onClearText: () => shown.push("<clear>"),
      onProgress: () => {},
      onRecord: () => {},
      workspace: {
        canAsk: () => true,
        run: async () => ({ role: "user", content: "<folder-results>read</folder-results>" }),
        compact: () => null,
        readNames: () => ["App.tsx"],
      },
    });
    expect(shown.join("")).not.toContain("voy a revisar");
    expect(shown).not.toContain("<clear>");
    // A long answer still arrives as it is written, once it is past the short length
    expect(shown.length).toBeGreaterThan(1);
  });

  it("shows its notes rather than nothing when it never answers", async () => {
    const r = folderRun(["<nyra-read>src/App.tsx</nyra-read>", "<nyra-note>App.tsx monta el chat.", "", ""]);
    const reply = await r.reply;
    expect(r.text()).toBe("App.tsx monta el chat.");
    expect(reply.received).toBe(true);
  });

  it("gives the turns to compact before each round", async () => {
    const seen: number[] = [];
    const { chat } = scriptedChat(["<nyra-grep>a</nyra-grep>", "<nyra-grep>b</nyra-grep>", "Fin."]);
    await replyWithSearch({
      chat,
      history: [{ role: "user", content: "?" }],
      canSearch: false,
      forcedQuery: null,
      contextWindow: 8192,
      signal: new AbortController().signal,
      onText: () => {},
      onClearText: () => {},
      onProgress: () => {},
      onRecord: () => {},
      workspace: {
        canAsk: () => true,
        run: async () => ({ role: "user", content: "<folder-results>x</folder-results>" }),
        readNames: () => [],
        compact: (turns) => {
          seen.push(turns.length);
          return turns.length >= 4 ? [{ role: "assistant", content: "<nyra-note>resumen</nyra-note>" }, ...turns.slice(-2)] : null;
        },
      },
    });
    expect(seen).toEqual([0, 2, 4]);
  });
});

it("asks once more for an answer when the model only wrote a request it can no longer make", async () => {
  const { chat, requests } = scriptedChat(["<nyra-read>a.ts</nyra-read>", "Con lo que tengo: está en b.ts."]);
  let text = "";
  const reply = await replyWithSearch({
    chat,
    history: [{ role: "user", content: "¿Dónde está?" }],
    canSearch: false,
    forcedQuery: null,
    contextWindow: 8192,
    signal: new AbortController().signal,
    onText: (t) => (text += t),
    onClearText: () => (text = ""),
    onProgress: () => {},
    onRecord: () => {},
    workspace: {
      canAsk: () => false,
      run: async () => ({ role: "user", content: "" }),
      compact: () => null,
      readNames: () => [],
    },
  });
  expect(requests).toHaveLength(2);
  expect(requests[1].at(-1)?.content).toBe(ANSWER_NOW.content);
  expect(text).toBe("Con lo que tengo: está en b.ts.");
  expect(reply.received).toBe(true);
});

// Commands with nothing running in the background
const noBackground = {
  hasPending: () => false,
  takeFinished: () => null,
  wait: async () => ({ role: "user" as const, content: "" }),
  finishAll: async () => null,
};

describe("commands", () => {
  function runWithCommands(replies: string[]) {
    const { chat, requests } = scriptedChat(replies);
    const asked: CommandAsked[][] = [];
    const reads: string[] = [];
    let text = "";
    let kept = 0;
    const reply = replyWithSearch({
      chat,
      history: [{ role: "user", content: "¿Pasan los tests?" }],
      canSearch: false,
      forcedQuery: null,
      contextWindow: 8192,
      signal: new AbortController().signal,
      onText: (t) => (text += t),
      onClearText: () => (text = text.slice(0, kept)),
      onKeepText: () => (kept = text.length),
      onProgress: () => {},
      onRecord: () => {},
      commands: {
        canRun: () => true,
        canRunCode: () => false,
        canRead: () => true,
        run: async (commands) => {
          asked.push(commands);
          return { role: "user", content: '<command-results><command-result n="1" exit-code="0"></command-result></command-results>' };
        },
        read: (_kind, value) => {
          reads.push(value);
          return { role: "user", content: "<command-output>…</command-output>" };
        },
        ...noBackground,
      },
    });
    return { reply, requests, asked, reads, text: () => text, kept: () => kept };
  }

  it("keeps what came before the commands, runs them in order and goes on below", async () => {
    const r = runWithCommands([
      "Voy a pasar los tests.\n<nyra-run>npm run lint</nyra-run>\n<nyra-run>npm test</nyra-run>",
      "Han pasado todos.",
    ]);
    await r.reply;
    expect(r.asked).toEqual([
      [
        { command: "npm run lint", background: false },
        { command: "npm test", background: false },
      ],
    ]);
    expect(r.kept()).toBe("Voy a pasar los tests.\n".length);
    expect(r.text()).toBe("Voy a pasar los tests.\nHan pasado todos.");
    expect(r.requests[1].at(-1)?.content).toContain("<command-results>");
  });

  it("never shows a command tag while it is being written", async () => {
    const shown: string[] = [];
    const { chat } = scriptedChat(["Compruebo.<nyra-run>git status</nyra-run>", "Limpio."]);
    await replyWithSearch({
      chat,
      history: [{ role: "user", content: "¿Hay cambios?" }],
      canSearch: false,
      forcedQuery: null,
      contextWindow: 8192,
      signal: new AbortController().signal,
      onText: (t) => shown.push(t),
      onClearText: () => {},
      onProgress: () => {},
      onRecord: () => {},
      commands: {
        canRun: () => true,
        canRunCode: () => false,
        canRead: () => false,
        run: async () => ({ role: "user", content: "<command-results></command-results>" }),
        read: () => ({ role: "user", content: "" }),
        ...noBackground,
      },
    });
    expect(shown.join("")).toBe("Compruebo.Limpio.");
    expect(shown.some((t) => t.includes("<"))).toBe(false);
  });

  it("asks for the commands that come after a note, never taking them for the answer", async () => {
    const r = runWithCommands([
      "<nyra-note>Primero la auditoría.</nyra-note>\n\nVoy a ejecutar la auditoría:\n\n<nyra-run>cd web && npm audit</nyra-run>",
      "Hay 3 vulnerabilidades.",
    ]);
    await r.reply;
    expect(r.asked).toEqual([[{ command: "cd web && npm audit", background: false }]]);
    expect(r.text()).toBe("Voy a ejecutar la auditoría:\n\nHay 3 vulnerabilidades.");
  });

  it("says it is waiting when it asks for commands, even with nothing written before them", async () => {
    const { chat } = scriptedChat(["<nyra-run>npm test</nyra-run>", "Pasan."]);
    let waits = 0;
    let waitsBeforeRunning = 0;
    await replyWithSearch({
      chat,
      history: [{ role: "user", content: "¿Pasan los tests?" }],
      canSearch: false,
      forcedQuery: null,
      contextWindow: 8192,
      signal: new AbortController().signal,
      onText: () => {},
      onClearText: () => {},
      onProgress: () => {},
      onRecord: () => {},
      onWaiting: () => waits++,
      commands: {
        canRun: () => true,
        canRunCode: () => false,
        canRead: () => false,
        run: async () => {
          waitsBeforeRunning = waits;
          return { role: "user", content: "<command-results></command-results>" };
        },
        read: () => ({ role: "user", content: "" }),
        ...noBackground,
      },
    });
    // Before the command runs, so the thinking line stops while it waits
    expect(waitsBeforeRunning).toBeGreaterThan(0);
  });

  it("reads part of an output when the model asks for it", async () => {
    const r = runWithCommands([
      "<nyra-run>cargo build</nyra-run>",
      "<nyra-output-search>1 warning</nyra-output-search>",
      "Hay avisos de variables sin usar.",
    ]);
    await r.reply;
    expect(r.reads).toEqual(["1 warning"]);
    expect(r.text()).toBe("Hay avisos de variables sin usar.");
  });
});

describe("commands in the background", () => {
  // One background command: running until finish() is called, then its result is given once
  function backgroundTools() {
    let running = false;
    let ended = false;
    let delivered = false;
    let finish = () => {};
    const done = new Promise<void>((resolve) => {
      finish = () => {
        ended = true;
        running = false;
        resolve();
      };
    });
    const result: Message = {
      role: "user",
      content: '<command-results><command-result n="1" exit-code="0">ok</command-result></command-results>',
    };
    const take = () => {
      if (!ended || delivered) return null;
      delivered = true;
      return result;
    };
    const started: Message = {
      role: "user",
      content: '<command-results><command-result n="1" running-in-background="true">It started.</command-result></command-results>',
    };
    const tools = {
      canRun: () => true,
      canRunCode: () => false,
      canRead: () => false,
      run: async (_commands: CommandAsked[]) => {
        running = true;
        return started;
      },
      read: () => ({ role: "user" as const, content: "" }),
      hasPending: () => running || (ended && !delivered),
      takeFinished: take,
      wait: async () => {
        await done;
        return take() ?? result;
      },
    };
    return { tools, finish };
  }

  // afterRound: once each request to the model ends, by its number
  function replyWith(
    replies: string[],
    tools: ReturnType<typeof backgroundTools>["tools"],
    afterRound?: (n: number) => void,
  ) {
    const scripted = scriptedChat(replies);
    const { requests } = scripted;
    let text = "";
    let kept = 0;
    const reply = replyWithSearch({
      chat: async (messages, onToken, signal) => {
        const usage = await scripted.chat(messages, onToken, signal);
        afterRound?.(requests.length);
        return usage;
      },
      history: [{ role: "user", content: "Compila y revisa el README" }],
      canSearch: false,
      forcedQuery: null,
      contextWindow: 8192,
      signal: new AbortController().signal,
      onText: (t) => (text += t),
      onClearText: () => (text = text.slice(0, kept)),
      onKeepText: () => (kept = text.length),
      onProgress: () => {},
      onRecord: () => {},
      commands: tools,
    });
    return { reply, requests, text: () => text };
  }

  it("goes on while one runs and continues the answer below with its result when it ends meanwhile", async () => {
    const { tools, finish } = backgroundTools();
    const r = replyWith(
      [
        "Compilo mientras tanto.<nyra-run-background>npm run build</nyra-run-background>",
        "El README está bien.",
        "La compilación también terminó bien.",
      ],
      tools,
      (n) => n === 2 && finish(),
    );
    const reply = await r.reply;
    expect(r.text()).toBe("Compilo mientras tanto.El README está bien.La compilación también terminó bien.");
    expect(r.requests).toHaveLength(3);
    expect(r.requests[2].at(-1)?.content).toContain(CONTINUE_AFTER_COMMANDS);
    expect(r.requests[2].at(-1)?.content).toContain('exit-code="0"');
    expect(reply.received).toBe(true);
  });

  it("doesn't wait for one still running once the answer is written: a server never ends", async () => {
    const { tools } = backgroundTools();
    const r = replyWith(
      ["Levanto el servidor.<nyra-run-background>python3 -m http.server</nyra-run-background>", "Ya está en marcha."],
      tools,
    );
    const reply = await r.reply;
    expect(r.requests).toHaveLength(2);
    expect(r.text()).toBe("Levanto el servidor.Ya está en marcha.");
    expect(reply.received).toBe(true);
  });

  it("also continues the answer that comes after notes alone", async () => {
    const { tools, finish } = backgroundTools();
    const scripted = scriptedChat([
      "Compilo mientras tanto.<nyra-run-background>npm run build</nyra-run-background>",
      "<nyra-note>El README ya lo leí.</nyra-note>\nEl README está bien.",
      "La compilación también terminó bien.",
    ]);
    const { requests } = scripted;
    const reply = await replyWithSearch({
      chat: async (messages, onToken, signal) => {
        const usage = await scripted.chat(messages, onToken, signal);
        if (requests.length === 2) finish();
        return usage;
      },
      history: [{ role: "user", content: "Compila y revisa el README" }],
      canSearch: false,
      forcedQuery: null,
      contextWindow: 8192,
      signal: new AbortController().signal,
      onText: () => {},
      onClearText: () => {},
      onProgress: () => {},
      onRecord: () => {},
      workspace: {
        canAsk: () => true,
        run: async () => ({ role: "user", content: "<folder-results></folder-results>" }),
        compact: () => null,
        readNames: () => [],
      },
      commands: tools,
    });
    expect(requests).toHaveLength(3);
    expect(requests[2].at(-1)?.content).toContain(CONTINUE_AFTER_COMMANDS);
    expect(reply.received).toBe(true);
  });

  it("also reads the files asked for along with the command, in the same round", async () => {
    const { tools, finish } = backgroundTools();
    const folderAsks: string[] = [];
    const { chat, requests } = scriptedChat([
      "Compilo y leo el README.<nyra-run-background>npm run build</nyra-run-background><nyra-read>README.md</nyra-read>",
      "El README explica la instalación.",
      "Y la compilación terminó bien.",
    ]);
    setTimeout(finish, 0);
    await replyWithSearch({
      chat,
      history: [{ role: "user", content: "Compila y revisa el README" }],
      canSearch: false,
      forcedQuery: null,
      contextWindow: 8192,
      signal: new AbortController().signal,
      onText: () => {},
      onClearText: () => {},
      onProgress: () => {},
      onRecord: () => {},
      commands: tools,
      workspace: {
        canAsk: () => true,
        run: async (asked, notes) => {
          folderAsks.push(...asked.map((r) => `${r.kind}:${r.value}`), ...notes.map((n) => `note:${n}`));
          return { role: "user", content: "<folder-results>README</folder-results>" };
        },
        compact: () => null,
        readNames: () => ["README.md"],
      },
    });
    expect(folderAsks).toEqual(["read:README.md"]);
    expect(requests[1].at(-1)?.content).toContain('running-in-background="true"');
    expect(requests[1].at(-1)?.content).toContain("<folder-results>");
  });

  it("also runs the commands asked for after a file to read, in the same round", async () => {
    const { tools, finish } = backgroundTools();
    const folderAsks: string[] = [];
    let ran = 0;
    const run = tools.run;
    tools.run = async (commands) => {
      ran += commands.length;
      return run(commands);
    };
    const { chat } = scriptedChat([
      "Leo el package.json y audito.\n<nyra-read>web/package.json</nyra-read>\n<nyra-run-background>npm audit</nyra-run-background>",
      "Listo.",
      "Y la auditoría también.",
    ]);
    setTimeout(finish, 0);
    await replyWithSearch({
      chat,
      history: [{ role: "user", content: "Audita el front" }],
      canSearch: false,
      forcedQuery: null,
      contextWindow: 8192,
      signal: new AbortController().signal,
      onText: () => {},
      onClearText: () => {},
      onProgress: () => {},
      onRecord: () => {},
      commands: tools,
      workspace: {
        canAsk: () => true,
        run: async (asked) => {
          folderAsks.push(...asked.map((r) => `${r.kind}:${r.value}`));
          return { role: "user", content: "<folder-results></folder-results>" };
        },
        compact: () => null,
        readNames: () => [],
      },
    });
    expect(ran).toBe(1);
    expect(folderAsks).toEqual(["read:web/package.json"]);
  });

  it("waits for one when the model asks, and gets its result", async () => {
    const { tools, finish } = backgroundTools();
    const r = replyWith(
      ["<nyra-run-background>npm test</nyra-run-background>", "<nyra-wait>1</nyra-wait>", "Pasan todos los tests."],
      tools,
    );
    setTimeout(finish, 0);
    await r.reply;
    expect(r.requests[2].at(-1)?.content).toContain('exit-code="0"');
    expect(r.text()).toBe("Pasan todos los tests.");
  });

  it("gives the result of one that ended to the next turn, without being asked, in the app's turn", async () => {
    const { tools, finish } = backgroundTools();
    const run = tools.run;
    let calls = 0;
    // The background one ends while the second command runs
    tools.run = async (commands) => {
      calls++;
      if (calls === 2) finish();
      return run(commands);
    };
    const r = replyWith(
      ["<nyra-run-background>cargo test</nyra-run-background>", "<nyra-run>git status</nyra-run>", "Todo listo."],
      tools,
    );
    await r.reply;
    const third = r.requests[2];
    expect(third.at(-1)?.role).toBe("user");
    expect(third.at(-1)?.content).toContain('exit-code="0"');
    expect(third.slice(1).map((m) => m.role)).toEqual(["assistant", "user", "assistant", "user"]);
  });
});

describe("an answer written after notes alone", () => {
  it("arrives whole and as it is written, however long", async () => {
    const answer = `## Segunda pasada\n\n${"Hallazgo detallado sobre el código del proyecto. ".repeat(40)}Fin.`;
    const { chat } = scriptedChat([`<nyra-note>Ya tengo los archivos que faltaban.</nyra-note>\n${answer}`]);
    const shown: string[] = [];
    let stopped = false;
    await replyWithSearch({
      chat: async (messages, onToken, signal) => {
        signal.addEventListener("abort", () => (stopped = true));
        return chat(messages, onToken, signal);
      },
      history: [{ role: "user", content: "continúa" }],
      canSearch: false,
      forcedQuery: null,
      contextWindow: 32768,
      signal: new AbortController().signal,
      onText: (t) => shown.push(t),
      onClearText: () => shown.push("<clear>"),
      onProgress: () => {},
      onRecord: () => {},
      workspace: {
        canAsk: () => true,
        run: async () => ({ role: "user", content: "<folder-results></folder-results>" }),
        compact: () => null,
        readNames: () => [],
      },
    });
    expect(stopped).toBe(false);
    expect(shown.join("")).toBe(answer);
    // Shown in pieces while it arrived, not all at the end
    expect(shown.length).toBeGreaterThan(2);
  });

  it("never shows a long program that follows the notes, and runs it", async () => {
    const program = `print(${"1 + ".repeat(200)}1)`;
    const { chat } = scriptedChat([
      `<nyra-note>Plan: sumar.</nyra-note>\nLo calculo.\n<nyra-code>\n\`\`\`python\n${program}\n\`\`\`\n</nyra-code>`,
      "Da 201.",
    ]);
    const asked: CommandAsked[][] = [];
    let text = "";
    let kept = 0;
    await replyWithSearch({
      chat,
      history: [{ role: "user", content: "suma" }],
      canSearch: false,
      forcedQuery: null,
      contextWindow: 32768,
      signal: new AbortController().signal,
      onText: (t) => (text += t),
      onClearText: () => (text = text.slice(0, kept)),
      onKeepText: () => (kept = text.length),
      onProgress: () => {},
      onRecord: () => {},
      workspace: {
        canAsk: () => true,
        run: async () => ({ role: "user", content: "<folder-results></folder-results>" }),
        compact: () => null,
        readNames: () => [],
      },
      commands: {
        canRun: () => false,
        canRunCode: () => true,
        canRead: () => false,
        run: async (commands) => {
          asked.push(commands);
          return { role: "user", content: '<command-results><command-result n="1" exit-code="0"></command-result></command-results>' };
        },
        read: () => ({ role: "user", content: "" }),
        ...noBackground,
      },
    });
    expect(asked).toEqual([[{ command: "", background: false, code: { language: "python", source: program } }]]);
    expect(text).not.toContain("nyra-code");
    expect(text).not.toContain(program);
    expect(text).toBe("Lo calculo.\n\nDa 201.");
  });

  it("works in the browser one action at a time, with the sentence before each tag as what it is doing", async () => {
    const actions: string[] = [];
    const browser = {
      run: async (kind: string, value: string, preface: string): Promise<Message> => {
        actions.push(`${kind}|${value}|${preface}`);
        return { role: "user", content: `<browser-page>after ${kind}</browser-page>` };
      },
    };
    const r = run(
      [
        "Abro la tienda.\n<nyra-browse>localhost:5173</nyra-browse>",
        "<nyra-type>1 | marta@example.com</nyra-type>",
        "<nyra-click>3</nyra-click>",
        "Ya entré: el panel muestra 42 ventas.",
      ],
      { browser, canSearch: false },
    );
    await expect(r.reply).resolves.toMatchObject({ received: true });
    expect(actions).toEqual(["browse|localhost:5173|Abro la tienda.", "type|1 | marta@example.com|", "click|3|"]);
    expect(r.text()).toBe("Ya entré: el panel muestra 42 ventas.");
    expect(r.requests[1].at(-1)?.content).toContain("after browse");
  });

  it("hands every browser tag to the browser, which answers what can't be done instead of it passing as text", async () => {
    const actions: string[] = [];
    const browser = {
      run: async (kind: string): Promise<Message> => {
        actions.push(kind);
        return { role: "user", content: '<browser-error action="click">No page is open.</browser-error>' };
      },
    };
    const r = run(["<nyra-click>3</nyra-click>", "No hay ninguna página abierta todavía."], { browser, canSearch: false });
    await r.reply;
    expect(actions).toEqual(["click"]);
    expect(r.requests[1].at(-1)?.content).toContain("No page is open");
    expect(r.text()).toBe("No hay ninguna página abierta todavía.");
  });

  it("never flashes the sentence the model writes before a request, in any language", async () => {
    for (const preface of ["Ahora voy a buscarlo.", "Let me look that up.", "Je vais chercher ça."]) {
      const r = run([`${preface}\n<nyra-search>python 3.14</nyra-search>`, "Salió Python 3.14 [1]."]);
      await r.reply;
      expect(r.everShown()).not.toContain(preface);
      expect(r.text()).toBe("Salió Python 3.14 [1].");
    }
  });

  it("keeps a long text written before a browser action, goes on below it and lets the model know it said it", async () => {
    const said = `Tienes razón: la contraseña lleva un signo al final. ${"Lo corrijo y vuelvo a intentarlo. ".repeat(6)}`;
    const browser = {
      run: async (): Promise<Message> => ({ role: "user", content: "<browser-page>Panel</browser-page>" }),
    };
    const r = run([`${said}\n<nyra-click>3</nyra-click>`, "Ya entré al panel."], { browser, canSearch: false });
    await r.reply;
    // Never cleared: what was on screen is still there, with the answer after it
    expect(r.text()).toContain(said.trim());
    expect(r.text()).toContain("Ya entré al panel.");
    expect(r.requests[1].at(-2)?.content).toContain("Tienes razón");
  });
});

