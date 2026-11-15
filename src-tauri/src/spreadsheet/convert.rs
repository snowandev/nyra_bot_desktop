//! A copy in .xlsx of a workbook Nyra can only read (.xls, .ods), so its cells can be changed. The copy keeps every
//! sheet's values, formulas and dates; formats, charts and macros of the original don't come along, which is why the
//! original is never replaced.

use std::io::{Cursor, Write};

use calamine::{open_workbook_auto_from_rs, Data, Reader, SheetVisible, Sheets};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use super::cells::EditError;
use super::{bounds, cell_name, value_text};

// Built-in number formats every spreadsheet app knows: 14 is a date, 22 a date with time; style 3 is bold
const STYLES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="22" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>"#;

/// The style of a bold cell, for a table's header
pub(super) const BOLD_STYLE: u32 = 3;

/// One sheet of a new workbook: its name and the content of its <worksheet> element
pub(super) struct Worksheet {
    pub name: String,
    pub hidden: bool,
    pub content: String,
}

pub(super) fn escape(text: &str) -> String {
    quick_xml::escape::escape(text).into_owned()
}

/// A sheet named in a formula: quoted when it has anything but letters, digits and underscores
fn sheet_reference(name: &str) -> String {
    if name.chars().all(|c| c.is_alphanumeric() || c == '_') {
        name.to_string()
    } else {
        format!("'{}'", name.replace('\'', "''"))
    }
}

/// "$Hoja 2.A1" or ".A1": the sheet, when named, and the cell
fn odf_cell(part: &str) -> Option<(Option<String>, String)> {
    let part = part.trim();
    let dot = part.rfind('.')?;
    let (sheet, cell) = part.split_at(dot);
    let cell = cell[1..].replace('$', "");
    if cell.is_empty() || !cell.chars().all(|c| c.is_ascii_alphanumeric()) {
        return None;
    }
    let sheet = sheet.trim_start_matches('$');
    let sheet = sheet.trim_matches('\'').replace("''", "'");
    Some(((!sheet.is_empty()).then_some(sheet), cell))
}

/// An OpenDocument formula ("of:=SUM([.B2:.B4];[$Hoja2.A1])") as Excel writes it ("SUM(B2:B4,Hoja2!A1)"). None when
/// it uses anything this doesn't translate for sure; the cell then keeps only its value.
fn excel_formula(odf: &str) -> Option<String> {
    let body = odf.strip_prefix("of:").unwrap_or(odf).strip_prefix('=')?;
    let mut out = String::new();
    let mut chars = body.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                out.push(c);
                for s in chars.by_ref() {
                    out.push(s);
                    if s == '"' {
                        break;
                    }
                }
            }
            '[' => {
                let mut reference = String::new();
                let mut closed = false;
                for r in chars.by_ref() {
                    if r == ']' {
                        closed = true;
                        break;
                    }
                    reference.push(r);
                }
                if !closed {
                    return None;
                }
                let mut ends = reference.splitn(2, ':');
                let (sheet, first) = odf_cell(ends.next()?)?;
                let prefix = sheet
                    .map(|s| format!("{}!", sheet_reference(&s)))
                    .unwrap_or_default();
                match ends.next() {
                    Some(end) => out.push_str(&format!("{prefix}{first}:{}", odf_cell(end)?.1)),
                    None => out.push_str(&format!("{prefix}{first}")),
                }
            }
            ';' => out.push(','),
            // A decimal point; any other is a function from a namespace ("ORG.OPENOFFICE.…")
            '.' if out.ends_with(|p: char| p.is_ascii_digit())
                || chars.peek().is_some_and(char::is_ascii_digit) =>
            {
                out.push(c)
            }
            // A function from a namespace or a reference this doesn't know
            '.' | '#' | '!' => return None,
            _ => out.push(c),
        }
    }
    Some(out)
}

fn cell_xml(reference: &str, value: &Data, formula: Option<&str>) -> String {
    let f = formula
        .map(|f| format!("<f>{}</f>", escape(f)))
        .unwrap_or_default();
    match value {
        Data::Empty if f.is_empty() => String::new(),
        Data::Empty => format!("<c r=\"{reference}\">{f}</c>"),
        Data::Int(_) | Data::Float(_) => {
            format!("<c r=\"{reference}\">{f}<v>{}</v></c>", value_text(value))
        }
        Data::Bool(b) => format!(
            "<c r=\"{reference}\" t=\"b\">{f}<v>{}</v></c>",
            u8::from(*b)
        ),
        Data::DateTime(date) => {
            let style = if date.is_datetime() && date.as_f64().fract() != 0.0 {
                2
            } else {
                1
            };
            format!(
                "<c r=\"{reference}\" s=\"{style}\">{f}<v>{}</v></c>",
                date.as_f64()
            )
        }
        Data::Error(_) if !f.is_empty() => format!("<c r=\"{reference}\">{f}</c>"),
        // A formula's text result, an error value or a date already written as text
        _ if !f.is_empty() => format!(
            "<c r=\"{reference}\" t=\"str\">{f}<v>{}</v></c>",
            escape(&value_text(value))
        ),
        _ => format!(
            "<c r=\"{reference}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">{}</t></is></c>",
            escape(&value_text(value))
        ),
    }
}

/// The workbook as a new .xlsx with every sheet's values, formulas and dates
pub fn to_xlsx(bytes: &[u8]) -> Result<Vec<u8>, EditError> {
    let mut workbook =
        open_workbook_auto_from_rs(Cursor::new(bytes)).map_err(|_| EditError::Damaged)?;
    let odf = matches!(workbook, Sheets::Ods(_));
    let sheets = workbook.sheets_metadata().to_vec();
    let mut worksheets = Vec::new();
    for sheet in &sheets {
        let (values, formulas) =
            super::sheet_ranges(&mut workbook, &sheet.name).ok_or(EditError::Damaged)?;
        let mut rows = String::new();
        if let Some((first, last)) = bounds(&values, &formulas) {
            for row in first.0..=last.0 {
                let mut cells = String::new();
                for column in first.1..=last.1 {
                    let value = values
                        .get_value((row, column))
                        .cloned()
                        .unwrap_or(Data::Empty);
                    let formula = formulas
                        .get_value((row, column))
                        .filter(|f| !f.is_empty())
                        .and_then(|f| {
                            if odf {
                                excel_formula(f)
                            } else {
                                Some(f.clone())
                            }
                        });
                    cells.push_str(&cell_xml(
                        &cell_name(row, column),
                        &value,
                        formula.as_deref(),
                    ));
                }
                if !cells.is_empty() {
                    rows.push_str(&format!("<row r=\"{}\">{cells}</row>", row + 1));
                }
            }
        }
        worksheets.push(Worksheet {
            name: sheet.name.clone(),
            hidden: sheet.visible != SheetVisible::Visible,
            content: format!("<sheetData>{rows}</sheetData>"),
        });
    }
    package(&worksheets)
}

/// The workbook's files zipped as an .xlsx, sheets in order
pub(super) fn package(sheets: &[Worksheet]) -> Result<Vec<u8>, EditError> {
    let mut parts: Vec<(String, String)> = Vec::new();
    for (index, sheet) in sheets.iter().enumerate() {
        parts.push((
            format!("xl/worksheets/sheet{}.xml", index + 1),
            format!(
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">{}</worksheet>"#,
                sheet.content
            ),
        ));
    }
    let names: String = sheets
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let hidden = if s.hidden { r#" state="hidden""# } else { "" };
            format!(
                r#"<sheet name="{}" sheetId="{}"{hidden} r:id="rId{}"/>"#,
                escape(&s.name),
                i + 1,
                i + 1
            )
        })
        .collect();
    let sheet_rels: String = (1..=sheets.len())
        .map(|i| format!(r#"<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>"#))
        .collect();
    let sheet_types: String = (1..=sheets.len())
        .map(|i| format!(r#"<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>"#))
        .collect();
    let styles_id = sheets.len() + 1;
    parts.extend([
        (
            "[Content_Types].xml".to_string(),
            format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>{sheet_types}</Types>"#),
        ),
        (
            "_rels/.rels".to_string(),
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#.to_string(),
        ),
        (
            "xl/workbook.xml".to_string(),
            // Recalculated on opening: formulas come with the values the original last saved
            format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>{names}</sheets><calcPr fullCalcOnLoad="1"/></workbook>"#),
        ),
        (
            "xl/_rels/workbook.xml.rels".to_string(),
            format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{sheet_rels}<Relationship Id="rId{styles_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"#),
        ),
        ("xl/styles.xml".to_string(), STYLES.to_string()),
    ]);
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (name, xml) in parts {
        zip.start_file(name, options)
            .map_err(|_| EditError::Damaged)?;
        zip.write_all(xml.as_bytes())
            .map_err(|_| EditError::Damaged)?;
    }
    Ok(zip.finish().map_err(|_| EditError::Damaged)?.into_inner())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::spreadsheet::tests::sample_xlsx;
    use crate::spreadsheet::workbook_text;

    #[test]
    fn translates_opendocument_formulas() {
        assert_eq!(
            excel_formula("of:=SUM([.B2:.B4])").as_deref(),
            Some("SUM(B2:B4)")
        );
        assert_eq!(
            excel_formula("of:=IF([.A1]>0;[$'Hoja 2'.$C$3];\"a;b\")").as_deref(),
            Some("IF(A1>0,'Hoja 2'!C3,\"a;b\")")
        );
        assert_eq!(
            excel_formula("of:=[$Resumen.B2:.B4]").as_deref(),
            Some("Resumen!B2:B4")
        );
        assert_eq!(excel_formula("of:=[.C2]*0.21").as_deref(), Some("C2*0.21"));
        assert_eq!(excel_formula("of:=ORG.OPENOFFICE.STYLE(\"x\")"), None);
        assert_eq!(excel_formula("of:=[.A1"), None);
    }

    /// The smallest OpenDocument spreadsheet: a text, a number and a formula written as OpenDocument does
    pub(crate) fn sample_ods() -> Vec<u8> {
        let content = r#"<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:spreadsheet><table:table table:name="Socios"><table:table-row><table:table-cell office:value-type="string"><text:p>Nombre</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Cuota</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell office:value-type="string"><text:p>Marta</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="20"><text:p>20</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell office:value-type="string"><text:p>Total</text:p></table:table-cell><table:table-cell table:formula="of:=SUM([.B2:.B2])*1.5" office:value-type="float" office:value="30"><text:p>30</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>"#;
        let manifest = r#"<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>"#;
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        zip.start_file("mimetype", stored).unwrap();
        zip.write_all(b"application/vnd.oasis.opendocument.spreadsheet")
            .unwrap();
        zip.start_file("META-INF/manifest.xml", stored).unwrap();
        zip.write_all(manifest.as_bytes()).unwrap();
        zip.start_file("content.xml", stored).unwrap();
        zip.write_all(content.as_bytes()).unwrap();
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn turns_an_opendocument_spreadsheet_into_one_nyra_can_write() {
        let ods = sample_ods();
        assert!(!crate::spreadsheet::cells::is_writable(&ods));
        let copy = to_xlsx(&ods).unwrap();
        let text = workbook_text(&copy, 10_000).unwrap();
        assert!(text.contains("| 2 | Marta | 20 |"), "{text}");
        assert!(
            text.contains("| 3 | Total | =SUM(B2:B2)*1.5 → 30 |"),
            "{text}"
        );
    }

    #[test]
    fn copies_values_and_formulas_into_a_new_workbook() {
        let copy = to_xlsx(&sample_xlsx()).unwrap();
        assert_eq!(
            workbook_text(&copy, 10_000).unwrap(),
            workbook_text(&sample_xlsx(), 10_000).unwrap()
        );
        assert!(crate::spreadsheet::cells::is_writable(&copy));
    }
}
