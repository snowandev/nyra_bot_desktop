import { describe, expect, it } from "vitest";
import { matchFiles, mentionAt, mentionedPaths, withMention } from "./mentions";

const indexed = new Set(["src/app.ts", "src/notas/archivonuevo.md", "docs/diseño.md", "img/logo.png"]);

describe("mentionedPaths", () => {
  it("finds the files of the index the message names, in any language", () => {
    expect(mentionedPaths("Revisa @src/app.ts y @docs/diseño.md.", indexed)).toEqual(["src/app.ts", "docs/diseño.md"]);
    expect(mentionedPaths("Please check @src/app.ts, thanks", indexed)).toEqual(["src/app.ts"]);
    expect(mentionedPaths("Regarde @src/notas/archivonuevo.md !", indexed)).toEqual(["src/notas/archivonuevo.md"]);
  });

  it("ignores what isn't a file of the folder, e-mail addresses, repeats and images", () => {
    expect(mentionedPaths("escribe a marta@ejemplo.com sobre @nada.ts", indexed)).toEqual([]);
    expect(mentionedPaths("@src/app.ts y otra vez @src/app.ts", indexed)).toEqual(["src/app.ts"]);
    expect(mentionedPaths("mira @img/logo.png", indexed)).toEqual([]);
  });
});

describe("writing a mention", () => {
  it("knows when the cursor is on an @ being written", () => {
    expect(mentionAt("hola @src/ap", 12)).toEqual({ start: 5, query: "src/ap" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionAt("marta@ejemplo", 13)).toBeNull();
    expect(mentionAt("hola @src/app.ts y", 18)).toBeNull();
  });

  it("offers the files whose name starts with what was typed first", () => {
    const paths = ["docs/app-guide.md", "src/app.ts", "src/main/myapp.ts"];
    expect(matchFiles(paths, "app")).toEqual(["src/app.ts", "docs/app-guide.md", "src/main/myapp.ts"]);
    expect(matchFiles(paths, "DISENO")).toEqual([]);
    expect(matchFiles(["docs/diseño.md"], "diseno")).toEqual(["docs/diseño.md"]);
  });

  it("puts the chosen file in place of what was typed", () => {
    expect(withMention("mira @ap y dime", 5, 8, "src/app.ts")).toEqual({ text: "mira @src/app.ts y dime", caret: 17 });
  });
});
