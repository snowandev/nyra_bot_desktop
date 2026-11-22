import { Download, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "@/shared/lib/errors";
import { SettingsOption } from "@/shared/ui/SettingsOption";
import { McpIcon } from "./McpIcon";
import { useMcpIcons } from "./mcpIcons";
import { McpServerPanel, type ServerTools } from "./McpServerPanel";
import {
  deleteMcpServer,
  disconnectMcpServer,
  importFromClaudeDesktop,
  importCandidateNames,
  mcpServerTools,
  mcpServers,
  saveMcpServer,
  setMcpTools,
  type McpServer,
  type ToolList,
} from "./mcpStorage";

const NEW = "new";

// Settings → Conexiones MCP: the servers the user added, each one's tools, adding one, and bringing in those set up
// in Claude Desktop
export function McpSettings() {
  const { t } = useTranslation();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [selected, setSelected] = useState<string>(NEW);
  const [tools, setTools] = useState<Record<string, ServerTools>>({});
  const [inClaudeDesktop, setInClaudeDesktop] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const icons = useMcpIcons();

  const load = useCallback(async () => {
    const list = await mcpServers();
    setServers(list);
    return list;
  }, []);

  const connect = useCallback(async (server: McpServer) => {
    setTools((all) => ({ ...all, [server.id]: { status: "loading" } }));
    try {
      const found = await mcpServerTools(server.id);
      setTools((all) => ({ ...all, [server.id]: { status: "ready", tools: found } }));
    } catch (e) {
      setTools((all) => ({ ...all, [server.id]: { status: "error", error: errorMessage(e) } }));
    }
  }, []);

  useEffect(() => {
    void load()
      .then((list) => {
        if (list.length > 0) setSelected(list[0].id);
      })
      .catch((e) => setNotice(errorMessage(e)));
  }, [load]);

  // Claude Desktop's servers are read once: what it has that isn't here yet follows the list, which changes with each
  // tool turned on or off, without reading its settings (and their secret values) again each time
  useEffect(() => {
    importCandidateNames()
      .then(setInClaudeDesktop)
      .catch(() => setInClaudeDesktop([]));
  }, []);
  const imports = inClaudeDesktop.filter((name) => !servers.some((s) => s.name === name)).length;

  const server = servers.find((s) => s.id === selected) ?? null;

  useEffect(() => {
    if (server?.enabled && !tools[server.id]) void connect(server);
  }, [server, tools, connect]);

  async function save(changed: McpServer, envValues: Record<string, string> | undefined) {
    const saved = await saveMcpServer(changed, envValues);
    await load();
    setSelected(saved.id);
    setTools((all) => {
      const rest = { ...all };
      delete rest[saved.id];
      return rest;
    });
  }

  async function remove(gone: McpServer) {
    await deleteMcpServer(gone.id);
    const list = await load();
    setSelected(list[0]?.id ?? NEW);
  }

  async function importAll() {
    const count = await importFromClaudeDesktop();
    await load();
    setNotice(t("mcp.settings.imported", { count }));
  }

  async function changeTools(target: McpServer, list: ToolList, add: string[], remove: string[]) {
    await setMcpTools(target.id, list, add, remove);
    await load();
  }

  const statusOf = (s: McpServer) => {
    const state = tools[s.id];
    if (!s.enabled) return { dot: "", label: t("mcp.settings.off") };
    if (state?.status === "ready") return { dot: "loaded", label: t("mcp.settings.toolCount", { count: state.tools.length }) };
    if (state?.status === "error") return { dot: "error", label: t("mcp.settings.failed") };
    if (state?.status === "loading") return { dot: "loading", label: t("common.connecting") };
    return { dot: "", label: t("mcp.settings.notStarted") };
  };

  return (
    <div className="settings-content">
      <section aria-label={t("mcp.settings.list")} className="settings-list">
        <div className="section-label">{t("mcp.settings.list")}</div>
        {servers.map((s) => (
          <SettingsOption
            key={s.id}
            icon={<McpIcon icon={icons[s.id]} name={s.name} />}
            name={s.name}
            status={
              <span className="settings-option-status">
                <span className={`status-dot ${statusOf(s).dot}`} />
                {statusOf(s).label}
              </span>
            }
            selected={s.id === selected}
            onSelect={() => setSelected(s.id)}
          />
        ))}
        <button type="button" className="ghost-button" onClick={() => setSelected(NEW)}>
          <Plus size={16} strokeWidth={2} aria-hidden="true" />
          {t("mcp.settings.add")}
        </button>
        {imports > 0 && (
          <button type="button" className="ghost-button" onClick={() => void importAll().catch((e) => setNotice(errorMessage(e)))}>
            <Download size={16} strokeWidth={2} aria-hidden="true" />
            {t("mcp.settings.import", { count: imports })}
          </button>
        )}
        {notice && (
          <p className="mcp-hint" role="status">
            {notice}
          </p>
        )}
      </section>

      <McpServerPanel
        key={server?.id ?? NEW}
        server={server}
        tools={server ? (tools[server.id] ?? null) : null}
        onSave={save}
        onDelete={remove}
        onTest={(s) => {
          void disconnectMcpServer(s.id).then(() => connect(s));
        }}
        onChangeTools={(s, list, add, remove) =>
          void changeTools(s, list, add, remove).catch((e) => setNotice(errorMessage(e)))
        }
      />
    </div>
  );
}
