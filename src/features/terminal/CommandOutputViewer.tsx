import { Rows3, Save, Search, X } from "lucide-react";
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CopyButton } from "@/shared/ui/CopyButton";
import { Dialog } from "@/shared/ui/Dialog";
import { errorMessage } from "@/shared/lib/errors";
import { formatNumber } from "@/shared/lib/format";
import { MAX_KEPT_LINES } from "./outputText";
import { saveCommandOutput } from "./terminalStorage";
import type { CommandRun } from "@/shared/types";
import { runLabel } from "./programs";

type Props = {
  run: CommandRun;
  // Opens on these lines, highlighted: a part the model read
  focus?: { from: number; to: number };
  onClose: () => void;
};

// How it ended, next to its number of lines
const ENDED = ["done", "failed", "stopped"] as const;
const hasEnded = (state: CommandRun["state"]): state is (typeof ENDED)[number] =>
  (ENDED as readonly string[]).includes(state);

function highlighted(line: string, query: string) {
  if (!query) return line;
  const lower = line.toLowerCase();
  const needle = query.toLowerCase();
  if (!lower.includes(needle)) return line;
  const parts: (string | React.ReactElement)[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    parts.push(line.slice(from, at), <mark key={at}>{line.slice(at, at + needle.length)}</mark>);
    from = at + needle.length;
  }
  parts.push(line.slice(from));
  return parts;
}

// The whole output over the chat, with line numbers, search, copy and save; Esc closes it
export function CommandOutputViewer({ run, focus, onClose }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const linesBox = useRef<HTMLPreElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const output = run.output ?? "";
  const lines = useMemo(() => output.replace(/\n$/, "").split("\n"), [output]);
  const reads = useMemo(() => run.reads ?? [], [run.reads]);
  // Up to 50,000 lines: the search marks them once the user pauses, so typing stays smooth
  const shownQuery = useDeferredValue(query);
  const drawnLines = useMemo(() => {
    const isRead = (n: number) => reads.some((r) => n >= r.from && n <= r.to);
    return lines.map((line, i) => (
      <span key={i} className={isRead(i + 1) ? "read" : undefined}>
        <i>{i + 1}</i>
        {highlighted(line, shownQuery)}
      </span>
    ));
  }, [lines, reads, shownQuery]);

  useEffect(() => {
    if (!focus || !linesBox.current) return;
    const line = linesBox.current.children[Math.max(0, focus.from - 4)];
    if (line instanceof HTMLElement) linesBox.current.scrollTop = line.offsetTop - 10;
  }, [focus]);

  useEffect(() => {
    if (shownQuery) linesBox.current?.querySelector("mark")?.scrollIntoView({ block: "center" });
  }, [shownQuery]);

  async function save() {
    setSaveError(null);
    try {
      await saveCommandOutput(t("terminal.viewer.file"), output);
    } catch (e) {
      setSaveError(errorMessage(e));
    }
  }

  return (
    <Dialog onClose={onClose} labelledBy={titleId} className="command-viewer">
      <div className="command-viewer-head">
        <span className="title">
          <b id={titleId}>
            {t("terminal.viewer.titlePrefix")} <span className="mono">{runLabel(run)}</span>
          </b>
          <small>
            {t("terminal.viewer.lines", { count: run.lines ?? lines.length })}
            {hasEnded(run.state) && ` · ${t(`terminal.viewer.${run.state}`)}`}
          </small>
        </span>
        <label className="command-viewer-search">
          <Search size={14} strokeWidth={2} aria-hidden="true" />
          <span className="visually-hidden">{t("terminal.viewer.searchLabel")}</span>
          <input
            ref={search}
            data-autofocus
            type="search"
            placeholder={t("terminal.viewer.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button type="button" className="icon-button small" aria-label={t("terminal.close")} title={t("terminal.close")} onClick={onClose}>
          <X size={16} strokeWidth={2} />
        </button>
      </div>
      <pre ref={linesBox} className="command-viewer-lines" tabIndex={0} aria-label={t("terminal.viewer.full")}>
        {drawnLines}
      </pre>
      <div className="command-viewer-foot">
        {saveError ? (
          <span role="alert">{saveError}</span>
        ) : reads.length > 0 ? (
          <span>
            <Rows3 size={12} strokeWidth={2} aria-hidden="true" /> {t("terminal.viewer.highlighted")}
          </span>
        ) : (
          <span>{t("terminal.viewer.keptUpTo", { lines: formatNumber(MAX_KEPT_LINES) })}</span>
        )}
        <span className="spacer" />
        <CopyButton label={t("terminal.viewer.copyAll")} text={output} showLabel />
        <button type="button" className="ghost-button small" onClick={() => void save()}>
          <Save size={13} strokeWidth={2} aria-hidden="true" />
          {t("terminal.viewer.saveAs")}
        </button>
      </div>
    </Dialog>
  );
}
