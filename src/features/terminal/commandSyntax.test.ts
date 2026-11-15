import { describe, expect, it } from "vitest";
import { commandTokens } from "./commandSyntax";

const kinds = (command: string) =>
  commandTokens(command)
    .filter((t) => t.kind !== "text" || t.text.trim())
    .map((t) => `${t.kind}:${t.text}`);

describe("commandTokens", () => {
  it("finds the program, its options and what follows a pipe or a separator", () => {
    expect(kinds("pip install bandit --quiet && bandit -r .")).toEqual([
      "program:pip",
      "text:install",
      "text:bandit",
      "option:--quiet",
      "operator:&&",
      "program:bandit",
      "option:-r",
      "text:.",
    ]);
  });

  it("reads strings, variables and comments", () => {
    expect(kinds('git commit -m "arreglo del carrito" # sin tests')).toEqual([
      "program:git",
      "text:commit",
      "option:-m",
      'string:"arreglo del carrito"',
      "comment:# sin tests",
    ]);
    expect(kinds("echo $HOME | grep x")).toEqual(["program:echo", "variable:$HOME", "operator:|", "program:grep", "text:x"]);
  });

  it("works for PowerShell too", () => {
    expect(kinds("Get-ChildItem -Recurse $env:TEMP | Remove-Item -Force")).toEqual([
      "program:Get-ChildItem",
      "option:-Recurse",
      "variable:$env:TEMP",
      "operator:|",
      "program:Remove-Item",
      "option:-Force",
    ]);
  });

  it("treats environment settings before the program as plain text", () => {
    expect(kinds("CI=1 npm test")).toEqual(["text:CI=1", "program:npm", "text:test"]);
  });

  it("keeps every character, so the command reads the same", () => {
    const command = `NODE_ENV=prod npm run build 2>&1 | tee 'log file.txt'; echo "hecho"`;
    expect(commandTokens(command).map((t) => t.text).join("")).toBe(command);
  });
});
