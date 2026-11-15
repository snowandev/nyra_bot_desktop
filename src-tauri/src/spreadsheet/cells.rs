//! Writing cells into an .xlsx or .xlsm without rewriting the rest. A workbook is a zip of XML parts: only the
//! sheets with changes (and the workbook, to ask for recalculation) are written again, and inside a sheet only the
//! changed cells; every other part (styles, charts, pictures, macros) is copied byte for byte.

use std::collections::{BTreeMap, HashMap};
use std::io::{Cursor, Read, Write};

use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, Writer, XmlVersion};

use super::shared_formulas;
use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const WORKBOOK: &str = "xl/workbook.xml";
const WORKBOOK_RELS: &str = "xl/_rels/workbook.xml.rels";
const CONTENT_TYPES: &str = "[Content_Types].xml";
// Excel's list of formulas in calculation order; after a change it may name cells that no longer hold one, and
// Excel rebuilds it when it's missing
const CALC_CHAIN: &str = "xl/calcChain.xml";

/// A cell as the model asked for it: where, and the value as written ("120", "=SUM(B2:B9)", "Luz", "")
#[derive(Deserialize, Debug, Clone)]
pub struct CellEdit {
    pub sheet: String,
    pub cell: String,
    pub value: String,
}

const MAX_PART_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum EditError {
    /// .xls and .ods are read, never written
    ReadOnly,
    Damaged,
    SheetMissing {
        sheet: String,
    },
    SheetProtected {
        sheet: String,
    },
    BadCell {
        cell: String,
    },
}

#[derive(Debug, PartialEq)]
enum Value {
    Empty,
    Number(String),
    Bool(bool),
    Formula(String),
    Text(String),
}

/// "B3" as (row, column) from 0
pub fn parse_cell(cell: &str) -> Option<(u32, u32)> {
    let cell = cell.trim().replace('$', "").to_uppercase();
    let split = cell.find(|c: char| c.is_ascii_digit())?;
    let (letters, digits) = cell.split_at(split);
    if letters.is_empty() || letters.len() > 3 || !letters.chars().all(|c| c.is_ascii_uppercase()) {
        return None;
    }
    let column = letters
        .bytes()
        .fold(0u32, |n, b| n * 26 + u32::from(b - b'A' + 1))
        - 1;
    let row: u32 = digits.parse().ok()?;
    ((1..=1_048_576).contains(&row) && column < 16_384).then(|| (row - 1, column))
}

fn is_number(text: &str) -> bool {
    let body = text.strip_prefix('-').unwrap_or(text);
    !body.is_empty()
        && !body.starts_with('.')
        && body
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '.' | 'e' | 'E' | '+' | '-'))
        && text.parse::<f64>().is_ok_and(f64::is_finite)
}

/// What the model wrote, read as a spreadsheet would: "=" starts a formula, a leading "'" keeps digits as text
/// ("'00123"), and a number uses "." for decimals whatever the user's language
fn value_of(written: &str) -> Value {
    let text = written.trim();
    if text.is_empty() {
        return Value::Empty;
    }
    if let Some(formula) = text.strip_prefix('=') {
        // A formula copied from what Nyra showed the model may still carry its value: "=SUM(B2:C2) → 1600"
        let formula = formula
            .rsplit_once(" → ")
            .map_or(formula, |(f, _)| f)
            .trim();
        return Value::Formula(formula.to_string());
    }
    if let Some(literal) = text.strip_prefix('\'') {
        return Value::Text(literal.to_string());
    }
    match text.to_uppercase().as_str() {
        "TRUE" => return Value::Bool(true),
        "FALSE" => return Value::Bool(false),
        _ => {}
    }
    if is_number(text) {
        return Value::Number(text.to_string());
    }
    Value::Text(text.to_string())
}

fn escape(text: &str) -> String {
    quick_xml::escape::escape(text).into_owned()
}

pub(super) fn attribute(element: &BytesStart, name: &str) -> Option<String> {
    element
        .attributes()
        .with_checks(false)
        .flatten()
        .find(|a| a.key.as_ref() == name)
        .and_then(|a| {
            a.normalized_value(XmlVersion::Implicit1_0)
                .ok()
                .map(|v| v.into_owned())
        })
}

/// The cell's XML, keeping its style; None for an emptied cell without one, which is just left out
fn cell_xml(prefix: &str, reference: &str, style: Option<&str>, value: &Value) -> Option<String> {
    let style = style
        .map(|s| format!(" s=\"{}\"", escape(s)))
        .unwrap_or_default();
    let p = prefix;
    Some(match value {
        Value::Empty if style.is_empty() => return None,
        Value::Empty => format!("<{p}c r=\"{reference}\"{style}/>"),
        Value::Number(n) => format!("<{p}c r=\"{reference}\"{style}><{p}v>{n}</{p}v></{p}c>"),
        Value::Bool(b) => format!("<{p}c r=\"{reference}\"{style} t=\"b\"><{p}v>{}</{p}v></{p}c>", u8::from(*b)),
        // Without a cached value: the workbook asks to be recalculated on opening
        Value::Formula(f) => format!("<{p}c r=\"{reference}\"{style}><{p}f>{}</{p}f></{p}c>", escape(f)),
        Value::Text(t) => format!(
            "<{p}c r=\"{reference}\"{style} t=\"inlineStr\"><{p}is><{p}t xml:space=\"preserve\">{}</{p}t></{p}is></{p}c>",
            escape(t)
        ),
    })
}

fn column_letters(column: u32) -> String {
    super::column_name(column)
}

fn cell_reference(row: u32, column: u32) -> String {
    format!("{}{}", column_letters(column), row + 1)
}

type SheetEdits = BTreeMap<u32, BTreeMap<u32, Value>>;

/// The element's name with the document's prefix ("x:c" when the sheet writes its tags as "x:worksheet")
fn prefix_of(name: &str) -> String {
    name.split_once(':')
        .map(|(prefix, _)| format!("{prefix}:"))
        .unwrap_or_default()
}

fn local(name: &str) -> &str {
    name.split_once(':').map_or(name, |(_, local)| local)
}

struct SheetWriter {
    out: Writer<Vec<u8>>,
    prefix: String,
}

impl SheetWriter {
    fn raw(&mut self, text: &str) -> Result<(), EditError> {
        self.out
            .get_mut()
            .write_all(text.as_bytes())
            .map_err(|_| EditError::Damaged)
    }

    fn event(&mut self, event: Event) -> Result<(), EditError> {
        self.out.write_event(event).map_err(|_| EditError::Damaged)
    }

    fn cells(&mut self, row: u32, cells: BTreeMap<u32, Value>) -> Result<(), EditError> {
        for (column, value) in cells {
            if let Some(xml) = cell_xml(&self.prefix, &cell_reference(row, column), None, &value) {
                self.raw(&xml)?;
            }
        }
        Ok(())
    }

    /// A row that only exists because of the changes
    fn new_row(&mut self, row: u32, cells: BTreeMap<u32, Value>) -> Result<(), EditError> {
        if cells.values().all(|v| *v == Value::Empty) {
            return Ok(());
        }
        let p = self.prefix.clone();
        self.raw(&format!("<{p}row r=\"{}\">", row + 1))?;
        self.cells(row, cells)?;
        self.raw(&format!("</{p}row>"))
    }

    fn rows_before(&mut self, edits: &mut SheetEdits, row: u32) -> Result<(), EditError> {
        while let Some(entry) = edits.first_entry() {
            if *entry.key() >= row {
                break;
            }
            let (r, cells) = entry.remove_entry();
            self.new_row(r, cells)?;
        }
        Ok(())
    }

    fn cells_before(
        &mut self,
        row: u32,
        cells: &mut BTreeMap<u32, Value>,
        column: u32,
    ) -> Result<(), EditError> {
        let earlier: Vec<u32> = cells.range(..column).map(|(c, _)| *c).collect();
        let taken = earlier
            .into_iter()
            .filter_map(|c| cells.remove_entry(&c))
            .collect();
        self.cells(row, taken)
    }
}

/// The row start without "spans", a hint of which columns it uses that the changes may make wrong
fn row_start(element: &BytesStart) -> BytesStart<'static> {
    let mut start = BytesStart::new(element.name().as_ref().to_string());
    for attr in element.attributes().with_checks(false).flatten() {
        if attr.key.as_ref() != "spans" {
            start.push_attribute(attr);
        }
    }
    start
}

/// The sheet's XML with the changed cells written in place, in row and column order as Excel requires
fn patch_sheet(xml: &str, mut edits: SheetEdits) -> Result<String, EditError> {
    let mut reader = Reader::from_str(xml);
    let mut sheet = SheetWriter {
        out: Writer::new(Vec::new()),
        prefix: String::new(),
    };
    let mut in_data = false;
    // The row being copied, its pending changes and the last cell seen (cells and rows may omit their position)
    let mut row: Option<(u32, BTreeMap<u32, Value>)> = None;
    let mut last_row: Option<u32> = None;
    let mut last_column: Option<u32> = None;
    // Inside a replaced cell, how deep, to drop it entirely
    let mut skipping = 0usize;
    let orphans = shared_formulas::orphaned(xml, |r, c| {
        edits.get(&r).is_some_and(|cells| cells.contains_key(&c))
    })
    .map_err(|_| EditError::Damaged)?;
    let mut cell: Option<(u32, u32)> = None;
    loop {
        let event = reader.read_event().map_err(|_| EditError::Damaged)?;
        if skipping > 0 {
            match event {
                Event::Start(_) => skipping += 1,
                Event::End(_) => skipping -= 1,
                Event::Eof => return Err(EditError::Damaged),
                _ => {}
            }
            continue;
        }
        match &event {
            Event::Eof => break,
            Event::Start(e) if e.local_name().as_ref() == "worksheet" => {
                sheet.prefix = prefix_of(e.name().as_ref());
            }
            Event::Start(e) if e.local_name().as_ref() == "sheetData" => in_data = true,
            Event::Empty(e) if e.local_name().as_ref() == "sheetData" => {
                let p = sheet.prefix.clone();
                sheet.raw(&format!("<{p}sheetData>"))?;
                sheet.rows_before(&mut edits, u32::MAX)?;
                sheet.raw(&format!("</{p}sheetData>"))?;
                continue;
            }
            Event::End(e) if local(e.name().as_ref()) == "sheetData" => {
                sheet.rows_before(&mut edits, u32::MAX)?;
                in_data = false;
            }
            Event::Start(e) | Event::Empty(e) if in_data && e.local_name().as_ref() == "row" => {
                let number = attribute(e, "r")
                    .and_then(|r| r.parse::<u32>().ok())
                    .map(|r| r.saturating_sub(1))
                    .unwrap_or_else(|| last_row.map_or(0, |r| r + 1));
                last_row = Some(number);
                last_column = None;
                sheet.rows_before(&mut edits, number)?;
                let changes = edits.remove(&number).unwrap_or_default();
                let is_empty = matches!(event, Event::Empty(_));
                if changes.is_empty() {
                    sheet.event(event.clone())?;
                    if !is_empty {
                        row = Some((number, changes));
                    }
                    continue;
                }
                sheet.event(Event::Start(row_start(e)))?;
                if is_empty {
                    sheet.cells(number, changes)?;
                    let p = sheet.prefix.clone();
                    sheet.raw(&format!("</{p}row>"))?;
                } else {
                    row = Some((number, changes));
                }
                continue;
            }
            Event::End(e) if in_data && local(e.name().as_ref()) == "row" => {
                if let Some((number, changes)) = row.take() {
                    sheet.cells(number, changes)?;
                }
            }
            Event::Start(e) | Event::Empty(e)
                if row.is_some() && e.local_name().as_ref() == "c" =>
            {
                let column = attribute(e, "r")
                    .and_then(|r| parse_cell(&r))
                    .map(|(_, c)| c)
                    .unwrap_or_else(|| last_column.map_or(0, |c| c + 1));
                last_column = Some(column);
                if let Some((number, changes)) = row.as_mut() {
                    let number = *number;
                    cell = Some((number, column));
                    let mut pending = std::mem::take(changes);
                    sheet.cells_before(number, &mut pending, column)?;
                    let replaced = pending.remove(&column);
                    *changes = pending;
                    if let Some(value) = replaced {
                        let style = attribute(e, "s");
                        let prefix = sheet.prefix.clone();
                        if let Some(xml) = cell_xml(
                            &prefix,
                            &cell_reference(number, column),
                            style.as_deref(),
                            &value,
                        ) {
                            sheet.raw(&xml)?;
                        }
                        if matches!(event, Event::Start(_)) {
                            skipping = 1;
                        }
                        continue;
                    }
                }
            }
            // A cell that pointed to a shared formula Nyra is writing over gets the formula itself
            Event::Start(e) | Event::Empty(e)
                if row.is_some() && e.local_name().as_ref() == "f" =>
            {
                let master = shared_formulas::shared_index(e).and_then(|si| orphans.get(&si));
                if let (Some(master), Some((r, c))) = (master, cell) {
                    let formula = shared_formulas::moved(
                        &master.formula,
                        i64::from(r) - i64::from(master.row),
                        i64::from(c) - i64::from(master.column),
                    );
                    let p = sheet.prefix.clone();
                    sheet.raw(&format!("<{p}f>{}</{p}f>", escape(&formula)))?;
                    if matches!(event, Event::Start(_)) {
                        skipping = 1;
                    }
                    continue;
                }
            }
            _ => {}
        }
        sheet.event(event)?;
    }
    if !edits.is_empty() {
        return Err(EditError::Damaged);
    }
    String::from_utf8(sheet.out.into_inner()).map_err(|_| EditError::Damaged)
}

/// "fullCalcOnLoad": Excel and LibreOffice recalculate every formula when they open the file, so the cells Nyra
/// wrote get their values (Nyra doesn't compute formulas)
fn ask_for_recalculation(xml: &str) -> Result<String, EditError> {
    let mut reader = Reader::from_str(xml);
    let mut out = Writer::new(Vec::new());
    let mut prefix = String::new();
    let mut done = false;
    loop {
        let event = reader.read_event().map_err(|_| EditError::Damaged)?;
        match &event {
            Event::Eof => break,
            Event::Start(e) if e.local_name().as_ref() == "workbook" => {
                prefix = prefix_of(e.name().as_ref())
            }
            Event::Empty(e) | Event::Start(e) if e.local_name().as_ref() == "calcPr" => {
                let mut calc = BytesStart::new(e.name().as_ref().to_string());
                for attr in e.attributes().with_checks(false).flatten() {
                    if attr.key.as_ref() != "fullCalcOnLoad" {
                        calc.push_attribute(attr);
                    }
                }
                calc.push_attribute(("fullCalcOnLoad", "1"));
                let calc = if matches!(event, Event::Empty(_)) {
                    Event::Empty(calc)
                } else {
                    Event::Start(calc)
                };
                out.write_event(calc).map_err(|_| EditError::Damaged)?;
                done = true;
                continue;
            }
            // Its place in the workbook is right after the sheets and the defined names
            Event::Start(e) | Event::Empty(e)
                if !done
                    && matches!(
                        e.local_name().as_ref(),
                        "oleSize"
                            | "customWorkbookViews"
                            | "pivotCaches"
                            | "smartTagPr"
                            | "smartTagTypes"
                            | "webPublishing"
                            | "fileRecoveryPr"
                            | "webPublishObjects"
                            | "extLst"
                    ) =>
            {
                out.get_mut()
                    .write_all(format!("<{prefix}calcPr fullCalcOnLoad=\"1\"/>").as_bytes())
                    .map_err(|_| EditError::Damaged)?;
                done = true;
            }
            Event::End(e) if !done && local(e.name().as_ref()) == "workbook" => {
                out.get_mut()
                    .write_all(format!("<{prefix}calcPr fullCalcOnLoad=\"1\"/>").as_bytes())
                    .map_err(|_| EditError::Damaged)?;
                done = true;
            }
            _ => {}
        }
        out.write_event(event).map_err(|_| EditError::Damaged)?;
    }
    String::from_utf8(out.into_inner()).map_err(|_| EditError::Damaged)
}

/// The part without the elements matching drop (the calculation chain's relationship and content type)
fn without_elements(xml: &str, drop: impl Fn(&BytesStart) -> bool) -> Result<String, EditError> {
    let mut reader = Reader::from_str(xml);
    let mut out = Writer::new(Vec::new());
    loop {
        let event = reader.read_event().map_err(|_| EditError::Damaged)?;
        match &event {
            Event::Eof => break,
            Event::Empty(e) if drop(e) => continue,
            _ => {}
        }
        out.write_event(event).map_err(|_| EditError::Damaged)?;
    }
    String::from_utf8(out.into_inner()).map_err(|_| EditError::Damaged)
}

fn read_part<R: Read + std::io::Seek>(
    zip: &mut ZipArchive<R>,
    name: &str,
) -> Result<Option<String>, EditError> {
    let Ok(file) = zip.by_name(name) else {
        return Ok(None);
    };
    // A small file can unpack to gigabytes; a real sheet never comes near this
    let mut text = String::new();
    file.take(MAX_PART_BYTES + 1)
        .read_to_string(&mut text)
        .map_err(|_| EditError::Damaged)?;
    if text.len() as u64 > MAX_PART_BYTES {
        return Err(EditError::Damaged);
    }
    Ok(Some(text))
}

/// Each sheet's name and the part that holds it ("xl/worksheets/sheet1.xml")
fn sheet_parts(workbook: &str, rels: &str) -> Result<HashMap<String, String>, EditError> {
    let mut targets = HashMap::new();
    let mut reader = Reader::from_str(rels);
    loop {
        match reader.read_event().map_err(|_| EditError::Damaged)? {
            Event::Eof => break,
            Event::Empty(e) | Event::Start(e) if e.local_name().as_ref() == "Relationship" => {
                if let (Some(id), Some(target)) = (attribute(&e, "Id"), attribute(&e, "Target")) {
                    let part = match target.strip_prefix('/') {
                        Some(absolute) => absolute.to_string(),
                        None => format!("xl/{target}"),
                    };
                    targets.insert(id, part);
                }
            }
            _ => {}
        }
    }
    let mut sheets = HashMap::new();
    let mut reader = Reader::from_str(workbook);
    loop {
        match reader.read_event().map_err(|_| EditError::Damaged)? {
            Event::Eof => break,
            Event::Empty(e) | Event::Start(e) if e.local_name().as_ref() == "sheet" => {
                let name = attribute(&e, "name");
                // The relationship id is in the relationships namespace, whatever prefix the file gives it
                let id = e
                    .attributes()
                    .with_checks(false)
                    .flatten()
                    .find(|a| a.key.as_ref() != "sheetId" && local(a.key.as_ref()) == "id")
                    .and_then(|a| {
                        a.normalized_value(XmlVersion::Implicit1_0)
                            .ok()
                            .map(|v| v.into_owned())
                    });
                if let (Some(name), Some(part)) =
                    (name, id.and_then(|id| targets.get(&id).cloned()))
                {
                    sheets.insert(name, part);
                }
            }
            _ => {}
        }
    }
    Ok(sheets)
}

fn is_protected(sheet: &str) -> Result<bool, EditError> {
    let mut reader = Reader::from_str(sheet);
    loop {
        match reader.read_event().map_err(|_| EditError::Damaged)? {
            Event::Eof => return Ok(false),
            Event::Empty(e) | Event::Start(e) if e.local_name().as_ref() == "sheetProtection" => {
                return Ok(true)
            }
            _ => {}
        }
    }
}

/// .xlsx and .xlsm: a zip with a workbook part
pub fn is_writable(bytes: &[u8]) -> bool {
    ZipArchive::new(Cursor::new(bytes)).is_ok_and(|mut zip| zip.by_name(WORKBOOK).is_ok())
}

/// The names of the sheets Excel protects
pub fn protected_sheets(bytes: &[u8]) -> std::collections::HashSet<String> {
    let mut names = std::collections::HashSet::new();
    let Ok(mut zip) = ZipArchive::new(Cursor::new(bytes)) else {
        return names;
    };
    let (Ok(Some(workbook)), Ok(Some(rels))) = (
        read_part(&mut zip, WORKBOOK),
        read_part(&mut zip, WORKBOOK_RELS),
    ) else {
        return names;
    };
    for (name, part) in sheet_parts(&workbook, &rels).unwrap_or_default() {
        if read_part(&mut zip, &part)
            .ok()
            .flatten()
            .is_some_and(|xml| is_protected(&xml).unwrap_or(false))
        {
            names.insert(name);
        }
    }
    names
}

/// The workbook with the edits written. Nothing is written if any of them can't be.
pub fn edit_workbook(bytes: &[u8], edits: &[CellEdit]) -> Result<Vec<u8>, EditError> {
    let mut zip = ZipArchive::new(Cursor::new(bytes)).map_err(|_| EditError::ReadOnly)?;
    let workbook = read_part(&mut zip, WORKBOOK)?.ok_or(EditError::ReadOnly)?;
    let rels = read_part(&mut zip, WORKBOOK_RELS)?.ok_or(EditError::Damaged)?;
    let parts = sheet_parts(&workbook, &rels)?;

    let mut by_part: HashMap<String, SheetEdits> = HashMap::new();
    for edit in edits {
        let part = parts
            .get(&edit.sheet)
            .ok_or_else(|| EditError::SheetMissing {
                sheet: edit.sheet.clone(),
            })?;
        let (row, column) = parse_cell(&edit.cell).ok_or_else(|| EditError::BadCell {
            cell: edit.cell.clone(),
        })?;
        by_part
            .entry(part.clone())
            .or_default()
            .entry(row)
            .or_default()
            .insert(column, value_of(&edit.value));
    }
    let mut written: HashMap<String, String> = HashMap::new();
    for (part, sheet_edits) in by_part {
        let xml = read_part(&mut zip, &part)?.ok_or(EditError::Damaged)?;
        if is_protected(&xml)? {
            let sheet = parts
                .iter()
                .find(|(_, p)| **p == part)
                .map(|(n, _)| n.clone())
                .unwrap_or_default();
            return Err(EditError::SheetProtected { sheet });
        }
        written.insert(part, patch_sheet(&xml, sheet_edits)?);
    }
    written.insert(WORKBOOK.to_string(), ask_for_recalculation(&workbook)?);
    written.insert(
        WORKBOOK_RELS.to_string(),
        without_elements(&rels, |e| {
            attribute(e, "Type").is_some_and(|t| t.ends_with("/calcChain"))
        })?,
    );
    if let Some(types) = read_part(&mut zip, CONTENT_TYPES)? {
        let without = without_elements(&types, |e| {
            attribute(e, "PartName").as_deref() == Some("/xl/calcChain.xml")
        })?;
        written.insert(CONTENT_TYPES.to_string(), without);
    }

    let mut out = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for index in 0..zip.len() {
        let file = zip.by_index_raw(index).map_err(|_| EditError::Damaged)?;
        let name = file.name().map_err(|_| EditError::Damaged)?.into_owned();
        if name == CALC_CHAIN {
            continue;
        }
        match written.remove(&name) {
            Some(xml) => {
                drop(file);
                out.start_file(name, options)
                    .map_err(|_| EditError::Damaged)?;
                out.write_all(xml.as_bytes())
                    .map_err(|_| EditError::Damaged)?;
            }
            None => out.raw_copy_file(file).map_err(|_| EditError::Damaged)?,
        }
    }
    Ok(out.finish().map_err(|_| EditError::Damaged)?.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spreadsheet::tests::sample_xlsx;
    use crate::spreadsheet::workbook_text;

    fn edit(cell: &str, value: &str) -> CellEdit {
        CellEdit {
            sheet: "Ventas".to_string(),
            cell: cell.to_string(),
            value: value.to_string(),
        }
    }

    fn part(bytes: &[u8], name: &str) -> String {
        let mut zip = ZipArchive::new(Cursor::new(bytes)).unwrap();
        read_part(&mut zip, name).unwrap().unwrap()
    }

    #[test]
    fn reads_cell_positions() {
        assert_eq!(parse_cell("B3"), Some((2, 1)));
        assert_eq!(parse_cell("$aa$10"), Some((9, 26)));
        assert_eq!(parse_cell("B0"), None);
        assert_eq!(parse_cell("3B"), None);
        assert_eq!(parse_cell("ABCD1"), None);
    }

    #[test]
    fn reads_values_as_a_spreadsheet_would() {
        assert_eq!(value_of("120"), Value::Number("120".into()));
        assert_eq!(value_of("-1.5e3"), Value::Number("-1.5e3".into()));
        assert_eq!(value_of("=SUM(B2:B9)"), Value::Formula("SUM(B2:B9)".into()));
        assert_eq!(value_of("=B2*C2 → 15"), Value::Formula("B2*C2".into()));
        assert_eq!(value_of("'00123"), Value::Text("00123".into()));
        assert_eq!(value_of("true"), Value::Bool(true));
        assert_eq!(value_of("1,5"), Value::Text("1,5".into()));
        assert_eq!(value_of(".5"), Value::Text(".5".into()));
        assert_eq!(value_of("  "), Value::Empty);
        assert_eq!(value_of("Luz & agua"), Value::Text("Luz & agua".into()));
    }

    #[test]
    fn changes_adds_and_empties_cells_in_order_and_keeps_the_rest() {
        let original = sample_xlsx();
        let edited = edit_workbook(
            &original,
            &[
                edit("B2", "12"),
                edit("A3", "Uva"),
                edit("E2", "=D2*2"),
                edit("A1", "Producto <nuevo>"),
                edit("B4", ""),
                edit("C9", "TRUE"),
            ],
        )
        .unwrap();
        assert_eq!(
            workbook_text(&edited, 10_000).unwrap(),
            "Sheet \"Ventas\" (1 of 1), cells A1:E9\n\
             | | A | B | C | D | E |\n\
             | 1 | Producto <nuevo> | Unidades | Precio | Total |  |\n\
             | 2 | Manzana | 12 | 1.5 | =B2*C2 → 15 | =D2*2 |\n\
             | 3 | Uva |  |  |  |  |\n\
             | 4 | Pera \\| verde |  |  |  |  |\n\
             | 9 |  |  | TRUE |  |  |"
        );
        // The rows keep Excel's order and a recalculation is asked for
        let sheet = part(&edited, "xl/worksheets/sheet1.xml");
        let rows: Vec<usize> = ["r=\"1\"", "r=\"2\"", "r=\"3\"", "r=\"4\"", "r=\"9\""]
            .iter()
            .map(|r| sheet.find(&format!("<row {r}")).unwrap())
            .collect();
        assert!(rows.windows(2).all(|w| w[0] < w[1]));
        assert!(part(&edited, WORKBOOK).contains("fullCalcOnLoad=\"1\""));
    }

    #[test]
    fn copies_untouched_parts_byte_for_byte() {
        let original = sample_xlsx();
        let edited = edit_workbook(&original, &[edit("B2", "12")]).unwrap();
        let mut before = ZipArchive::new(Cursor::new(&original[..])).unwrap();
        let mut after = ZipArchive::new(Cursor::new(&edited[..])).unwrap();
        let raw = |zip: &mut ZipArchive<Cursor<&[u8]>>, name: &str| {
            let mut bytes = Vec::new();
            zip.by_name(name).unwrap().read_to_end(&mut bytes).unwrap();
            bytes
        };
        assert_eq!(
            raw(&mut before, "_rels/.rels"),
            raw(&mut after, "_rels/.rels")
        );
    }

    #[test]
    fn writes_nothing_for_a_missing_sheet_or_a_bad_cell() {
        let original = sample_xlsx();
        let missing = CellEdit {
            sheet: "Otra".into(),
            cell: "A1".into(),
            value: "1".into(),
        };
        assert_eq!(
            edit_workbook(&original, &[edit("B2", "1"), missing]),
            Err(EditError::SheetMissing {
                sheet: "Otra".into()
            })
        );
        assert_eq!(
            edit_workbook(&original, &[edit("ZZ", "1")]),
            Err(EditError::BadCell { cell: "ZZ".into() })
        );
        assert_eq!(
            edit_workbook(b"not a zip", &[edit("A1", "1")]),
            Err(EditError::ReadOnly)
        );
    }

    #[test]
    fn adds_the_recalculation_where_the_workbook_expects_it() {
        let with_calc = r#"<workbook><sheets/><calcPr calcId="191029"/></workbook>"#;
        assert_eq!(
            ask_for_recalculation(with_calc).unwrap(),
            r#"<workbook><sheets/><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>"#
        );
        let without = r#"<x:workbook><x:sheets/><x:extLst/></x:workbook>"#;
        assert_eq!(
            ask_for_recalculation(without).unwrap(),
            r#"<x:workbook><x:sheets/><x:calcPr fullCalcOnLoad="1"/><x:extLst/></x:workbook>"#
        );
    }

    #[test]
    fn keeps_the_style_of_a_changed_cell() {
        let xml = r#"<worksheet><sheetData><row r="1" spans="1:2"><c r="A1" s="3" t="s"><v>0</v></c><c r="B1"><v>2</v></c></row></sheetData></worksheet>"#;
        let mut edits = SheetEdits::new();
        edits
            .entry(0)
            .or_default()
            .insert(0, Value::Number("7".into()));
        assert_eq!(
            patch_sheet(xml, edits).unwrap(),
            r#"<worksheet><sheetData><row r="1"><c r="A1" s="3"><v>7</v></c><c r="B1"><v>2</v></c></row></sheetData></worksheet>"#
        );
    }

    #[test]
    fn cells_sharing_a_replaced_formula_keep_their_own() {
        let xml = r#"<worksheet><sheetData><row r="1"><c r="A1"><f t="shared" ref="A1:A3" si="0">B1*2</f><v>2</v></c></row><row r="2"><c r="A2"><f t="shared" si="0"/><v>4</v></c></row><row r="3"><c r="A3"><f t="shared" si="0"></f><v>6</v></c></row></sheetData></worksheet>"#;
        let mut edits = SheetEdits::new();
        edits
            .entry(0)
            .or_default()
            .insert(0, Value::Number("9".into()));
        assert_eq!(
            patch_sheet(xml, edits).unwrap(),
            r#"<worksheet><sheetData><row r="1"><c r="A1"><v>9</v></c></row><row r="2"><c r="A2"><f>B2*2</f><v>4</v></c></row><row r="3"><c r="A3"><f>B3*2</f><v>6</v></c></row></sheetData></worksheet>"#
        );
    }

    #[test]
    fn refuses_protected_sheets() {
        assert!(
            is_protected(r#"<worksheet><sheetData/><sheetProtection sheet="1"/></worksheet>"#)
                .unwrap()
        );
        assert!(!is_protected(r#"<worksheet><sheetData/></worksheet>"#).unwrap());
    }
}
