//! Spreadsheets (Excel and OpenDocument) turned into text the model can read: one table per sheet, each cell where
//! it is (column letters and row numbers, as the user sees them) and formulas as written, with the value they give.

pub mod cells;
pub mod convert;
mod shared_formulas;
pub mod table;

use std::io::Cursor;

use base64::Engine;
use calamine::{
    open_workbook_auto_from_rs, CellErrorType, Data, Range, Reader, SheetVisible, Sheets, Xlsx,
};
use serde::Serialize;
use tauri::AppHandle;

use crate::i18n::t;
use crate::util::to_message;
use cells::{edit_workbook, CellEdit, EditError};
use tauri::ipc::{InvokeBody, Request};

pub const SPREADSHEET_EXTENSIONS: &[&str] = &["xlsx", "xlsm", "xls", "ods"];

/// The file itself, attached or in a folder, like a PDF
pub const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;
/// What an attached spreadsheet may take as text, the same as an attached text file: it goes with every message
pub const MAX_ATTACHED_TEXT: usize = 1024 * 1024;
/// In a connected folder the model reads it by rows, so more fits
pub const MAX_FOLDER_TEXT: usize = 4 * 1024 * 1024;

/// calamine lays a sheet out as a full grid, from its first used cell to its last: one cell in A1 and another in the
/// last row and column would ask for billions of them and take all the memory
const MAX_GRID_CELLS: u64 = 4_000_000;

/// Whether an .xlsx sheet's cells spread over a grid too large to lay out, read one by one without building it
fn grid_too_large(xlsx: &mut Xlsx<Cursor<&[u8]>>, sheet: &str) -> bool {
    let Ok(mut reader) = xlsx.worksheet_cells_reader(sheet) else {
        return false;
    };
    let (mut first, mut last) = ((u32::MAX, u32::MAX), (0u32, 0u32));
    while let Ok(Some(cell)) = reader.next_cell() {
        let (row, column) = cell.get_position();
        first = (first.0.min(row), first.1.min(column));
        last = (last.0.max(row), last.1.max(column));
    }
    if first.0 > last.0 {
        return false;
    }
    u64::from(last.0 - first.0 + 1) * u64::from(last.1 - first.1 + 1) > MAX_GRID_CELLS
}

/// A sheet's values and formulas; None when it is too large to lay out. Only an .xlsx can be measured before:
/// .xls keeps to its format's limit of 65,536 × 256 cells, and .ods is read as calamine does.
pub(crate) fn sheet_ranges(
    workbook: &mut Sheets<Cursor<&[u8]>>,
    sheet: &str,
) -> Option<(Range<Data>, Range<String>)> {
    if let Sheets::Xlsx(xlsx) = workbook {
        if grid_too_large(xlsx, sheet) {
            return None;
        }
    }
    Some((
        workbook.worksheet_range(sheet).unwrap_or_default(),
        // Not every format keeps formulas (an .ods may not): then only values
        workbook.worksheet_formula(sheet).unwrap_or_default(),
    ))
}

pub fn is_spreadsheet(path: &str) -> bool {
    path.rsplit_once('.')
        .is_some_and(|(_, ext)| SPREADSHEET_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
}

/// "A" for 0, "Z" for 25, "AA" for 26
fn column_name(mut index: u32) -> String {
    let mut name = Vec::new();
    loop {
        name.push(b'A' + (index % 26) as u8);
        if index < 26 {
            break;
        }
        index = index / 26 - 1;
    }
    name.reverse();
    String::from_utf8(name).unwrap_or_default()
}

fn cell_name(row: u32, column: u32) -> String {
    format!("{}{}", column_name(column), row + 1)
}

fn error_text(error: &CellErrorType) -> &'static str {
    match error {
        CellErrorType::Div0 => "#DIV/0!",
        CellErrorType::NA => "#N/A",
        CellErrorType::Name => "#NAME?",
        CellErrorType::Null => "#NULL!",
        CellErrorType::Num => "#NUM!",
        CellErrorType::Ref => "#REF!",
        CellErrorType::Value => "#VALUE!",
        CellErrorType::GettingData => "#GETTING_DATA",
    }
}

/// Dates as ISO, so they read the same whatever the file's format; whole numbers without ".0"
fn value_text(value: &Data) -> String {
    match value {
        Data::Empty => String::new(),
        Data::Int(n) => n.to_string(),
        Data::Float(n) if n.fract() == 0.0 && n.abs() < 1e15 => format!("{}", *n as i64),
        Data::Float(n) => n.to_string(),
        Data::String(s) => s.clone(),
        Data::Bool(b) => if *b { "TRUE" } else { "FALSE" }.to_string(),
        Data::DateTime(date) => {
            let (year, month, day, hour, minute, second, _) = date.to_ymd_hms_milli();
            if !date.is_datetime() {
                format!("{}", date.as_f64())
            } else if (hour, minute, second) == (0, 0, 0) {
                format!("{year:04}-{month:02}-{day:02}")
            } else if year <= 1900 && (month, day) <= (1, 1) {
                format!("{hour:02}:{minute:02}:{second:02}")
            } else {
                format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}")
            }
        }
        Data::DateTimeIso(s) | Data::DurationIso(s) => s.clone(),
        Data::Error(error) => error_text(error).to_string(),
    }
}

/// A cell inside a table row: a "|" would split it and a line break would end the row
fn table_safe(text: &str) -> String {
    text.replace('|', "\\|").replace(['\r', '\n'], " ")
}

fn cell_text(values: &Range<Data>, formulas: &Range<String>, row: u32, column: u32) -> String {
    let value = values
        .get_value((row, column))
        .map(value_text)
        .unwrap_or_default();
    match formulas.get_value((row, column)).filter(|f| !f.is_empty()) {
        Some(formula) if value.is_empty() => format!("={formula}"),
        Some(formula) => format!("={formula} → {value}"),
        None => value,
    }
}

/// The rows and columns any cell of either range uses
fn bounds(values: &Range<Data>, formulas: &Range<String>) -> Option<((u32, u32), (u32, u32))> {
    let corners = [
        values.start(),
        values.end(),
        formulas.start(),
        formulas.end(),
    ];
    let used: Vec<(u32, u32)> = corners.into_iter().flatten().collect();
    let first = (
        used.iter().map(|c| c.0).min()?,
        used.iter().map(|c| c.1).min()?,
    );
    let last = (
        used.iter().map(|c| c.0).max()?,
        used.iter().map(|c| c.1).max()?,
    );
    Some((first, last))
}

/// Every sheet as a table headed by its column letters, each row starting with its number. Empty rows are left out
/// (the numbers still say where each row is). Past max_chars the rest is cut, saying so.
pub fn workbook_text(bytes: &[u8], max_chars: usize) -> Result<String, String> {
    let mut workbook = open_workbook_auto_from_rs(Cursor::new(bytes))
        .map_err(|_| t("native.spreadsheet.cantOpen"))?;
    let sheets = workbook.sheets_metadata().to_vec();
    let mut out = String::new();
    for (index, sheet) in sheets.iter().enumerate() {
        let hidden = if sheet.visible == SheetVisible::Visible {
            ""
        } else {
            ", hidden"
        };
        let Some((values, formulas)) = sheet_ranges(&mut workbook, &sheet.name) else {
            out.push_str(&format!(
                "Sheet \"{}\" ({} of {}{hidden}): too large to read, its cells spread over millions of rows and columns\n\n",
                sheet.name,
                index + 1,
                sheets.len()
            ));
            continue;
        };
        let Some((first, last)) = bounds(&values, &formulas) else {
            out.push_str(&format!(
                "Sheet \"{}\" ({} of {}{hidden}): empty\n\n",
                sheet.name,
                index + 1,
                sheets.len()
            ));
            continue;
        };
        out.push_str(&format!(
            "Sheet \"{}\" ({} of {}{hidden}), cells {}:{}\n",
            sheet.name,
            index + 1,
            sheets.len(),
            cell_name(first.0, first.1),
            cell_name(last.0, last.1)
        ));
        let columns: Vec<String> = (first.1..=last.1).map(column_name).collect();
        out.push_str(&format!("| | {} |\n", columns.join(" | ")));
        for row in first.0..=last.0 {
            let cells: Vec<String> = (first.1..=last.1)
                .map(|column| table_safe(&cell_text(&values, &formulas, row, column)))
                .collect();
            if cells.iter().all(String::is_empty) {
                continue;
            }
            let line = format!("| {} | {} |\n", row + 1, cells.join(" | "));
            if out.len() + line.len() > max_chars {
                out.push_str(&format!(
                    "[Cut here: the rest of this sheet, up to row {}, and the sheets after it don't fit]\n",
                    last.0 + 1
                ));
                return Ok(out.trim_end().to_string());
            }
            out.push_str(&line);
        }
        out.push('\n');
    }
    Ok(out.trim_end().to_string())
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SheetInfo {
    name: String,
    hidden: bool,
    /// Excel's sheet protection: Nyra doesn't remove it, so it doesn't write there
    protected: bool,
    /// The last row and column with something in them, counted from 1; 0 for an empty sheet
    rows: u32,
    columns: u32,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CellView {
    cell: String,
    value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    formula: Option<String>,
}

/// What the review shows of a workbook: its sheets and the cells it asks for, as they are now
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookView {
    /// .xlsx and .xlsm; .xls and .ods are only read
    writable: bool,
    sheets: Vec<SheetInfo>,
    cells: Vec<CellView>,
}

/// The most cells one review asks for at a time: the changes, one row and column around each and the headers
const MAX_VIEW_CELLS: usize = 20_000;

pub fn workbook_view(
    bytes: &[u8],
    sheet: Option<&str>,
    cells: &[String],
) -> Result<WorkbookView, String> {
    let mut workbook = open_workbook_auto_from_rs(Cursor::new(bytes))
        .map_err(|_| t("native.spreadsheet.cantOpen"))?;
    let protected = cells::protected_sheets(bytes);
    let metadata = workbook.sheets_metadata().to_vec();
    let mut sheets = Vec::new();
    let mut views = Vec::new();
    for info in &metadata {
        let (values, formulas) = sheet_ranges(&mut workbook, &info.name).unwrap_or_default();
        let last = bounds(&values, &formulas)
            .map(|(_, last)| (last.0 + 1, last.1 + 1))
            .unwrap_or((0, 0));
        sheets.push(SheetInfo {
            name: info.name.clone(),
            hidden: info.visible != SheetVisible::Visible,
            protected: protected.contains(&info.name),
            rows: last.0,
            columns: last.1,
        });
        if sheet != Some(info.name.as_str()) {
            continue;
        }
        for cell in cells.iter().take(MAX_VIEW_CELLS) {
            let Some((row, column)) = cells::parse_cell(cell) else {
                continue;
            };
            let value = values
                .get_value((row, column))
                .map(value_text)
                .unwrap_or_default();
            let formula = formulas
                .get_value((row, column))
                .filter(|f| !f.is_empty())
                .map(|f| format!("={f}"));
            views.push(CellView {
                cell: cell_name(row, column),
                value,
                formula,
            });
        }
    }
    Ok(WorkbookView {
        writable: cells::is_writable(bytes),
        sheets,
        cells: views,
    })
}

fn decode(workbook: &str) -> Result<Vec<u8>, EditError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(workbook)
        .map_err(|_| EditError::Damaged)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(EditError::Damaged);
    }
    Ok(bytes)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SheetCellView {
    sheet: String,
    #[serde(flatten)]
    view: CellView,
}

/// A new version of an attached workbook: the file (base64), its text for the model, and what the changed cells held
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AttachedVersion {
    workbook: String,
    text: String,
    before: Vec<SheetCellView>,
    /// Made from an .xls or .ods, so it is an .xlsx now
    converted: bool,
}

/// The workbook as one Nyra can write: itself, or a copy in .xlsx of one it can only read
pub fn writable_copy(bytes: &[u8]) -> Result<(std::borrow::Cow<'_, [u8]>, bool), EditError> {
    if cells::is_writable(bytes) {
        Ok((std::borrow::Cow::Borrowed(bytes), false))
    } else {
        Ok((std::borrow::Cow::Owned(convert::to_xlsx(bytes)?), true))
    }
}

fn new_version(bytes: &[u8], edits: &[CellEdit]) -> Result<AttachedVersion, EditError> {
    let (writable, converted) = writable_copy(bytes)?;
    let written = edit_workbook(&writable, edits)?;
    let text = workbook_text(&written, MAX_ATTACHED_TEXT).map_err(|_| EditError::Damaged)?;
    let mut before = Vec::new();
    let mut sheets: Vec<&str> = Vec::new();
    for edit in edits {
        if !sheets.contains(&edit.sheet.as_str()) {
            sheets.push(&edit.sheet);
        }
    }
    for sheet in sheets {
        let cells: Vec<String> = edits
            .iter()
            .filter(|e| e.sheet == sheet)
            .map(|e| e.cell.clone())
            .collect();
        let view = workbook_view(bytes, Some(sheet), &cells).map_err(|_| EditError::Damaged)?;
        before.extend(view.cells.into_iter().map(|view| SheetCellView {
            sheet: sheet.to_string(),
            view,
        }));
    }
    let workbook = base64::engine::general_purpose::STANDARD.encode(written);
    Ok(AttachedVersion {
        workbook,
        text,
        before,
        converted,
    })
}

/// The attached file never changes: the edits make a new version of it, kept in the conversation
#[tauri::command]
pub async fn edit_attached_workbook(
    workbook: String,
    edits: Vec<CellEdit>,
) -> Result<AttachedVersion, EditError> {
    tauri::async_runtime::spawn_blocking(move || new_version(&decode(&workbook)?, &edits))
        .await
        .map_err(|_| EditError::Damaged)?
}

/// What the review shows of an attached version, as for a workbook in the folder
#[tauri::command]
pub async fn attached_workbook_view(
    workbook: String,
    sheet: Option<String>,
    cells: Vec<String>,
) -> Result<WorkbookView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = decode(&workbook).map_err(|_| t("native.spreadsheet.damaged"))?;
        workbook_view(&bytes, sheet.as_deref(), &cells)
    })
    .await
    .map_err(to_message)?
}

/// The default name in the save dialog: the attachment's own, without anything that would make it a path
fn save_name(requested: &str) -> String {
    crate::util::offered_file_name(
        requested,
        &["xlsx", "xlsm"],
        &t("native.spreadsheet.defaultName"),
    )
}

/// false when the user closes the dialog without choosing a place
#[tauri::command]
pub async fn save_spreadsheet(
    app: AppHandle,
    filename: String,
    workbook: String,
) -> Result<bool, String> {
    let bytes = decode(&workbook).map_err(|_| t("native.spreadsheet.damaged"))?;
    let name = save_name(&filename);
    let extension = if name.to_lowercase().ends_with(".xlsm") {
        "xlsm"
    } else {
        "xlsx"
    };
    let extensions: &'static [&'static str] = if extension == "xlsm" {
        &["xlsm"]
    } else {
        &["xlsx"]
    };
    crate::util::save_with_dialog(
        &app,
        name,
        Some(("Excel".into(), extensions)),
        &bytes,
        "native.spreadsheet.saveFailed",
    )
    .await
}

/// An attached spreadsheet, as the raw request body so megabytes don't go through JSON
#[tauri::command]
pub async fn read_spreadsheet(request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(t("native.spreadsheet.notReceived"));
    };
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(t("native.spreadsheet.tooBig"));
    }
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || workbook_text(&bytes, MAX_ATTACHED_TEXT))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn names_columns_like_a_spreadsheet() {
        assert_eq!(column_name(0), "A");
        assert_eq!(column_name(25), "Z");
        assert_eq!(column_name(26), "AA");
        assert_eq!(column_name(701), "ZZ");
        assert_eq!(column_name(702), "AAA");
        assert_eq!(cell_name(2, 1), "B3");
    }

    #[test]
    fn writes_values_as_they_read() {
        assert_eq!(value_text(&Data::Float(10.0)), "10");
        assert_eq!(value_text(&Data::Float(1.5)), "1.5");
        assert_eq!(value_text(&Data::Bool(true)), "TRUE");
        assert_eq!(value_text(&Data::Error(CellErrorType::Div0)), "#DIV/0!");
        assert_eq!(table_safe("a|b\nc"), "a\\|b c");
    }

    #[test]
    fn recognizes_spreadsheets_by_extension() {
        assert!(is_spreadsheet("ventas/Enero.XLSX"));
        assert!(is_spreadsheet("datos.ods"));
        assert!(!is_spreadsheet("datos.csv"));
    }

    /// The smallest .xlsx Excel opens: one sheet with text, numbers, an empty row and a formula
    pub(crate) fn sample_xlsx() -> Vec<u8> {
        xlsx_with_sheet(
            r#"<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Producto</t></is></c><c r="B1" t="inlineStr"><is><t>Unidades</t></is></c><c r="C1" t="inlineStr"><is><t>Precio</t></is></c><c r="D1" t="inlineStr"><is><t>Total</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Manzana</t></is></c><c r="B2"><v>10</v></c><c r="C2"><v>1.5</v></c><c r="D2"><f>B2*C2</f><v>15</v></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>Pera | verde</t></is></c><c r="B4"><v>3</v></c></row></sheetData></worksheet>"#,
        )
    }

    fn xlsx_with_sheet(sheet: &str) -> Vec<u8> {
        use std::io::Write;
        use zip::write::SimpleFileOptions;
        let parts = [
            (
                "[Content_Types].xml",
                r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#,
            ),
            (
                "_rels/.rels",
                r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
            ),
            (
                "xl/workbook.xml",
                r#"<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ventas" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
            ),
            (
                "xl/_rels/workbook.xml.rels",
                r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#,
            ),
            ("xl/worksheets/sheet1.xml", sheet),
        ];
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, content) in parts {
            zip.start_file(name, SimpleFileOptions::default()).unwrap();
            zip.write_all(content.as_bytes()).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn reads_a_sheet_as_a_table_with_its_formulas() {
        let text = workbook_text(&sample_xlsx(), 10_000).unwrap();
        assert_eq!(
            text,
            "Sheet \"Ventas\" (1 of 1), cells A1:D4\n\
             | | A | B | C | D |\n\
             | 1 | Producto | Unidades | Precio | Total |\n\
             | 2 | Manzana | 10 | 1.5 | =B2*C2 → 15 |\n\
             | 4 | Pera \\| verde | 3 |  |  |"
        );
    }

    #[test]
    fn a_sheet_spread_over_the_whole_grid_is_left_out_instead_of_taking_all_the_memory() {
        let far = xlsx_with_sheet(
            r#"<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>1</v></c></row><row r="1048576"><c r="XFD1048576"><v>2</v></c></row></sheetData></worksheet>"#,
        );
        assert!(workbook_text(&far, 10_000)
            .unwrap()
            .contains("too large to read"));
        assert!(convert::to_xlsx(&far).is_err());
    }

    #[test]
    fn says_where_it_cut_when_it_doesnt_fit() {
        let text = workbook_text(&sample_xlsx(), 120).unwrap();
        assert!(text.contains("| 1 | Producto"));
        assert!(text.ends_with(
            "[Cut here: the rest of this sheet, up to row 4, and the sheets after it don't fit]"
        ));
    }

    #[test]
    fn makes_a_new_version_and_says_what_the_cells_held() {
        let edits = [CellEdit {
            sheet: "Ventas".into(),
            cell: "B2".into(),
            value: "12".into(),
        }];
        let version = new_version(&sample_xlsx(), &edits).unwrap();
        assert!(version.text.contains("| 2 | Manzana | 12 |"));
        assert_eq!(version.before.len(), 1);
        assert_eq!(version.before[0].view.value, "10");
        let written = base64::engine::general_purpose::STANDARD
            .decode(&version.workbook)
            .unwrap();
        assert!(workbook_text(&written, 10_000)
            .unwrap()
            .contains("| 2 | Manzana | 12 |"));
    }

    #[test]
    fn offers_the_attachments_name_without_paths() {
        assert_eq!(
            save_name("Gastos de octubre (versión 2).xlsx"),
            "Gastos de octubre (versión 2).xlsx"
        );
        assert_eq!(save_name("../../etc/x.xlsx"), "etcx.xlsx");
        assert_eq!(
            save_name("informe.pdf"),
            t("native.spreadsheet.defaultName")
        );
    }

    #[test]
    fn a_damaged_file_is_an_error() {
        assert!(workbook_text(b"not a spreadsheet", 1000).is_err());
    }
}
