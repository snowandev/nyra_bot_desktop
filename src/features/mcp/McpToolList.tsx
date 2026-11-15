import { useTranslation } from "react-i18next";
import { Switch } from "@/shared/ui/Switch";
import type { McpServer, McpTool, ToolList } from "./mcpStorage";
import { choiceChange, isChosen, type ToolChoice } from "./toolChoices";

type Props = {
  server: McpServer;
  tools: McpTool[];
  onChange: (server: McpServer, list: ToolList, add: string[], remove: string[]) => void;
};

const CHOICES: ToolChoice[] = ["all", "readOnly", "none"];

// A server's tools: which the model is told about, and which run without asking; one by one or all at once
export function McpToolList({ server, tools, onChange }: Props) {
  const { t } = useTranslation();
  const used = tools.filter((tool) => !server.disabledTools.includes(tool.name)).length;

  // The choice the list already matches shows pressed; with tools picked one by one, none does
  const bulk = (list: ToolList, label: string) => (
    <div className="mcp-tools-bulk">
      <span>{label}</span>
      <div className="segmented small" role="group" aria-label={label}>
        {CHOICES.map((choice) => {
          const isCurrent = isChosen(server, tools, list, choice);
          return (
            <button
              key={choice}
              type="button"
              aria-pressed={isCurrent}
              onClick={() => {
                if (isCurrent) return;
                const { add, remove } = choiceChange(tools, list, choice);
                onChange(server, list, add, remove);
              }}
            >
              {t(`mcp.settings.choice.${choice}`)}
            </button>
          );
        })}
      </div>
    </div>
  );

  if (tools.length === 0) return <p className="mcp-hint">{t("mcp.settings.noTools")}</p>;

  return (
    <>
      <p className="mcp-hint">{t("mcp.settings.inUse", { used, total: tools.length })}</p>
      {bulk("disabled", t("mcp.settings.use"))}
      {bulk("alwaysAllowed", t("mcp.settings.alwaysAllow"))}
      {tools.map((tool) => {
        const isUsed = !server.disabledTools.includes(tool.name);
        return (
          <div key={tool.name} className={`mcp-tool ${isUsed ? "" : "off"}`}>
            <span className="mcp-tool-text">
              <b>
                {tool.name}
                {tool.readOnly && <span className="mcp-tool-badge">{t("mcp.settings.readOnly")}</span>}
              </b>
              <span>{tool.description}</span>
            </span>
            <label className="mcp-tool-switch">
              <span>{t("mcp.settings.use")}</span>
              <Switch
                checked={isUsed}
                onChange={(on) => onChange(server, "disabled", on ? [] : [tool.name], on ? [tool.name] : [])}
                label={t("mcp.settings.useTool", { tool: tool.name })}
              />
            </label>
            <label className="mcp-tool-switch">
              <span>{t("mcp.settings.alwaysAllow")}</span>
              <Switch
                checked={server.alwaysAllowed.includes(tool.name)}
                disabled={!isUsed}
                onChange={(on) => onChange(server, "alwaysAllowed", on ? [tool.name] : [], on ? [] : [tool.name])}
                label={t("mcp.settings.alwaysAllowTool", { tool: tool.name })}
              />
            </label>
          </div>
        );
      })}
    </>
  );
}
