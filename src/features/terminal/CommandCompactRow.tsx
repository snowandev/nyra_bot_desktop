import { Check, CodeXml, Eye, SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDuration } from "@/shared/lib/format";
import type { CommandRun } from "@/shared/types";
import { CommandText } from "./CommandText";
import { runLabel } from "./programs";

type Props = {
  run: CommandRun;
  onView: () => void;
};

// A command of a group that already ran well or waits for the one before, in a single line
export function CommandCompactRow({ run, onView }: Props) {
  const { t } = useTranslation();
  return (
    <div className={`command-compact ${run.state === "queued" ? "queued" : ""}`}>
      {run.code ? (
        <>
          <CodeXml size={14} strokeWidth={2} aria-hidden="true" />
          <code>{runLabel(run)}</code>
        </>
      ) : (
        <>
          <SquareTerminal size={14} strokeWidth={2} aria-hidden="true" />
          <CommandText command={run.command} />
        </>
      )}
      {run.state === "done" ? (
        <>
          <span className="command-state done">
            <Check size={12} strokeWidth={2.4} aria-hidden="true" />
            {formatDuration(run.durationMs ?? 0)}
          </span>
          <button type="button" className="icon-button small" aria-label={t("terminal.compact.viewOutput", { command: runLabel(run) })} onClick={onView}>
            <Eye size={15} strokeWidth={2} />
          </button>
        </>
      ) : (
        <span className="command-state pending">{t("terminal.card.queued")}</span>
      )}
    </div>
  );
}
