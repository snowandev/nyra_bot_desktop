import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// The MCP servers the user added run in Rust, on this computer; their secret variables are in the system keychain

export type McpServer = {
  // Empty for a new one: Rust makes it from its name
  id: string;
  name: string;
  command: string;
  args: string[];
  // Only their names; the values never come back from Rust
  envNames: string[];
  enabled: boolean;
  // Tools the user let run without asking each time
  alwaysAllowed: string[];
  // Tools the model isn't told about
  disabledTools: string[];
};

export type ToolList = "alwaysAllowed" | "disabled";

export type McpTool = {
  name: string;
  title: string | null;
  description: string;
  inputSchema: Record<string, unknown>;
  // The server says it only reads; a hint
  readOnly: boolean;
};

type McpCallResult = { text: string; images: { mimeType: string; data: string }[]; isError: boolean };

export const mcpServers = () => invoke<McpServer[]>("mcp_servers");

// envValues: every variable it has, kept in the keychain, an empty value keeping the saved one; undefined leaves them
// as they are. Its tool lists stay: they change with setMcpTools.
export const saveMcpServer = (server: McpServer, envValues?: Record<string, string>) =>
  invoke<McpServer>("mcp_save_server", { server, envValues: envValues ?? null });

// Only the tools named change, and the server keeps running, so a reply using it goes on
export const setMcpTools = (id: string, list: ToolList, add: string[], remove: string[]) =>
  invoke<McpServer>("mcp_set_tools", { id, list, add, remove });

export const deleteMcpServer = (id: string) => invoke<void>("mcp_delete_server", { id });

// Starts the server if it isn't running
export const mcpServerTools = (id: string) => invoke<McpTool[]>("mcp_tools", { id });

// The tools of the servers that ran before, by id, without starting them
export const mcpKnownTools = () => invoke<Record<string, McpTool[]>>("mcp_known_tools");

// Data URIs, ready for an <img>: for light backgrounds, and for dark ones when the server has its own
export type ServerIcon = { light: string | null; dark: string | null };

// The icons of the servers that ran before and have one, by id
export const mcpIcons = () => invoke<Record<string, ServerIcon>>("mcp_icons");

// A server's icon arrived or changed
export const onMcpIcon = (handler: () => void) => listen<string>("mcp-icon", () => handler());

// What it wrote on its error output since it last started, the newest last
export const mcpLog = (id: string) => invoke<string>("mcp_log", { id });

export const disconnectMcpServer =(id: string) => invoke<void>("mcp_disconnect", { id });

export const callMcpTool = (id: string, tool: string, args: unknown) =>
  invoke<McpCallResult>("mcp_call_tool", { id, tool, arguments: args });

// The servers set up in Claude Desktop, with the values of their variables, to bring in
const mcpImportCandidates = () =>
  invoke<{ server: McpServer; env: Record<string, string> }[]>("mcp_import_candidates");

// Those of Claude Desktop that Nyra doesn't have yet, by name
export async function newImportCandidates() {
  const [found, existing] = await Promise.all([mcpImportCandidates(), mcpServers()]);
  return found.filter((f) => !existing.some((s) => s.name === f.server.name));
}

// Brings them in, only the named ones when given; resolves with how many
export async function importFromClaudeDesktop(names?: string[]) {
  const fresh = (await newImportCandidates()).filter((f) => !names || names.includes(f.server.name));
  for (const { server, env } of fresh) await saveMcpServer(server, env);
  return fresh.length;
}
