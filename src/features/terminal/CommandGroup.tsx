import { SquareTerminal } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CommandRun } from "@/shared/types";
import { CommandCard } from "./CommandCard";
import { CommandCompactRow } from "./CommandCompactRow";
import { CommandOutputViewer } from "./CommandOutputViewer";

type Props = {
  // The commands of one request, in the order they run
  runs: CommandRun[];
};

type Viewing = { run: CommandRun; focus?: { from: number; to: number } };

// The commands of one request where the model asked for them. Several go numbered: only the current one shows its
// whole card, the ones that ran shrink to a line and the ones after it wait in a dashed line.
export function CommandGroup({ runs }: Props) {
  const { t } = useTranslation();
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const view = (run: CommandRun, focus?: { from: number; to: number }) => setViewing({ run, focus });
  // The viewer follows the run as it is now, not as it was when opened
  const current = viewing && (runs.find((r) => r.id === viewing.run.id) ?? viewing.run);
  const viewer = current && <CommandOutputViewer run={current} focus={viewing?.focus} onClose={() => setViewing(null)} />;

  if (runs.length === 1) {
    const [run] = runs;
    return (
      <>
        <CommandCard run={run} onView={(focus) => view(run, focus)} />
        {viewer}
      </>
    );
  }

  return (
    <div className="command-group" role="group" aria-label={t("terminal.group.label", { n: runs.length })}>
      <div className="command-group-head">
        <SquareTerminal size={15} strokeWidth={2} aria-hidden="true" />
        {t("terminal.group.title")} <span>{t("terminal.group.order", { n: runs.length })}</span>
      </div>
      {runs.map((run, i) => (
        <div key={run.id} className="command-group-item">
          <span className="command-number" aria-hidden="true">
            {i + 1}
          </span>
          <div>
            {run.state === "done" || run.state === "queued" ? (
              <CommandCompactRow run={run} onView={() => view(run)} />
            ) : (
              <CommandCard run={run} onView={(focus) => view(run, focus)} />
            )}
          </div>
        </div>
      ))}
      {viewer}
    </div>
  );
}
