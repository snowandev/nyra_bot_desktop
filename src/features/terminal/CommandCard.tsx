import { Ban, Check, CodeXml, Folder, Layers, MessageCircleQuestion, Pencil, Play, Square, SquareTerminal, TriangleAlert, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { formatDuration } from "@/shared/lib/format";
import { useElapsedSeconds } from "@/shared/hooks/useElapsedSeconds";
import { modifierLabel, platformName } from "@/shared/lib/platform";
import { HighlightedCode } from "@/features/markdown/HighlightedCode";
import type { CommandRun } from "@/shared/types";
import { approveCommand, isAwaitingDecision, onDecisionsChange, rejectCommand, stopRunningCommand } from "./commandControl";
import { codeRisk, commandRisk, riskText } from "./commandRisks";
import { CodeFiles } from "./CodeFiles";
import { languageName, runLabel } from "./programs";
import { useTrackVisibility } from "./commandVisibility";
import { CommandAnswer } from "./CommandAnswer";
import { CommandOutput } from "./CommandOutput";
import { CommandText } from "./CommandText";
import { OutputReads } from "./OutputReads";
import { SkillScriptViewer } from "./SkillScriptViewer";
import { skillScriptIn, withoutSkillFolders } from "./skillScripts";
import { useSkillsContext } from "@/features/skills/skillsContext";
import { endingOf } from "./outputText";

type Props = {
  run: CommandRun;
  // The whole output, or the lines the model read
  onView: (range?: { from: number; to: number }) => void;
};

// Why a command that couldn't run failed; a code other than 0 says it in its own tag
const FAILED_KEY = {
  notFound: "terminal.card.notFound",
  notRunnable: "terminal.card.notRunnable",
  noStart: "terminal.card.notRunnable",
} as const;

// What a screen reader announces as the card changes
const ANNOUNCED = ["pending", "running", "asking", "done", "failed", "stopped"] as const;
const isAnnounced = (state: CommandRun["state"]): state is (typeof ANNOUNCED)[number] =>
  (ANNOUNCED as readonly string[]).includes(state);

// The lines a program's editor opens with, so it shows the program without a field that fills the window
const EDITOR_ROWS = 14;

// One command or program of a reply: nothing runs until the user presses «Ejecutar». Dashed while nothing ran, solid
// after.
export function CommandCard({ run, onView }: Props) {
  const { t } = useTranslation();
  const card = useRef<HTMLElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const program = run.code;
  // What runs: the command line, or the program's source
  const [command, setCommand] = useState(program?.source ?? run.command);
  const [edited, setEdited] = useState(false);
  const [isReadingScript, setIsReadingScript] = useState(false);
  // Ticking each second while it runs; exact once it ended
  const ticking = useElapsedSeconds(run.state === "running", run.startedAt);
  const elapsed = run.durationMs ?? ticking * 1000;
  useTrackVisibility(card, run.id);
  const isEditing = draft !== null;
  // The field takes the place of the command, where the user pressed «Editar»
  useEffect(() => {
    if (isEditing) editor.current?.focus();
  }, [isEditing]);
  const { state } = run;
  // Followed, so the buttons go as soon as the reply that asked stops
  const isWaiting = useSyncExternalStore(onDecisionsChange, () => state === "pending" && isAwaitingDecision(run.id));
  const ran = state === "running" || state === "asking" || state === "done" || state === "failed" || state === "stopped";
  const shown = state === "pending" ? command : (program?.source ?? run.command);
  const { skills } = useSkillsContext();
  // A skill's script: its folder doesn't count as leaving the connected one, and it can be read before it runs
  const script = program ? null : skillScriptIn(shown, skills);
  const beforeRunning = state === "pending" || state === "queued";
  const risk = !beforeRunning
    ? null
    : program
      ? codeRisk(shown)
      : commandRisk(shown, withoutSkillFolders(shown, skills));
  const where = program ? ` · ${languageName(program.language)}` : platformName === "windows" ? " · PowerShell" : "";
  const label = runLabel(run);
  const texts = program ? "terminal.code" : "terminal.card";

  if (state === "rejected") {
    return (
      <div className="command-quiet rejected" role="note">
        <Ban size={14} strokeWidth={2} aria-hidden="true" />
        <span>{t(run.answer ? "terminal.card.answeredInstead" : "terminal.card.rejected")}</span>
        <code>{label}</code>
        {run.answer && <q className="command-answer">{run.answer}</q>}
      </div>
    );
  }

  function saveDraft() {
    // A program keeps its indentation; only what trails it goes
    const value = program ? (draft ?? "").replace(/\s+$/, "") : (draft ?? "").trim();
    if (!value.trim()) return;
    if (value !== command) {
      setCommand(value);
      setEdited(true);
    }
    setDraft(null);
  }

  const ending = endingOf(run.exitCode);
  const failure = ending === "ok" || ending === "nonZero" ? null : ending;
  const stateTag: Record<CommandRun["state"], ReactNode> = {
    queued: <span className="command-state pending">{t("terminal.card.queued")}</span>,
    pending: risk ? (
      <span className="command-state attention">
        <TriangleAlert size={12} strokeWidth={2.2} aria-hidden="true" />
        {t("terminal.card.review")}
      </span>
    ) : (
      <span className="command-state pending">{t("terminal.card.waiting")}</span>
    ),
    running: (
      <span className="command-state running">
        <span className="command-spinner" aria-hidden="true" />
        {t("terminal.card.running", { time: formatDuration(Math.floor(elapsed / 1000) * 1000) })}
      </span>
    ),
    asking: (
      <span className="command-state attention">
        <MessageCircleQuestion size={12} strokeWidth={2.2} aria-hidden="true" />
        {t("terminal.card.asking")}
      </span>
    ),
    done: (
      <span className="command-state done">
        <Check size={12} strokeWidth={2.4} aria-hidden="true" />
        {t("terminal.card.done", { time: formatDuration(elapsed) })}
      </span>
    ),
    failed:
      ending === "nonZero" ? (
        <span className="command-state attention" title={t("terminal.card.nonZeroHelp")}>
          <TriangleAlert size={12} strokeWidth={2.2} aria-hidden="true" />
          {t("terminal.card.nonZero", { code: run.exitCode, time: formatDuration(elapsed) })}
        </span>
      ) : (
        <span className="command-state failed">
          <X size={12} strokeWidth={2.4} aria-hidden="true" />
          {failure && t(FAILED_KEY[failure])}
          {run.exitCode !== undefined && ` · ${t("terminal.card.code", { code: run.exitCode })}`} ·{" "}
          {formatDuration(elapsed)}
        </span>
      ),
    stopped: (
      <span className="command-state">
        <Square size={10} strokeWidth={2.4} aria-hidden="true" />
        {t("terminal.card.stopped", { time: formatDuration(elapsed) })}
      </span>
    ),
    rejected: null,
  };

  const tone = ran ? "ran" : risk ? "attention" : "";
  return (
    <section
      ref={card}
      id={run.id}
      className={`command-card ${tone} ${state === "asking" ? "attention" : ""}`}
      aria-label={t("terminal.card.label", { command: label })}
    >
      <div className="command-head">
        <span className="command-icon">
          {program ? (
            <CodeXml size={16} strokeWidth={2} aria-hidden="true" />
          ) : (
            <SquareTerminal size={16} strokeWidth={2} aria-hidden="true" />
          )}
        </span>
        <span className="command-title">
          <b>{beforeRunning ? t(`${texts}.titlePending`) : t(`${texts}.title`)}</b>
          <small>
            <Folder size={12} strokeWidth={2} aria-hidden="true" />
            {t("terminal.card.in")}{" "}
            <span className="command-folder" title={run.root}>
              {run.folder}
            </span>
            {where}
            {script && (
              <span className="command-skill">
                · {t("terminal.card.skillScript", { name: script.skill.name })}
                {script.path && (
                  <button type="button" onClick={() => setIsReadingScript(true)}>
                    {t("terminal.card.viewScript")}
                  </button>
                )}
              </span>
            )}
          </small>
        </span>
        {stateTag[state]}
      </div>

      {program && draft !== null && (
        <div className="command-line editing">
          <textarea
            aria-label={t("terminal.code.editLabel")}
            rows={Math.min(EDITOR_ROWS, Math.max(3, draft.split("\n").length))}
            spellCheck={false}
            value={draft}
            ref={editor}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                saveDraft();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setDraft(null);
              }
            }}
          />
        </div>
      )}
      {program && draft === null && (
        <div className="command-code">
          <HighlightedCode code={shown} language={program.language} />
          {(edited || run.edited) && <span className="command-state command-edited">{t("terminal.card.editedByYou")}</span>}
        </div>
      )}

      {program ? null : draft !== null ? (
        <div className="command-line editing">
          <span className="command-prompt" aria-hidden="true">
            $
          </span>
          <textarea
            aria-label={t("terminal.card.editLabel")}
            rows={1}
            spellCheck={false}
            value={draft}
            ref={editor}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                saveDraft();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setDraft(null);
              }
            }}
          />
        </div>
      ) : (
        <div className="command-line">
          <span className="command-prompt" aria-hidden="true">
            $
          </span>
          <CommandText command={shown} mark={risk?.mark} />
          {(edited || run.edited) && <span className="command-state command-edited">{t("terminal.card.editedByYou")}</span>}
          {run.background && (
            <span className="command-state command-background" title={t("terminal.card.backgroundHelp")}>
              <Layers size={12} strokeWidth={2.2} aria-hidden="true" />
              {t("terminal.card.background")}
            </span>
          )}
        </div>
      )}

      {risk && draft === null && (
        <div className="command-risk" role="note">
          <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />
          <div>
            <b>{riskText(risk, run.folder).title}</b> {riskText(risk, run.folder).detail}
          </div>
        </div>
      )}

      {ran && <CommandOutput run={run} onView={() => onView()} />}
      {program && run.files && run.files.length > 0 && (
        <CodeFiles conversationId={program.conversationId} files={run.files} />
      )}
      {state === "asking" && <CommandAnswer id={run.id} isSecret={!!run.hiddenInput} />}

      {isWaiting && draft === null && (
        <div className="command-actions">
          <button
            type="button"
            className={risk ? "outline-button small" : "primary-button small"}
            data-command-focus
            onClick={() => approveCommand(run.id, command, edited)}
          >
            <Play size={13} strokeWidth={2.2} aria-hidden="true" />
            {t("terminal.card.run")}
          </button>
          <button type="button" className="outline-button small" onClick={() => rejectCommand(run.id)}>
            <Ban size={14} strokeWidth={2} aria-hidden="true" />
            {t("terminal.card.reject")}
          </button>
          <span className="spacer" />
          <button
            type="button"
            className="ghost-button small"
            aria-label={t(`${texts}.editBefore`)}
            onClick={() => setDraft(command)}
          >
            <Pencil size={14} strokeWidth={2} aria-hidden="true" />
            {t("terminal.card.edit")}
          </button>
        </div>
      )}
      {isWaiting && draft !== null && (
        <div className="command-actions">
          <button type="button" className="primary-button small" onClick={saveDraft}>
            <Check size={14} strokeWidth={2.2} aria-hidden="true" />
            {t(`${texts}.useThis`)}
          </button>
          <button type="button" className="ghost-button small" onClick={() => setDraft(null)}>
            {t("terminal.card.cancel")}
          </button>
          <span className="spacer" />
          <span className="command-help">
            {program ? t("terminal.code.editHelp", { modifier: modifierLabel }) : t("terminal.card.editHelp")}
          </span>
        </div>
      )}
      {state === "running" && (
        <div className="command-actions">
          <button type="button" className="outline-button small" data-command-focus onClick={() => void stopRunningCommand(run.id)}>
            <Square size={12} strokeWidth={2.4} aria-hidden="true" />
            {t("terminal.card.stop")}
          </button>
          <span className="spacer" />
          <span className="command-help">
            {run.detached
              ? t("terminal.card.detachedHelp")
              : run.background
                ? t("terminal.card.backgroundHelp")
                : t("terminal.card.noTimeLimit")}
          </span>
        </div>
      )}
      {state === "asking" && (
        <div className="command-actions">
          <button type="button" className="ghost-button small" onClick={() => void stopRunningCommand(run.id)}>
            <Square size={12} strokeWidth={2.4} aria-hidden="true" />
            {t("terminal.card.stop")}
          </button>
        </div>
      )}
      <OutputReads reads={run.reads ?? []} onView={onView} />
      {isReadingScript && script?.path && (
        <SkillScriptViewer skill={script.skill.name} path={script.path} onClose={() => setIsReadingScript(false)} />
      )}
      <span className="visually-hidden" role="status">
        {isAnnounced(state) ? t(`${texts}.announce.${state}`) : ""}
      </span>
    </section>
  );
}
