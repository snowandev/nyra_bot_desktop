import { invoke } from "@tauri-apps/api/core";
import { writeHtml } from "@tauri-apps/plugin-clipboard-manager";
import { type TableData, tableCells, tableHtml, tableTsv } from "./tableData";

// As HTML, so it pastes as a table in documents and as cells in spreadsheets, and as tab-separated text elsewhere
export const copyTable = (data: TableData) => writeHtml(tableHtml(data), tableTsv(data));

// Rust writes the workbook and asks where to save it; false when the dialog was closed
export const saveTable = (filename: string, data: TableData) =>
  invoke<boolean>("save_table", { filename, rows: tableCells(data) });
