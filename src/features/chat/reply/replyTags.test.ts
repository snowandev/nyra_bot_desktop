import { describe, expect, it } from "vitest";
import {
  cleanRequestValue,
  programOf,
  readReply,
  readRunRound,
  readWorkspaceRound,
  strayClosing,
  tagged,
  withoutRequestTags,
} from "./replyTags";

const both = ["search", "skill"] as const;

describe("readReply", () => {
  it("waits while the reply may still be a request", () => {
    expect(readReply("", ["search"])).toEqual({ kind: "deciding" });
    expect(readReply("  <nyra-se", ["search"])).toEqual({ kind: "deciding" });
    expect(readReply("<nyra-search>python 3.1", ["search"])).toEqual({ kind: "deciding" });
    expect(readReply("<nyra-sk", [...both])).toEqual({ kind: "deciding" });
  });

  it("recognizes a search, also after a short preface", () => {
    expect(readReply("<nyra-search> última versión de Python </nyra-search>", ["search"])).toEqual({
      kind: "request",
      request: "search",
      value: "última versión de Python",
      preface: "",
    });
    const late = readReply("Voy a buscarlo. <nyra-search>qué es Rust</nyra-search>", ["search"]);
    expect(late).toEqual({ kind: "request", request: "search", value: "qué es Rust", preface: "Voy a buscarlo." });
  });

  it("recognizes a skill request and keeps the first request when there are two", () => {
    expect(readReply(tagged("skill", "summarize"), [...both])).toMatchObject({ request: "skill", value: "summarize" });
    const first = readReply(`${tagged("skill", "explain")} ${tagged("search", "x")}`, [...both]);
    expect(first).toMatchObject({ request: "skill", value: "explain" });
  });

  it("lets an ordinary answer through at once, and a request that isn't allowed", () => {
    expect(readReply("Python es", [...both])).toEqual({ kind: "answer" });
    expect(readReply("<nyra-search>x</nyra-search>", [])).toEqual({ kind: "answer" });
    expect(readReply("<nyra-skill>summarize</nyra-skill>", ["search"])).toEqual({ kind: "answer" });
  });
});

describe("withoutRequestTags", () => {
  it.each([
    ["a search", "Hola <nyra-search>x</nyra-search> mundo", "Hola  mundo"],
    ["a skill", "Hola <nyra-skill>summarize</nyra-skill>", "Hola"],
    ["a closing tag left alone", "Mueve el alfil. </nyra-watch>\nY espera.", "Mueve el alfil. \nY espera."],
    ["a tag never closed", "Respuesta <nyra-search>sin cerrar", "Respuesta"],
    ["a program", "Lo calculo.<nyra-code>```python\nprint(2)\n```</nyra-code>", "Lo calculo."],
    ["a program in the background", "Listo.<nyra-code-background>```js\n1\n```</nyra-code-background>", "Listo."],
    ["a wait and a command", "Listo.<nyra-wait>2</nyra-wait><nyra-run-background>x</nyra-run-background>", "Listo."],
  ])("keeps %s from what the user reads", (_, reply, shown) => {
    expect(withoutRequestTags(reply)).toBe(shown);
  });
});

describe("cleanRequestValue", () => {
  it("drops a tag left inside a request and the count copied from the index", () => {
    expect(cleanRequestValue("read", "<nyra-read>frontend/src/app/app.js")).toBe("frontend/src/app/app.js");
    expect(cleanRequestValue("read", "src/main/java/cl/ (57 files)</nyra-outline>")).toBe("src/main/java/cl/");
    expect(cleanRequestValue("list", "src (1 file)")).toBe("src");
  });

  it("leaves a search as it is, apart from stray tags", () => {
    expect(cleanRequestValue("grep", "count (3 files)")).toBe("count (3 files)");
  });

  it("reads the requests of a round already cleaned", () => {
    const round = readWorkspaceRound("<nyra-read><nyra-read>a.ts</nyra-read>");
    expect(round.requests).toEqual([{ kind: "read", value: "a.ts" }]);
  });
});

describe("readRunRound", () => {
  it("reads the commands in order and which go on in the background", () => {
    const round = readRunRound(
      "Compilo y miro el estado.\n<nyra-run-background>npm run build</nyra-run-background>\n<nyra-run>git status</nyra-run>",
    );
    expect(round.commands).toEqual([
      { command: "npm run build", background: true },
      { command: "git status", background: false },
    ]);
    expect(round.start).toBe("Compilo y miro el estado.\n".length);
  });

  it("reads programs among commands, with the language of their fenced block", () => {
    const round = readRunRound(
      "Calculo la media.\n<nyra-code>\n```python\nimport statistics\n    \nprint(statistics.mean([3, 5]))\n```\n</nyra-code>" +
        "<nyra-run>git status</nyra-run>",
    );
    expect(round.commands).toEqual([
      {
        command: "",
        background: false,
        code: { language: "python", source: "import statistics\n    \nprint(statistics.mean([3, 5]))" },
      },
      { command: "git status", background: false },
    ]);
  });

  it.each([
    ["js", "javascript"],
    ["node", "javascript"],
    ["mjs", "javascript"],
    ["py", "python"],
    ["python3", "python"],
    ["ruby", "ruby"],
  ])("names a program in %s as the interpreters know it: %s", (fence, language) => {
    expect(programOf(`\`\`\`${fence}\n1\n\`\`\``).language).toBe(language);
  });

  it("takes a program without a block as Python", () => {
    expect(programOf("print(1)\n")).toEqual({ language: "python", source: "print(1)" });
  });

  it("reads a program that goes on in the background", () => {
    const round = readRunRound("Convierto las fotos.<nyra-code-background>```python\nprint(1)\n```</nyra-code-background>");
    expect(round.commands).toEqual([{ command: "", background: true, code: { language: "python", source: "print(1)" } }]);
  });

  it("keeps a fence inside the program, closing the block only at its last one", () => {
    const source = 'print("```python")\nprint("hola")\nprint("```")';
    expect(programOf(`\n\`\`\`python\n${source}\n\`\`\`\n`).source).toBe(source);
    expect(programOf("```python\nprint(1)").source).toBe("print(1)");
  });
});

describe("strayClosing", () => {
  it("finds a request's closing tag written without its opening", () => {
    expect(strayClosing("Mueve el alfil a c4. </nyra-watch>", ["watch", "point"])).toBe("watch");
    expect(strayClosing("<nyra-watch>Mueve el alfil</nyra-watch>", ["watch"])).toBeNull();
    expect(strayClosing("Texto normal", ["watch"])).toBeNull();
    // Only for the requests the reply could make
    expect(strayClosing("x </nyra-watch>", ["search"])).toBeNull();
  });
});
