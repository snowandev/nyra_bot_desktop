import { ChevronRight, CircleCheck, CircleStop, CircleX, LoaderCircle, ShieldQuestion } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { ToolCall } from "@/shared/types";
import { McpIcon } from "./McpIcon";
import { useMcpIcons } from "./mcpIcons";
import { decideTool, isAwaitingToolDecision, onToolDecisionsChange } from "./toolDecisions";

type Props = {
  call: ToolCall;
};

const STATE_ICONS = {
  asking: ShieldQuestion,
  running: LoaderCircle,
  done: CircleCheck,
  failed: CircleX,
  denied: CircleX,
  stopped: CircleStop,
};

// One use of a tool of the user's MCP servers, in the reply: which tool, the question to allow it, and, when the user
// opens it, what it was given and what it returned
export function ToolCallCard({ call }: Props) {
  const { t } = useTranslation();
  const isAsking = useSyncExternalStore(
    onToolDecisionsChange,
    () => call.state === "asking" && isAwaitingToolDecision(call.id),
  );
  const [isOpen, setIsOpen] = useState(false);
  const icons = useMcpIcons();
  // Asked by a reply that stopped before the user answered (kept so if Nyra closed meanwhile)
  const state = call.state === "asking" && !isAsking ? "stopped" : call.state;
  const Icon = STATE_ICONS[state];
  const hasArguments = call.arguments.trim() !== "{}";
  const canOpen = !isAsking && (hasArguments || Boolean(call.result));
  // To allow it, the user sees what it would be given
  const showsArguments = hasArguments && (isAsking || isOpen);

  return (
    <section className={`tool-call ${state}`} aria-label={t("mcp.call.label", { tool: call.tool, server: call.serverName })}>
      <button
        type="button"
        className="tool-call-head"
        disabled={!canOpen}
        aria-expanded={canOpen ? isOpen : undefined}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="tool-call-icon" aria-hidden="true">
          <McpIcon icon={icons[call.server]} name={call.serverName} size="small" />
        </span>
        <span className="tool-call-name">
          <b>{call.tool}</b>
          <span>{call.serverName}</span>
        </span>
        <span className="tool-call-state" role="status">
          <Icon size={14} strokeWidth={2.2} className={state === "running" ? "spin" : undefined} aria-hidden="true" />
          {t(`mcp.call.${state}`)}
        </span>
        {canOpen && (
          <ChevronRight
            size={16}
            strokeWidth={2.2}
            aria-hidden="true"
            className={`tool-call-chevron ${isOpen ? "open" : ""}`}
          />
        )}
      </button>
      {showsArguments && <pre className="tool-call-arguments">{call.arguments}</pre>}
      {isAsking && (
        <div className="tool-call-actions">
          <button type="button" className="primary-button small" onClick={() => decideTool(call.id, "once")}>
            {t("mcp.call.allow")}
          </button>
          <button type="button" className="outline-button small" onClick={() => decideTool(call.id, "always")}>
            {t("mcp.call.allowAlways")}
          </button>
          <button type="button" className="outline-button small" onClick={() => decideTool(call.id, "deny")}>
            {t("mcp.call.deny")}
          </button>
        </div>
      )}
      {isOpen && call.result && (
        <pre className={`tool-call-result ${state === "failed" ? "failed" : ""}`}>{call.result}</pre>
      )}
    </section>
  );
}
