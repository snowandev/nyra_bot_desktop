//! A table from a reply as an .xlsx file: the header row in bold and fixed while scrolling, each column as wide as
//! its text, and the cells the app recognized as numbers written as numbers, so they can be added up.

use serde::Deserialize;

use super::cell_name;
use super::cells::EditError;
use super::convert::{escape, package, Worksheet, BOLD_STYLE};

/// Far above any table a reply holds; the request is refused beyond it
pub const MAX_ROWS: usize = 10_000;
pub const MAX_COLUMNS: usize = 200;

const MIN_WIDTH: usize = 8;
const MAX_WIDTH: usize = 60;
/// Excel's limit for a sheet's name
const MAX_SHEET_NAME: usize = 31;

#[derive(Deserialize, Debug, Clone, PartialEq)]
pub struct TableCell {
    pub text: String,
    /// Set by the app when the whole cell is a number, written however the reply wrote it ("1.234,5", "$1,200")
    pub number: Option<f64>,
}

fn cell_xml(reference: &str, cell: &TableCell, style: Option<u32>) -> String {
    let s = style.map(|s| format!(" s=\"{s}\"")).unwrap_or_default();
    match cell.number.filter(|n| n.is_finite()) {
        Some(number) => format!("<c r=\"{reference}\"{s}><v>{number}</v></c>"),
        None if cell.text.is_empty() => String::new(),
        None => format!(
            "<c r=\"{reference}\" t=\"inlineStr\"{s}><is><t xml:space=\"preserve\">{}</t></is></c>",
            escape(&cell.text)
        ),
    }
}

/// Without the characters Excel doesn't allow in a sheet's name, and not longer than it allows
fn sheet_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .filter(|c| !matches!(c, '[' | ']' | ':' | '*' | '?' | '/' | '\\'))
        .take(MAX_SHEET_NAME)
        .collect();
    let clean = clean.trim().trim_matches('\'').to_string();
    if clean.is_empty() {
        "Sheet1".to_string()
    } else {
        clean
    }
}

/// The first row is the header. None when the table is empty or too large.
pub fn table_xlsx(name: &str, rows: &[Vec<TableCell>]) -> Option<Result<Vec<u8>, EditError>> {
    let columns = rows.iter().map(Vec::len).max().unwrap_or(0);
    if rows.is_empty() || columns == 0 || rows.len() > MAX_ROWS || columns > MAX_COLUMNS {
        return None;
    }
    let widths = (0..columns).map(|column| {
        let longest = rows
            .iter()
            .filter_map(|row| row.get(column))
            .map(|cell| cell.text.chars().count())
            .max()
            .unwrap_or(0);
        (longest + 2).clamp(MIN_WIDTH, MAX_WIDTH)
    });
    let cols: String = widths
        .enumerate()
        .map(|(i, width)| {
            format!(
                "<col min=\"{0}\" max=\"{0}\" width=\"{width}\" customWidth=\"1\"/>",
                i + 1
            )
        })
        .collect();
    let data: String = rows
        .iter()
        .enumerate()
        .map(|(r, row)| {
            let style = (r == 0).then_some(BOLD_STYLE);
            let cells: String = row
                .iter()
                .enumerate()
                .map(|(c, cell)| cell_xml(&cell_name(r as u32, c as u32), cell, style))
                .collect();
            format!("<row r=\"{}\">{cells}</row>", r + 1)
        })
        .collect();
    // The header stays in view while scrolling down a long table
    let frozen = r#"<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>"#;
    Some(package(&[Worksheet {
        name: sheet_name(name),
        hidden: false,
        content: format!("{frozen}<cols>{cols}</cols><sheetData>{data}</sheetData>"),
    }]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spreadsheet::workbook_text;

    fn text(text: &str) -> TableCell {
        TableCell {
            text: text.to_string(),
            number: None,
        }
    }

    fn number(text: &str, number: f64) -> TableCell {
        TableCell {
            text: text.to_string(),
            number: Some(number),
        }
    }

    #[test]
    fn writes_the_table_with_its_numbers_as_numbers() {
        let rows = vec![
            vec![text("Mes"), text("Pedidos"), text("Notas")],
            vec![
                text("Enero"),
                number("1.234,5", 1234.5),
                text("<b>& \"comillas\""),
            ],
            vec![text("Mayo"), number("30", 30.0), text("")],
        ];
        let xlsx = table_xlsx("Tabla", &rows).unwrap().unwrap();
        let read = workbook_text(&xlsx, 10_000).unwrap();
        assert!(read.contains("Tabla"), "{read}");
        assert!(
            read.contains("| 2 | Enero | 1234.5 | <b>& \"comillas\" |"),
            "{read}"
        );
        assert!(read.contains("| 3 | Mayo | 30 |"), "{read}");
        assert!(crate::spreadsheet::cells::is_writable(&xlsx));
    }

    #[test]
    fn refuses_an_empty_or_huge_table() {
        assert!(table_xlsx("Tabla", &[]).is_none());
        assert!(table_xlsx("Tabla", &[vec![]]).is_none());
        let wide = vec![vec![text("x"); MAX_COLUMNS + 1]];
        assert!(table_xlsx("Tabla", &wide).is_none());
    }

    #[test]
    fn keeps_sheet_names_excel_accepts() {
        assert_eq!(sheet_name("Ventas [2025]: total?"), "Ventas 2025 total");
        assert_eq!(sheet_name("'/'"), "Sheet1");
        assert_eq!(sheet_name(&"a".repeat(40)).len(), MAX_SHEET_NAME);
    }
}
