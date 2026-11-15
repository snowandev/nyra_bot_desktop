import { ChevronsDownUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { columnName, gridLayout, looksNumeric } from "./cellGrid";
import type { CsvRow } from "./csvDiff";

type Props = {
  rows: CsvRow[];
  // The first row names the columns instead of the letters
  hasHeader: boolean;
  currentBlock: number;
  expanded: Set<number>;
  onExpand: (from: number, to: number) => void;
  // For the ids the change navigation scrolls to
  idPrefix: string;
  label: string;
};

const blockOf = (row: CsvRow) => (row.kind === "same" ? null : row.block);

// A CSV change as a table: the header and one row around each change, the rest folded; changed cells show the old
// value struck through above the new one, and added and removed rows are marked on the whole row
export function CsvDiffTable({ rows, hasHeader, currentBlock, expanded, onExpand, idPrefix, label }: Props) {
  const { t } = useTranslation();
  const changed = rows.flatMap((row, i) => (row.kind === "same" ? [] : [{ row: i + 1, column: 0 }]));
  const layout = gridLayout(changed, { rows: rows.length, columns: 1 }, { rows: expanded, columns: new Set() });
  const columns = Math.max(1, ...rows.map((r) => r.cells.length));
  const header = hasHeader ? rows[0] : undefined;
  const firstOfBlock = new Set(rows.flatMap((row, i) => (blockOf(row) !== null && blockOf(rows[i - 1]) !== blockOf(row) ? [i] : [])));
  const columnLabel = (c: number) => header?.cells[c] || columnName(c);

  function cell(row: CsvRow, c: number) {
    const value = row.cells[c] ?? "";
    if (row.kind !== "modified") {
      return (
        <td key={c} className={looksNumeric(value) ? "numeric" : undefined}>
          {value}
        </td>
      );
    }
    const before = row.before[c] ?? "";
    if (before === value) {
      return (
        <td key={c} className={looksNumeric(value) ? "numeric" : undefined}>
          {value}
        </td>
      );
    }
    const kind = before === "" ? "added" : value === "" ? "emptied" : "modified";
    const spoken = t("cells.csvSpoken", {
      column: columnLabel(c),
      row: row.number,
      before: before || t("cells.empty"),
      after: value || t("cells.empty"),
    });
    return (
      <td
        key={c}
        className={`cells-changed ${kind} ${looksNumeric(value) || looksNumeric(before) ? "numeric" : ""}`}
        aria-label={spoken}
      >
        <span className="cells-pair" aria-hidden="true">
          <span className="cells-before">{before || <span className="cells-empty">{t("cells.empty")}</span>}</span>
          <span className="cells-after">{value || <span className="cells-empty">{t("cells.empty")}</span>}</span>
        </span>
      </td>
    );
  }

  return (
    <table className="cells-grid csv-grid" aria-label={label}>
      <thead>
        <tr>
          <th className="cells-row-head corner" scope="col">
            <span className="visually-hidden">{t("cells.row")}</span>
          </th>
          {Array.from({ length: columns }, (_, c) => (
            <th key={c} scope="col" className={header ? "csv-header" : undefined}>
              {header ? (
                <>
                  <span className="csv-letter" aria-hidden="true">
                    {columnName(c)}
                  </span>
                  {header.cells[c] ?? ""}
                </>
              ) : (
                columnName(c)
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {layout.rows.map((r) => {
          if (!("row" in r)) {
            return (
              <tr key={`fold-${r.from}`} className="cells-fold-row">
                <th className="cells-row-head" scope="row">
                  <span className="visually-hidden">
                    {t("cells.rowsRange", { from: rows[r.from - 1]?.number, to: rows[r.to - 1]?.number })}
                  </span>
                </th>
                <td colSpan={columns}>
                  <button type="button" onClick={() => onExpand(r.from - 1, r.to - 1)}>
                    <ChevronsDownUp size={14} strokeWidth={2} aria-hidden="true" />
                    {t("cells.rowsFold", { from: rows[r.from - 1]?.number, to: rows[r.to - 1]?.number })}
                  </button>
                </td>
              </tr>
            );
          }
          const index = r.row - 1;
          const row = rows[index];
          // The header is the table's own head
          if (!row || (header && index === 0)) return null;
          const block = blockOf(row);
          const mark = row.kind === "added" ? "+ " : row.kind === "removed" ? "− " : "";
          return (
            <tr
              key={index}
              id={firstOfBlock.has(index) ? `${idPrefix}-block-${block}` : undefined}
              className={`csv-row-${row.kind} ${block === currentBlock ? "current" : ""}`}
            >
              <th className="cells-row-head" scope="row">
                {mark}
                {row.number}
                {(row.kind === "added" || row.kind === "removed") && (
                  <span className="visually-hidden">, {row.kind === "added" ? t("cells.newRow") : t("cells.removedRow")}</span>
                )}
              </th>
              {Array.from({ length: columns }, (_, c) => cell(row, c))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
