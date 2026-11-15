import { ChevronRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "@/shared/lib/errors";
import { mcpLog } from "./mcpStorage";

type Props = {
  serverId: string;
  // Changes when the server starts, fails or connects again: an open log reads again then
  status: string;
};

// What the server wrote on its error output, to see why it fails (a login, Docker, a token); folded until asked for
export function McpServerLog({ serverId, status }: Props) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const textRef = useRef<HTMLPreElement>(null);

  const read = useCallback(() => {
    mcpLog(serverId)
      .then(setLog)
      .catch((e) => setLog(errorMessage(e)));
  }, [serverId]);

  useEffect(() => {
    if (isOpen) read();
  }, [isOpen, read, status]);

  // The newest is last: it opens there
  useEffect(() => {
    if (textRef.current) textRef.current.scrollTop = textRef.current.scrollHeight;
  }, [log]);

  return (
    <div className="mcp-log">
      <div className="mcp-log-head">
        <button type="button" className="mcp-log-toggle" aria-expanded={isOpen} onClick={() => setIsOpen(!isOpen)}>
          <ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" className={isOpen ? "open" : undefined} />
          {t("mcp.settings.log")}
        </button>
        {isOpen && (
          <button type="button" className="icon-button small" aria-label={t("mcp.settings.logRefresh")} onClick={read}>
            <RefreshCw size={14} strokeWidth={2} />
          </button>
        )}
      </div>
      {isOpen && log !== null && (
        <pre ref={textRef} className="mcp-log-text">
          {log.trim() || t("mcp.settings.logEmpty")}
        </pre>
      )}
    </div>
  );
}
