import { Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextField } from "@/features/settings/TextField";
import { errorMessage } from "@/shared/lib/errors";
import { InlineConfirm } from "@/shared/ui/InlineConfirm";
import { SettingsPanel } from "@/shared/ui/SettingsPanel";
import { Switch } from "@/shared/ui/Switch";
import { joinCommandLine, splitCommandLine } from "./commandLine";
import { McpServerLog } from "./McpServerLog";
import { McpToolList } from "./McpToolList";
import type { McpServer, McpTool, ToolList } from "./mcpStorage";

export type ServerTools = { status: "loading" } | { status: "ready"; tools: McpTool[] } | { status: "error"; error: string };

type Props = {
  // null: a new one
  server: McpServer | null;
  tools: ServerTools | null;
  onSave: (server: McpServer, envValues: Record<string, string> | undefined) => Promise<void>;
  onDelete: (server: McpServer) => Promise<void>;
  onTest: (server: McpServer) => void;
  onChangeTools: (server: McpServer, list: ToolList, add: string[], remove: string[]) => void;
};

type Variable = { name: string; value: string };

const NAME_MAX = 60;
const COMMAND_MAX = 2_000;

// One server: how it starts, its secret variables (only their names come back), and its tools with which run without
// asking
export function McpServerPanel({ server, tools, onSave, onDelete, onTest, onChangeTools }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(server?.name ?? "");
  const [commandLine, setCommandLine] = useState(server ? joinCommandLine([server.command, ...server.args]) : "");
  const [enabled, setEnabled] = useState(server?.enabled ?? true);
  // Saved values aren't read back: an empty value keeps the saved one
  const [variables, setVariables] = useState<Variable[]>(server?.envNames.map((n) => ({ name: n, value: "" })) ?? []);
  const [changedVariables, setChangedVariables] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeVariable(index: number, change: Partial<Variable>) {
    setChangedVariables(true);
    setVariables((all) => all.map((v, i) => (i === index ? { ...v, ...change } : v)));
  }

  async function save() {
    const [command = "", ...args] = splitCommandLine(commandLine);
    // Every variable, those left empty too, which keep their saved value
    const envValues = changedVariables
      ? Object.fromEntries(variables.filter((v) => v.name.trim()).map((v) => [v.name.trim(), v.value]))
      : undefined;
    setIsSaving(true);
    setError(null);
    try {
      await onSave(
        {
          id: server?.id ?? "",
          name,
          command,
          args,
          envNames: server?.envNames ?? [],
          enabled,
          alwaysAllowed: server?.alwaysAllowed ?? [],
          disabledTools: server?.disabledTools ?? [],
        },
        envValues,
      );
      setChangedVariables(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <SettingsPanel
      title={server?.name || t("mcp.settings.newServer")}
      description={t("mcp.settings.serverDescription")}
      aside={server && <Switch checked={enabled} onChange={setEnabled} label={t("mcp.settings.enabled")} />}
    >
      <div className="mcp-form">
        {!server && (
          <p className="field-warning">
            <ShieldAlert size={15} strokeWidth={2} aria-hidden="true" />
            <span>{t("mcp.settings.trustWarning")}</span>
          </p>
        )}
        <TextField label={t("mcp.settings.name")} value={name} onChange={setName} maxLength={NAME_MAX} placeholder={t("mcp.settings.namePlaceholder")} />
        <TextField
          label={t("mcp.settings.command")}
          value={commandLine}
          onChange={setCommandLine}
          maxLength={COMMAND_MAX}
          placeholder={t("mcp.settings.commandPlaceholder")}
          hint={t("mcp.settings.commandHint")}
        />
        <div className="mcp-variables">
          <span className="mcp-label">{t("mcp.settings.variables")}</span>
          <span className="mcp-hint">{t("mcp.settings.variablesHint")}</span>
          {variables.map((variable, i) => (
            <div key={i} className="mcp-variable">
              <input
                className="text-input"
                aria-label={t("mcp.settings.variableName")}
                placeholder={t("mcp.settings.variablePlaceholder")}
                value={variable.name}
                onChange={(e) => changeVariable(i, { name: e.target.value })}
              />
              <input
                className="text-input"
                type="password"
                aria-label={t("mcp.settings.variableValue", { name: variable.name })}
                placeholder={server?.envNames.includes(variable.name) ? t("mcp.settings.saved") : ""}
                value={variable.value}
                onChange={(e) => changeVariable(i, { value: e.target.value })}
              />
              <button
                type="button"
                className="icon-button small"
                aria-label={t("mcp.settings.removeVariable", { name: variable.name })}
                onClick={() => {
                  setChangedVariables(true);
                  setVariables((all) => all.filter((_, j) => j !== i));
                }}
              >
                <Trash2 size={15} strokeWidth={2} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="ghost-button small"
            onClick={() => setVariables((all) => [...all, { name: "", value: "" }])}
          >
            <Plus size={15} strokeWidth={2} aria-hidden="true" />
            {t("mcp.settings.addVariable")}
          </button>
        </div>
        {error && (
          <p className="mcp-error" role="alert">
            {error}
          </p>
        )}
        <div className="mcp-actions">
          <button type="button" className="primary-button small" disabled={isSaving} onClick={() => void save()}>
            {t("mcp.settings.save")}
          </button>
          {server && (
            <>
              <button type="button" className="outline-button small" onClick={() => onTest(server)}>
                {t("mcp.settings.test")}
              </button>
              <button type="button" className="outline-button small danger" onClick={() => setIsConfirmingDelete(true)}>
                {t("mcp.settings.delete")}
              </button>
            </>
          )}
        </div>
        {server && isConfirmingDelete && (
          <InlineConfirm
            className="mcp-confirm"
            actionsClassName="mcp-actions"
            small
            title={t("mcp.settings.deleteTitle", { name: server.name })}
            confirmLabel={t("mcp.settings.delete")}
            onCancel={() => setIsConfirmingDelete(false)}
            onConfirm={() => void onDelete(server)}
          >
            {t("mcp.settings.deleteHint")}
          </InlineConfirm>
        )}
      </div>

      {server && tools && (
        <div className="mcp-tools">
          <span className="mcp-label">{t("mcp.settings.tools")}</span>
          {tools.status === "loading" && <p className="mcp-hint">{t("mcp.settings.connecting")}</p>}
          {tools.status === "error" && (
            <p className="mcp-error" role="alert">
              {tools.error}
            </p>
          )}
          {tools.status === "ready" && <McpToolList server={server} tools={tools.tools} onChange={onChangeTools} />}
        </div>
      )}
      {server && <McpServerLog serverId={server.id} status={tools?.status ?? "none"} />}
    </SettingsPanel>
  );
}
