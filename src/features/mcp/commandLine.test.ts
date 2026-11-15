import { describe, expect, it } from "vitest";
import { joinCommandLine, splitCommandLine } from "./commandLine";

describe("command lines", () => {
  it("splits a pasted command, keeping quoted parts whole", () => {
    expect(splitCommandLine('  npx -y @modelcontextprotocol/server-filesystem "/Users/marta/Mis documentos" ')).toEqual([
      "npx",
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "/Users/marta/Mis documentos",
    ]);
    expect(splitCommandLine("uvx mcp-server-git --repository 'C:\\Proyectos\\tienda'")).toEqual([
      "uvx",
      "mcp-server-git",
      "--repository",
      "C:\\Proyectos\\tienda",
    ]);
    expect(splitCommandLine("")).toEqual([]);
  });

  it("writes it back so it splits the same way", () => {
    const parts = ["npx", "-y", "server", "/a b", ""];
    expect(splitCommandLine(joinCommandLine(parts))).toEqual(parts);
  });
});
