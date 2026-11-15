import { Check, ChevronDown, FolderSearch, Layers, Lock, NotebookPen, RefreshCw, TriangleAlert } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { i18n } from "@/shared/i18n/i18n";
import { formatBytes, formatNumber } from "@/shared/lib/format";
import { SKIP_REASON_LABEL, type WorkspaceChanges } from "./workspace";
import type { WorkspaceStep } from "./workspaceTools";

type Props = {
  steps: WorkspaceStep[];
};

// Past this many, the first steps fold into "N pasos antes"
const VISIBLE_STEPS = 5;

const t = i18n.t;
const mono = { path: <span className="mono" />, command: <span className="mono" /> };
// A step's sentence, with the paths and commands it names in code style
const sentence = (key: StepSentence, values: Record<string, string | number>) => (
  <Trans i18nKey={key} values={values} components={mono} />
);
type StepSentence =
  | "workspace.steps.changedSinceRead"
  | "workspace.steps.opening"
  | "workspace.steps.outline"
  | "workspace.steps.outlineAll"
  | "workspace.steps.searching"
  | "workspace.steps.searchingMeaning"
  | "workspace.steps.readingLines"
  | "workspace.steps.reading"
  | "workspace.steps.notRead"
  | "workspace.steps.ran"
  | "workspace.steps.outputRead"
  | "workspace.steps.outputSearch";

function changesLabel(changes: WorkspaceChanges) {
  const parts = [
    changes.modified > 0 && t("workspace.steps.modified", { count: changes.modified }),
    changes.added > 0 && t("workspace.steps.added", { count: changes.added }),
    changes.removed > 0 && t("workspace.steps.removed", { count: changes.removed }),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : t("workspace.steps.noChanges");
}

function linesLabel(lines: { from: number; to: number; total: number }) {
  return t("workspace.steps.linesOf", { shown: formatNumber(lines.to - lines.from + 1), total: formatNumber(lines.total) });
}

// "3 matches in 2 files"
const inFiles = (what: string, files: number | undefined) =>
  t("workspace.inFiles", { what, files: t("workspace.files", { count: files ?? 0 }) });

type Tone = "changed" | "skipped" | "note" | "compacted" | "failed";

function describe(step: WorkspaceStep): { text: ReactNode; detail?: string; tone?: Tone } {
  switch (step.kind) {
    case "changes":
      // The first message of the conversation has nothing to compare with
      if (step.done && !step.changes) return { text: t("workspace.steps.ready") };
      return { text: t("workspace.steps.checking"), detail: step.changes ? changesLabel(step.changes) : undefined };
    case "note":
      return { text: step.text, tone: "note" };
    case "compacted":
      return {
        text: t("workspace.steps.compacting"),
        detail: t("workspace.steps.compactedDetail", { count: step.count }),
        tone: "compacted",
      };
    case "changedSinceRead":
      return { text: sentence("workspace.steps.changedSinceRead", { path: step.path }), tone: "changed" };
    case "list":
      return {
        text: sentence("workspace.steps.opening", { path: `${step.folder}/` }),
        detail: step.count === undefined ? undefined : t("workspace.files", { count: step.count }),
      };
    case "outline":
      return {
        text: step.folder
          ? sentence("workspace.steps.outline", { path: step.folder })
          : sentence("workspace.steps.outlineAll", {}),
        detail:
          step.count === undefined
            ? undefined
            : inFiles(t("workspace.steps.definitions", { count: step.count }), step.files),
      };
    case "grep": {
      const found =
        step.total === undefined
          ? undefined
          : step.total === 0
            ? t("workspace.steps.noMatches")
            : inFiles(t("workspace.matches", { count: step.total }), step.files);
      return { text: sentence("workspace.steps.searching", { query: `"${step.query}"` }), detail: found };
    }
    case "find": {
      const found =
        step.total === undefined
          ? undefined
          : step.total === 0
            ? t("workspace.steps.nothingSimilar")
            : inFiles(t("workspace.fragments", { count: step.total }), step.files);
      return { text: sentence("workspace.steps.searchingMeaning", { query: `"${step.query}"` }), detail: found };
    }
    case "read":
      return {
        text: step.lines
          ? sentence("workspace.steps.readingLines", { from: step.lines.from, to: step.lines.to, path: step.path })
          : sentence("workspace.steps.reading", { path: step.path }),
        detail: [
          step.lines ? linesLabel(step.lines) : step.size === undefined ? undefined : formatBytes(step.size),
          step.ignored && t("workspace.steps.ignoredByGit"),
          step.hiddenSecrets && t("workspace.steps.hiddenSecrets", { count: step.hiddenSecrets }),
        ]
          .filter(Boolean)
          .join(" · "),
      };
    case "skipped":
      return {
        text: sentence("workspace.steps.notRead", { path: step.path }),
        detail: SKIP_REASON_LABEL[step.reason],
        tone: "skipped",
      };
    case "command":
      return {
        text: sentence("workspace.steps.ran", { command: step.command }),
        detail: step.lines === undefined ? undefined : t("workspace.steps.outputLines", { count: step.lines }),
      };
    case "outputRead":
      return {
        text: sentence("workspace.steps.outputRead", {
          from: formatNumber(step.from),
          to: formatNumber(step.to),
          command: step.command,
        }),
      };
    case "outputSearch":
      return {
        text: sentence("workspace.steps.outputSearch", { query: `"${step.query}"`, command: step.command }),
        detail:
          step.total === undefined
            ? undefined
            : step.total === 0
              ? t("workspace.steps.noMatches")
              : t("workspace.matches", { count: step.total }),
      };
  }
}

// What it was going to do stays, with why it couldn't
function describeWithError(step: WorkspaceStep) {
  const described = describe(step);
  return step.error ? { ...described, detail: step.error, tone: "failed" as const } : described;
}

function iconOf(tone: Tone | undefined) {
  switch (tone) {
    case "failed":
      return TriangleAlert;
    case "skipped":
      return Lock;
    case "changed":
      return RefreshCw;
    case "note":
      return NotebookPen;
    case "compacted":
      return Layers;
    default:
      return Check;
  }
}

// What the reply is doing in the folder while it works: one line with the current step, like "Pensando…", that
// unfolds into the list of steps
export function WorkspaceSteps({ steps }: Props) {
  // Also draws the steps again when the language changes
  useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const listId = useId();
  const hidden = Math.max(0, steps.length - VISIBLE_STEPS);
  const current = describeWithError(steps[steps.length - 1]).text;

  return (
    <>
      <button
        type="button"
        className="reply-summary"
        aria-expanded={isExpanded}
        aria-controls={listId}
        onClick={() => setIsExpanded((open) => !open)}
      >
        <FolderSearch size={15} strokeWidth={2} className="reply-summary-icon workspace thinking" />
        <span>{t("workspace.steps.consulting")}</span>
        {/* Each new step is announced */}
        <span className="reply-summary-detail" role="status" aria-live="polite">
          · {current}
        </span>
        <ChevronDown size={14} strokeWidth={2} className="reply-summary-chevron" />
      </button>
      {isExpanded && (
        <ol className="workspace-steps" id={listId} aria-label={t("workspace.steps.label")}>
          {hidden > 0 && <li className="workspace-step earlier">{t("workspace.steps.earlier", { count: hidden })}</li>}
          {steps.slice(hidden).map((step, i) => {
            const { text, detail, tone } = describeWithError(step);
            const Icon = iconOf(tone);
            return (
              <li key={hidden + i} className={`workspace-step ${tone ?? ""} ${step.done ? "" : "running"}`}>
                {step.done ? (
                  <Icon size={13} strokeWidth={2.2} aria-hidden="true" />
                ) : (
                  <span className="workspace-spinner" aria-hidden="true" />
                )}
                <span className="workspace-step-text">{text}</span>
                {detail && <span className="workspace-step-detail">· {detail}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
