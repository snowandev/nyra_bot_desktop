import { useEffect, useState } from "react";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import { errorMessage } from "@/shared/lib/errors";
import { attachedWorkbookView } from "@/features/attachments/spreadsheetStorage";
import { type CellView, inspectWorkspaceWorkbook, type WorkbookSheet } from "./workspaceStorage";

// Where the cells are read from: a workbook in the connected folder, or a version of an attached one (by its id, so
// the file's base64 doesn't take part in comparisons)
export type WorkbookSource =
  | { kind: "folder"; root: string; path: string }
  | { kind: "attachment"; id: string; workbook: string };

type Grid = { key: string; cells: Map<string, CellView>; sheets: WorkbookSheet[]; error: string | null };

async function read(source: WorkbookSource, sheet: string, cells: string[]) {
  if (source.kind === "attachment") return attachedWorkbookView(source.workbook, sheet, cells);
  const state = await inspectWorkspaceWorkbook(source.root, source.path, sheet, cells);
  return state.kind === "workbook" ? state : { sheets: [], cells: [] };
}

// The cells a review shows of one sheet, as the workbook has them now, and its sheets' sizes. Asked again only when
// the cells it shows change (another sheet, a fold opened); a late answer for cells no longer shown is ignored.
export function useCellGrid(source: WorkbookSource, sheet: string, cells: string[]) {
  const origin = source.kind === "folder" ? `${source.root}\n${source.path}` : source.id;
  const key = `${origin}\n${sheet}\n${cells.join(",")}`;
  const [grid, setGrid] = useState<Grid | null>(null);
  // With the latest source, sheet and cells; the key says when they changed
  const load = useStableCallback(() => read(source, sheet, cells));

  useEffect(() => {
    let live = true;
    load()
      .then((view) => {
        if (live) setGrid({ key, cells: new Map(view.cells.map((v) => [v.cell, v])), sheets: view.sheets, error: null });
      })
      .catch((e: unknown) => {
        if (live) setGrid({ key, cells: new Map(), sheets: [], error: errorMessage(e) });
      });
    return () => {
      live = false;
    };
  }, [key, load]);

  const ready = grid?.key === key ? grid : null;
  return { cells: ready?.cells ?? null, error: ready?.error ?? null };
}

// The sheets and their sizes, which decide what the grid folds: given when already known, else read once
export function useSheetSizes(source: WorkbookSource, known: WorkbookSheet[] | undefined) {
  const [read, setRead] = useState<WorkbookSheet[] | null>(null);
  const load = useStableCallback(() => (known ? Promise.resolve(known) : readSheets(source)));

  useEffect(() => {
    let live = true;
    load()
      .then((sheets) => live && setRead(sheets))
      .catch(() => live && setRead([]));
    return () => {
      live = false;
    };
  }, [load]);

  return known ?? read;
}

async function readSheets(source: WorkbookSource) {
  return (await read(source, "", [])).sheets;
}
