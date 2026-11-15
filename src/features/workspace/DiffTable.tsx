import { ChevronsUpDown } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@/shared/lib/format";
import { type DiffLine, type DiffRow, differingPart } from "./fileChanges";

type Props = {
  rows: DiffRow[];
  view: "split" | "unified";
  // The change the arrows move through, marked on its lines
  currentBlock: number;
  onExpand: (key: string) => void;
  // For the ids the navigation scrolls to
  idPrefix: string;
  // A block that doesn't match the file: what Nyra expected to find, shown under its header
  failed?: { block: number; expected: string };
  // A new file: one header for all of it
  isNewFile: boolean;
};

type UnifiedLine = { kind: "line"; side: "removed" | "added"; block: number; line: DiffLine; pair?: DiffLine };

// In one column, each change shows its removed lines first and then its added ones
function unifiedRows(rows: DiffRow[]): (DiffRow | UnifiedLine)[] {
  const out: (DiffRow | UnifiedLine)[] = [];
  let changes: Extract<DiffRow, { kind: "change" }>[] = [];
  const flush = () => {
    for (const r of changes) if (r.removed) out.push({ kind: "line", side: "removed", block: r.block, line: r.removed, pair: r.added });
    for (const r of changes) if (r.added) out.push({ kind: "line", side: "added", block: r.block, line: r.added, pair: r.removed });
    changes = [];
  };
  for (const row of rows) {
    if (row.kind === "change") {
      changes.push(row);
      continue;
    }
    flush();
    out.push(row);
  }
  flush();
  return out;
}

// The sign has its own column and is read out, so added and removed never depend on color alone
function Sign({ side }: { side: "removed" | "added" }) {
  const { t } = useTranslation();
  return (
    <>
      {side === "removed" ? "−" : "+"}
      <span className="visually-hidden"> {side === "removed" ? t("changes.review.removed") : t("changes.review.added")}</span>
    </>
  );
}

// Inside a changed line, the part that differs from its pair
function marked(line: DiffLine, pair: DiffLine | undefined): ReactNode {
  if (!pair) return line.text;
  const { before, changed, after } = differingPart(line.text, pair.text);
  if (!changed || (!before && !after)) return line.text;
  return (
    <>
      {before}
      <mark>{changed}</mark>
      {after}
    </>
  );
}

export function DiffTable({ rows, view, currentBlock, onExpand, idPrefix, failed, isNewFile }: Props) {
  const { t } = useTranslation();
  const split = view === "split";
  const columns = split ? 6 : 4;
  const current = (block: number) => (block === currentBlock ? "current" : "");

  function render(row: DiffRow | UnifiedLine, key: number): ReactNode {
    switch (row.kind) {
      case "header":
        return (
          <Fragment key={key}>
            <tr className={`diff-header ${current(row.block)}`} id={`${idPrefix}-block-${row.block}`}>
              <td colSpan={columns}>
                <span className="diff-header-mark">
                  <i aria-hidden="true" />
                  {isNewFile
                    ? t("changes.diff.wholeContent")
                    : t("changes.diff.blockHeader", {
                        block: row.block + 1,
                        total: row.total,
                        line: formatNumber(row.line),
                      })}
                </span>
              </td>
            </tr>
            {failed?.block === row.block && (
              <tr className="diff-failed">
                <td colSpan={columns}>
                  <div className="diff-failed-box" role="note">
                    <strong>{t("changes.diff.notFit")}</strong> {t("changes.diff.notFitExplain")}
                    <small>{t("changes.review.expected")}</small>
                    <pre>{failed.expected}</pre>
                  </div>
                </td>
              </tr>
            )}
          </Fragment>
        );
      case "fold":
        return (
          <tr key={key} className="diff-fold">
            <td colSpan={columns}>
              <button
                type="button"
                aria-label={t("changes.diff.showUnchanged", { count: row.count, from: row.from })}
                onClick={() => onExpand(row.key)}
              >
                <ChevronsUpDown size={14} strokeWidth={2} aria-hidden="true" />
                {t("changes.diff.fold", { count: row.count })}
              </button>
            </td>
          </tr>
        );
      case "context":
        return split ? (
          <tr key={key} className="diff-context">
            <td className="n">{row.a}</td>
            <td className="g" />
            <td className="c">{row.text}</td>
            <td className="n side">{row.b}</td>
            <td className="g" />
            <td className="c">{row.text}</td>
          </tr>
        ) : (
          <tr key={key} className="diff-context">
            <td className="n">{row.a}</td>
            <td className="n">{row.b}</td>
            <td className="g" />
            <td className="c">{row.text}</td>
          </tr>
        );
      case "line":
        return (
          <tr key={key} className={`diff-line ${row.side} ${current(row.block)}`}>
            <td className="n">{row.side === "removed" ? row.line.n : ""}</td>
            <td className="n">{row.side === "added" ? row.line.n : ""}</td>
            <td className="g">
              <Sign side={row.side} />
            </td>
            <td className="c">{marked(row.line, row.pair)}</td>
          </tr>
        );
      case "change":
        return (
          <tr key={key} className={`diff-change ${current(row.block)}`}>
            {row.removed ? (
              <>
                <td className="n removed">{row.removed.n}</td>
                <td className="g removed">
                  <Sign side="removed" />
                </td>
                <td className="c removed">{marked(row.removed, row.added)}</td>
              </>
            ) : (
              <td className="empty" colSpan={3} />
            )}
            {row.added ? (
              <>
                <td className="n added side">{row.added.n}</td>
                <td className="g added">
                  <Sign side="added" />
                </td>
                <td className="c added">{marked(row.added, row.removed)}</td>
              </>
            ) : (
              <td className="empty side" colSpan={3} />
            )}
          </tr>
        );
    }
  }

  return (
    <table
      className={`diff ${view}`}
      aria-label={split ? t("changes.diff.splitLabel") : t("changes.diff.unifiedLabel")}
    >
      <colgroup>
        <col className="diff-col-n" />
        {split ? <col className="diff-col-g" /> : <col className="diff-col-n" />}
        {split ? <col /> : <col className="diff-col-g" />}
        {split ? <col className="diff-col-n" /> : <col />}
        {split && <col className="diff-col-g" />}
        {split && <col />}
      </colgroup>
      <thead className="visually-hidden">
        <tr>
          {(split
            ? [
                t("changes.diff.originalLine"),
                t("changes.diff.sign"),
                t("changes.diff.original"),
                t("changes.diff.proposedLine"),
                t("changes.diff.sign"),
                t("changes.diff.proposed"),
              ]
            : [
                t("changes.diff.originalLine"),
                t("changes.diff.proposedLine"),
                t("changes.diff.sign"),
                t("changes.diff.text"),
              ]
          ).map((label, i) => (
            <th key={i}>{label}</th>
          ))}
        </tr>
      </thead>
      <tbody>{(split ? rows : unifiedRows(rows)).map(render)}</tbody>
    </table>
  );
}
