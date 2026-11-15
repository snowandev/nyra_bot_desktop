import { Code, Square, SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useElapsedSeconds } from "@/shared/hooks/useElapsedSeconds";
import { formatDuration } from "@/shared/lib/format";
import { stopRunningCommand } from "./commandControl";
import { type ActiveProcess, lastLineOf } from "./processes";
import { runLabel } from "./programs";

type Props = {
  process: ActiveProcess;
  onShowMessage: (index: number) => void;
};

// One command or program still running: what it is, for how long, its last line, and stopping it from here
export function ProcessRow({ process: { run, messageIndex }, onShowMessage }: Props) {
  const { t } = useTranslation();
  const seconds = useElapsedSeconds(true, run.startedAt);
  const Icon = run.code ? Code : SquareTerminal;
  const last = lastLineOf(run.output);
  const state = run.state === "asking" ? t("terminal.processes.asking") : t("terminal.processes.running");
  return (
    <li className="process-row">
      <Icon size={16} strokeWidth={1.9} className="process-icon" aria-hidden="true" />
      <div className="process-text">
        <span className="process-label" title={runLabel(run)}>
          {runLabel(run)}
        </span>
        <span className="process-meta">
          {state} · {formatDuration(seconds * 1000)}
          {run.folder && ` · ${run.folder}`}
        </span>
        {last && (
          <code className="process-last" title={last}>
            {last}
          </code>
        )}
        <div className="process-actions">
          <button type="button" className="outline-button small" onClick={() => void stopRunningCommand(run.id)}>
            <Square size={12} strokeWidth={2.4} aria-hidden="true" />
            {t("terminal.card.stop")}
          </button>
          <button type="button" className="ghost-button small" onClick={() => onShowMessage(messageIndex)}>
            {t("terminal.processes.show")}
          </button>
        </div>
      </div>
    </li>
  );
}
