import type { McpServer, McpTool, ToolList } from "./mcpStorage";

// What a bulk button picks: every tool, those the server says only read, or none
export type ToolChoice = "all" | "readOnly" | "none";

function picked(tools: McpTool[], choice: ToolChoice) {
  if (choice === "all") return tools.map((tool) => tool.name);
  if (choice === "readOnly") return tools.filter((tool) => tool.readOnly).map((tool) => tool.name);
  return [];
}

// The names a choice leaves in the list: for "disabled", those not picked to be used
function namesIn(tools: McpTool[], list: ToolList, choice: ToolChoice) {
  const chosen = picked(tools, choice);
  return list === "disabled" ? tools.map((tool) => tool.name).filter((name) => !chosen.includes(name)) : chosen;
}

const listOf = (server: McpServer, list: ToolList) =>
  list === "disabled" ? server.disabledTools : server.alwaysAllowed;

// What to add to the list and take out of it so it holds exactly the choice, among these tools
export function choiceChange(tools: McpTool[], list: ToolList, choice: ToolChoice) {
  const wanted = namesIn(tools, list, choice);
  return {
    add: wanted,
    remove: tools.map((tool) => tool.name).filter((name) => !wanted.includes(name)),
  };
}

// The list already holds exactly the choice
export function isChosen(server: McpServer, tools: McpTool[], list: ToolList, choice: ToolChoice) {
  const wanted = namesIn(tools, list, choice);
  const current = listOf(server, list);
  return tools.every((tool) => current.includes(tool.name) === wanted.includes(tool.name));
}
