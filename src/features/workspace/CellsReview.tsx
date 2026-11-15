import {
  ChevronDown,
  ChevronsDownUp,
  ChevronUp,
  Eraser,
  List,
  Pencil,
  Plus,
  SquareFunction,
  Table2,
} from "lucide-react";
import type { TFunction } from "i18next";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { altLabel } from "@/shared/lib/platform";
import { type CellChange, cellName, columnName, gridLayout, isEmptyCell, isFormula, looksNumeric, visibleCells } from "./cellGrid";
import { useCellGrid, useSheetSizes, type WorkbookSource } from "./useCellGrid";
import type { CellView, WorkbookSheet } from "./workspaceStorage";

type Props = {
  // Every change, sheet by sheet; the review starts at the first
  changes: CellChange[];
  // The sheets' sizes when already known; otherwise they come with the first cells read
  sheets?: WorkbookSheet[];
  source: WorkbookSource;
  // Names the list for screen readers: the file or the version
  label: string;
  onError: (message: string | null) => void;
};

type Folds = Map<string, { rows: Set<number>; columns: Set<number> }>;

const KIND_ICON: Record<CellChange["kind"], typeof Pencil> = { modified: Pencil, added: Plus, emptied: Eraser };

function kindOf(change: CellChange, t: TFunction) {
  if (change.kind === "modified" && (isFormula(change.after) || change.before.formula)) {
    return { label: t("cells.kind.formula"), icon: SquareFunction };
  }
  return { label: t(`cells.kind.${change.kind}`), icon: KIND_ICON[change.kind] };
}

// A formula shows by its last value, as the spreadsheet does
const shownValue = (view: CellView | undefined) => view?.value ?? "";

// Read in full by screen readers, formulas included
function spoken(t: TFunction, view: CellView | undefined, after?: string) {
  const text = after ?? view?.formula ?? view?.value ?? "";
  if (text === "") return t("cells.empty");
  if (after !== undefined && isFormula(after)) return t("cells.spokenFormulaNew", { formula: after });
  if (!after && view?.formula) {
    return t("cells.spokenFormula", { formula: view.formula, value: view.value || t("cells.notCalculated") });
  }
  return text;
}

function value(t: TFunction, view: CellView | undefined, after?: string): ReactNode {
  const text = after ?? (view?.formula || shownValue(view));
  if (text === "") return <span className="cells-empty">{t("cells.empty")}</span>;
  return <span className={isFormula(text) ? "mono" : undefined}>{text}</span>;
}

const EMPTY_FOLDS = { rows: new Set<number>(), columns: new Set<number>() };

// The spreadsheet's cells with the changes in their place: the headers and one row and column of context around each
// change, the rest folded. A list of "Celda · Antes · Después" is the alternative view. ⌥↑ / ⌥↓ walk the changes.
export function CellsReview({ changes, sheets, source, label, onError }: Props) {
  const { t } = useTranslation();
  const gridRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [index, setIndex] = useState(0);
  const [folds, setFolds] = useState<Folds>(new Map());
  const sheetNames = [...new Set(changes.map((c) => c.sheet))];
  const current = changes[Math.min(index, changes.length - 1)];
  const sheet = current?.sheet ?? "";
  const inSheet = changes.filter((c) => c.sheet === sheet);
  const sizes = useSheetSizes(source, sheets);
  const size = sizes?.find((s) => s.name === sheet) ?? { rows: 0, columns: 0 };
  const layout = gridLayout(inSheet, size, folds.get(sheet) ?? EMPTY_FOLDS);
  // Once the sizes are known, so the cells asked for are the ones the grid ends up showing
  const grid = useCellGrid(source, sheet, view === "grid" && sizes ? visibleCells(layout) : []);
  const byCell = new Map(inSheet.map((c) => [c.cell, c]));

  useEffect(() => onError(grid.error), [grid.error, onError]);

  // The current cell comes into view, and takes the focus if the grid had it
  useEffect(() => {
    const cell = gridRef.current?.querySelector<HTMLElement>("[data-current='true']");
    if (!cell) return;
    cell.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (gridRef.current?.contains(document.activeElement)) cell.focus({ preventScroll: true });
  }, [index, view, grid.cells]);

  const select = (next: number) => setIndex(Math.min(Math.max(next, 0), changes.length - 1));

  function expand(kind: "rows" | "columns", from: number, to: number) {
    const open = folds.get(sheet) ?? EMPTY_FOLDS;
    const next = new Set(open[kind]);
    for (let i = from; i <= to; i++) next.add(i);
    setFolds(new Map(folds).set(sheet, { ...open, [kind]: next }));
  }

  function handleKey(e: KeyboardEvent) {
    if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      select(index + (e.key === "ArrowDown" ? 1 : -1));
    }
  }

  function sheetTabKey(e: KeyboardEvent, at: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = sheetNames[(at + (e.key === "ArrowRight" ? 1 : -1) + sheetNames.length) % sheetNames.length];
    select(changes.findIndex((c) => c.sheet === next));
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-sheet-tab="${CSS.escape(next)}"]`)?.focus());
  }

  const fxRow = (rowLabel: string, cell: CellView | undefined, after?: string) => {
    const formula = after !== undefined ? isFormula(after) : !!cell?.formula;
    const isBefore = after === undefined;
    return (
      <div className="cells-fx-row">
        <span className="cells-fx-label">{rowLabel}</span>
        <span className={`cells-fx-value ${isBefore ? "before" : ""} ${formula ? "mono" : ""}`}>{value(t, cell, after)}</span>
        {formula && (
          <span className="cells-fx-note">
            {isBefore
              ? t("cells.currentValue", { value: cell?.value || t("cells.notCalculated") })
              : t("cells.calculatedInExcel")}
          </span>
        )}
      </div>
    );
  };

  const header = (column: number) => grid.cells?.get(cellName(1, column))?.value ?? "";

  function changedCell(c: CellChange) {
    const at = changes.indexOf(c);
    const kind = kindOf(c, t);
    const isCurrent = c === current;
    const rowLabel = grid.cells?.get(cellName(c.row, 0))?.value;
    const context = [c.row !== 1 && header(c.column), c.column !== 0 && c.row !== 1 && rowLabel].filter(Boolean);
    const spokenLabel = t("cells.spokenCell", {
      cell: c.cell,
      around: context.length ? ` (${context.join(", ")})` : "",
      kind: kind.label.toLowerCase(),
      before: spoken(t, c.before),
      after: spoken(t, undefined, c.after),
    });
    const numeric = looksNumeric(c.after) || looksNumeric(shownValue(c.before));
    return (
      <td
        key={c.cell}
        className={`cells-changed ${c.kind} ${numeric ? "numeric" : ""} ${isCurrent ? "current" : ""}`}
        data-current={isCurrent}
        tabIndex={isCurrent ? 0 : -1}
        aria-label={spokenLabel}
        onClick={() => select(at)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") select(at);
        }}
      >
        <span className="cells-mark" aria-hidden="true">
          <kind.icon size={11} strokeWidth={2.4} />
        </span>
        <span className="cells-pair" aria-hidden="true">
          <span className="cells-before">{value(t, c.before)}</span>
          <span className="cells-after">{value(t, undefined, c.after)}</span>
        </span>
      </td>
    );
  }

  function gridTable() {
    const columns = layout.columns;
    return (
      <table className="cells-grid" aria-label={t("cells.sheetChanges", { sheet, count: inSheet.length })}>
        <thead>
          <tr>
            <th className="cells-row-head corner" scope="col">
              <span className="visually-hidden">{t("cells.row")}</span>
            </th>
            {columns.map((c) =>
              "column" in c ? (
                <th key={c.column} scope="col">
                  {columnName(c.column)}
                </th>
              ) : (
                <th key={`fold-${c.from}`} className="cells-fold-column" scope="col">
                  <button
                    type="button"
                    aria-label={t("cells.columnsShow", { from: columnName(c.from), to: columnName(c.to) })}
                    title={t("cells.columnsTitle", { from: columnName(c.from), to: columnName(c.to) })}
                    onClick={() => expand("columns", c.from, c.to)}
                  >
                    {columnName(c.from)}–{columnName(c.to)}
                  </button>
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {layout.rows.map((r) =>
            "row" in r ? (
              <tr key={r.row} className={r.row === 1 ? "cells-header-row" : undefined}>
                <th className="cells-row-head" scope="row">
                  {r.row}
                </th>
                {columns.map((c) => {
                  if (!("column" in c)) return <td key={`fold-${c.from}`} className="cells-fold-column" aria-hidden="true" />;
                  const ref = cellName(r.row, c.column);
                  const changed = byCell.get(ref);
                  if (changed) return changedCell(changed);
                  const cell = grid.cells?.get(ref);
                  const text = shownValue(cell);
                  return (
                    <td key={ref} className={looksNumeric(text) ? "numeric" : undefined} title={cell?.formula}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            ) : (
              <tr key={`fold-${r.from}`} className="cells-fold-row">
                <th className="cells-row-head" scope="row">
                  <span className="visually-hidden">{t("cells.rowsRange", { from: r.from, to: r.to })}</span>
                </th>
                <td colSpan={columns.length}>
                  <button type="button" onClick={() => expand("rows", r.from, r.to)}>
                    <ChevronsDownUp size={14} strokeWidth={2} aria-hidden="true" />
                    {t("cells.rowsFold", { from: r.from, to: r.to })}
                  </button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    );
  }

  function listTable() {
    return (
      <table className="cells-list" aria-label={t("cells.listOf", { label })}>
        <thead>
          <tr>
            <th scope="col">{t("cells.cell")}</th>
            <th scope="col">{t("cells.type")}</th>
            <th scope="col">{t("cells.before")}</th>
            <th scope="col">
              <span className="visually-hidden">{t("cells.to")}</span>
            </th>
            <th scope="col">{t("cells.after")}</th>
          </tr>
        </thead>
        <tbody>
          {sheetNames.map((name) => {
            const rows = changes.filter((c) => c.sheet === name);
            return [
              sheetNames.length > 1 && (
                <tr key={`group-${name}`} className="cells-list-group">
                  <td colSpan={5}>
                    {name} · {t("changes.blocks", { count: rows.length })}
                  </td>
                </tr>
              ),
              ...rows.map((c) => {
                const at = changes.indexOf(c);
                const kind = kindOf(c, t);
                return (
                  <tr
                    key={`${name}!${c.cell}`}
                    className={c === current ? "current" : undefined}
                    tabIndex={0}
                    onClick={() => select(at)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") select(at);
                    }}
                  >
                    <td className="mono cells-list-ref">
                      {name}!{c.cell}
                    </td>
                    <td>
                      <span className="cells-list-kind">
                        <kind.icon size={12} strokeWidth={2.2} aria-hidden="true" />
                        {kind.label}
                      </span>
                    </td>
                    <td className="cells-list-before">
                      {value(t, c.before)}
                      {c.before.formula && <small>= {c.before.value || t("cells.notCalculated")}</small>}
                    </td>
                    <td className="cells-list-arrow" aria-hidden="true">
                      →
                    </td>
                    <td>
                      {value(t, undefined, c.after)}
                      {isFormula(c.after) && <small>{t("cells.calculatedShort")}</small>}
                    </td>
                  </tr>
                );
              }),
            ];
          })}
        </tbody>
      </table>
    );
  }

  if (!current) return null;

  return (
    <div className="cells-review-body" onKeyDown={handleKey}>
      {sheetNames.length > 1 && (
        <div className="change-review-tabs cells-sheet-tabs" role="tablist" aria-label={t("cells.sheets")}>
          {sheetNames.map((name, at) => {
            const count = changes.filter((c) => c.sheet === name).length;
            return (
              <button
                key={name}
                data-sheet-tab={name}
                type="button"
                role="tab"
                className="change-review-tab"
                aria-selected={name === sheet}
                tabIndex={name === sheet ? 0 : -1}
                onClick={() => select(changes.findIndex((c) => c.sheet === name))}
                onKeyDown={(e) => sheetTabKey(e, at)}
              >
                <Table2 size={13} strokeWidth={2} aria-hidden="true" />
                {name}
                <span className="cells-sheet-count" aria-label={t("changes.blocks", { count })}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="change-review-tools">
        <span className="segmented" role="group" aria-label={t("changes.review.view")}>
          <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")}>
            <Table2 size={13} strokeWidth={2} />
            {t("cells.grid")}
          </button>
          <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>
            <List size={13} strokeWidth={2} />
            {t("cells.list")}
          </button>
        </span>
        <span className="change-review-legend" aria-hidden="true">
          <span>
            <Pencil size={11} strokeWidth={2.4} /> {t("cells.legend.modified")}
          </span>
          <span>
            <Plus size={11} strokeWidth={2.4} /> {t("cells.legend.added")}
          </span>
          <span>
            <Eraser size={11} strokeWidth={2.4} /> {t("cells.legend.emptied")}
          </span>
          <span>
            <SquareFunction size={11} strokeWidth={2.4} /> {t("cells.legend.formula")}
          </span>
        </span>
        {changes.length > 1 && (
          <span className="change-review-nav">
            <button
              type="button"
              className="icon-button small"
              aria-label={t("changes.review.previous", { keys: `${altLabel}↑` })}
              disabled={index === 0}
              onClick={() => select(index - 1)}
            >
              <ChevronUp size={16} strokeWidth={2} />
            </button>
            <span aria-live="polite">
              {t("changes.review.position", { current: index + 1, total: changes.length })}
            </span>
            <button
              type="button"
              className="icon-button small"
              aria-label={t("changes.review.next", { keys: `${altLabel}↓` })}
              disabled={index >= changes.length - 1}
              onClick={() => select(index + 1)}
            >
              <ChevronDown size={16} strokeWidth={2} />
            </button>
          </span>
        )}
      </div>

      {view === "grid" ? (
        <>
          <div className="cells-fx" role="status" aria-live="polite">
            <span className="cells-fx-ref mono">
              {current.sheet}!{current.cell}
            </span>
            <div className="cells-fx-content">
              {fxRow(t("cells.before"), isEmptyCell(current.before) ? undefined : current.before)}
              {fxRow(t("cells.after"), undefined, current.after)}
            </div>
          </div>
          <div ref={gridRef} className="cells-grid-zone" tabIndex={-1}>
            {gridTable()}
          </div>
        </>
      ) : (
        <div className="cells-list-zone">{listTable()}</div>
      )}
    </div>
  );
}
