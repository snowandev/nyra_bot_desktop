import { MessageCircleQuestion, SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CommandRun } from "@/shared/types";
import { goToCommand, useIsOutOfView } from "./commandVisibility";
import { runLabel } from "./programs";

type Props = {
  // The command waiting for permission, running or asking something, if any
  run: CommandRun | undefined;
};

// Above the composer while the command that needs the user has scrolled out of view
export function CommandReminder({ run }: Props) {
  const { t } = useTranslation();
  const isOutOfView = useIsOutOfView(run?.id);
  if (!run || !isOutOfView) return null;
  const go = () => goToCommand(run.id);

  if (run.state === "asking") {
    return (
      <div className="command-reminder asking" role="status">
        <MessageCircleQuestion size={15} strokeWidth={2} aria-hidden="true" />
        <span className="text">
          <code>{runLabel(run)}</code> {t("terminal.reminder.asking")}
        </span>
        <button type="button" className="outline-button small" onClick={go}>
          {t("terminal.reminder.answer")}
        </button>
      </div>
    );
  }
  if (run.state === "running") {
    return (
      <div className="command-reminder running" role="status">
        <span className="command-spinner" aria-hidden="true" />
        <span className="text">
          <code>{runLabel(run)}</code> {t("terminal.reminder.running")}
        </span>
        <button type="button" className="ghost-button small" onClick={go}>
          {t("terminal.view")}
        </button>
      </div>
    );
  }
  return (
    <div className="command-reminder" role="status">
      <SquareTerminal size={15} strokeWidth={2} aria-hidden="true" />
      <span className="text">
        <b>{t("terminal.reminder.pendingBefore")}</b> <code>{runLabel(run)}</code> {t("terminal.reminder.pendingAfter")}
      </span>
      <button type="button" className="primary-button small" onClick={go}>
        {t("terminal.reminder.goTo")}
      </button>
    </div>
  );
}
