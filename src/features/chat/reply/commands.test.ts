import { describe, expect, it } from "vitest";
import {
  type ComposerCommand,
  describeCommand,
  matchCommands,
  initRequestOf,
  messageForNew,
  modelQueryOf,
  takesArgument,
} from "./commands";

const compact: ComposerCommand = { name: "compact", run: () => {} };
const fork: ComposerCommand = { name: "fork", run: () => {} };
const fresh: ComposerCommand = { name: "new", run: () => {} };

describe("matchCommands", () => {
  it("lists every command for a bare slash and keeps those whose name contains what was typed", () => {
    expect(matchCommands([compact, fork], "")).toEqual([compact, fork]);
    expect(matchCommands([compact, fork], "f")).toEqual([fork]);
    expect(matchCommands([compact, fork, fresh], "ne")).toEqual([fresh]);
    expect(matchCommands([compact], "comp")).toEqual([compact]);
    expect(matchCommands([compact], "PACT")).toEqual([compact]);
    expect(matchCommands([compact], "summarize")).toEqual([]);
  });

  it("describes each command in the interface language", () => {
    expect(describeCommand("compact")).toContain("Resume la conversación");
  });
});

describe("initRequestOf", () => {
  it("takes what the user adds to /init, in any language, and nothing else", () => {
    expect(initRequestOf("/init")).toBe("");
    expect(initRequestOf("/init céntrate en los tests")).toBe("céntrate en los tests");
    expect(initRequestOf("/init focus on the API\nand the CLI")).toBe("focus on the API\nand the CLI");
    expect(initRequestOf("/initialize")).toBeNull();
    expect(initRequestOf("explica /init")).toBeNull();
  });
});

describe("messageForNew", () => {
  it("takes the message written after /new", () => {
    expect(messageForNew("/new búscame la última versión de Python")).toBe("búscame la última versión de Python");
    expect(messageForNew("/new  primera línea\nsegunda")).toBe("primera línea\nsegunda");
  });

  it("tells /new alone apart from other commands and text that only starts like it", () => {
    expect(messageForNew("/new")).toBe("");
    expect(messageForNew("/new   ")).toBe("");
    expect(messageForNew("/newsletter de hoy")).toBeNull();
    expect(messageForNew("/fork hola")).toBeNull();
    expect(messageForNew("hola /new adiós")).toBeNull();
  });
});

describe("modelQueryOf", () => {
  it("reads what to look for after /model and a space", () => {
    expect(modelQueryOf("/model ")).toBe("");
    expect(modelQueryOf("/model gemini flash")).toBe("gemini flash");
  });

  it("is null for /model without a space and for anything else", () => {
    expect(modelQueryOf("/model")).toBeNull();
    expect(modelQueryOf("/models")).toBeNull();
    expect(modelQueryOf("cambia el /model gemini")).toBeNull();
  });

  it("is the only command that waits for an argument", () => {
    expect(takesArgument("model")).toBe(true);
    expect(takesArgument("new")).toBe(false);
  });
});
