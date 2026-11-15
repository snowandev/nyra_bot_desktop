import { ArrowDown, ChevronRight, Expand } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CopyButton } from "@/shared/ui/CopyButton";
import type { CommandRun } from "@/shared/types";

type Props = {
  run: CommandRun;
  onView: () => void;
};

// Lines shown when a finished output unfolds: the end, where the summary and the errors usually are
const LAST_LINES = 10;
const LAST_LINES_FAILED = 8;
// Within this of the end, the output keeps following what arrives
const FOLLOW_PX = 12;
// While it runs only its end is drawn: a long output drawn whole on every frame slows the whole window
const LIVE_LINES = 400;

function lastLines(output: string, count: number) {
  const lines = output.replace(/\n$/, "").split("\n");
  return { text: lines.slice(-count).join("\n"), before: Math.max(0, lines.length - count) };
}

// The text from where its last lines start, found from the end without splitting the whole output
function liveEnd(output: string, count: number) {
  let at = output.length;
  for (let found = 0; found < count && at > 0; found++) at = output.lastIndexOf("\n", at - 1);
  return at <= 0 ? output : output.slice(at + 1);
}

// While it runs: its last lines, following the end unless the user scrolls up to read. Once it ends: folded with
// its number of lines, or open on its last lines when it failed.
export function CommandOutput({ run, onView }: Props) {
  const { t } = useTranslation();
  const isLive = run.state === "running" || run.state === "asking";
  const [isOpen, setIsOpen] = useState(run.state === "failed");
  const [isFollowing, setIsFollowing] = useState(true);
  const pre = useRef<HTMLPreElement>(null);
  const output = run.output ?? "";

  useLayoutEffect(() => {
    if (isLive && isFollowing && pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [output, isLive, isFollowing]);

  if (isLive) {
    const end = liveEnd(output, LIVE_LINES);
    const lines = end.split("\n");
    const question = run.state === "asking" ? lines.pop() : undefined;
    const before = Math.max(0, (run.lines ?? 0) - LIVE_LINES);
    return (
      <div className="command-output">
        {before > 0 && <span className="earlier">{t("terminal.output.earlier", { count: before })}</span>}
        <pre
          ref={pre}
          tabIndex={0}
          aria-label={t("terminal.output.live")}
          onScroll={(e) => {
            const el = e.currentTarget;
            setIsFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_PX);
          }}
        >
          {question === undefined ? end : lines.join("\n") + (lines.length > 0 ? "\n" : "")}
          {question !== undefined && <span className="question">{question}</span>}
        </pre>
        {!isFollowing && (
          <button type="button" className="command-to-end" onClick={() => setIsFollowing(true)}>
            <ArrowDown size={12} strokeWidth={2.2} aria-hidden="true" />
            {t("terminal.output.toEnd")}
          </button>
        )}
      </div>
    );
  }

  const total = run.lines ?? 0;
  const shown = lastLines(output, run.state === "failed" ? LAST_LINES_FAILED : LAST_LINES);
  return (
    <div className="command-output">
      <div className="command-output-head">
        <button type="button" className="command-fold" aria-expanded={isOpen} onClick={() => setIsOpen((open) => !open)}>
          <ChevronRight size={13} strokeWidth={2.2} aria-hidden="true" />
          {t("terminal.output.lines", { count: total })}
        </button>
        <span className="spacer" />
        <CopyButton label={t("terminal.output.copy")} text={output} />
        <button type="button" className="ghost-button small" onClick={onView}>
          <Expand size={13} strokeWidth={2} aria-hidden="true" />
          {t("terminal.output.viewAll")}
        </button>
      </div>
      {isOpen && (
        <>
          {shown.before > 0 && <span className="earlier">{t("terminal.output.earlier", { count: shown.before })}</span>}
          <pre tabIndex={0} aria-label={t("terminal.output.lastLines")}>
            {shown.text || t("terminal.output.empty")}
          </pre>
        </>
      )}
    </div>
  );
}
