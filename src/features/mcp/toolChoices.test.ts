import { describe, expect, it } from "vitest";
import type { McpServer, McpTool } from "./mcpStorage";
import { choiceChange, isChosen } from "./toolChoices";

const tool = (name: string, readOnly: boolean): McpTool => ({
  name,
  title: null,
  description: "",
  inputSchema: {},
  readOnly,
});

const tools = [tool("search", true), tool("read_page", true), tool("delete_page", false)];

const server = (change: Partial<McpServer> = {}): McpServer => ({
  id: "notas",
  name: "Notas",
  command: "npx",
  args: [],
  envNames: [],
  enabled: true,
  alwaysAllowed: [],
  disabledTools: [],
  ...change,
});

describe("bulk tool choices", () => {
  it("allows exactly the read-only tools", () => {
    expect(choiceChange(tools, "alwaysAllowed", "readOnly")).toEqual({
      add: ["search", "read_page"],
      remove: ["delete_page"],
    });
    expect(isChosen(server({ alwaysAllowed: ["search", "read_page"] }), tools, "alwaysAllowed", "readOnly")).toBe(true);
    expect(isChosen(server({ alwaysAllowed: ["search"] }), tools, "alwaysAllowed", "readOnly")).toBe(false);
  });

  it("uses tools by turning off the rest", () => {
    expect(choiceChange(tools, "disabled", "readOnly")).toEqual({
      add: ["delete_page"],
      remove: ["search", "read_page"],
    });
    expect(choiceChange(tools, "disabled", "none").add).toEqual(["search", "read_page", "delete_page"]);
    expect(isChosen(server(), tools, "disabled", "all")).toBe(true);
    expect(isChosen(server({ disabledTools: ["search"] }), tools, "disabled", "all")).toBe(false);
  });
});
