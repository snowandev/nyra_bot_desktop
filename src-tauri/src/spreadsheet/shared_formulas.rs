//! A shared formula is written once, in its first cell, and the cells after it only point to it. When Nyra writes
//! over that first cell, the others would lose their formula, so each gets its own, moved to where it is.

use std::collections::HashMap;

use quick_xml::events::Event;
use quick_xml::Reader;

const MAX_ROWS: i64 = 1_048_576;
const MAX_COLUMNS: i64 = 16_384;

/// The formula of a shared group and the cell it was written for
#[derive(Debug, Clone, PartialEq)]
pub struct Master {
    pub row: u32,
    pub column: u32,
    pub formula: String,
}

/// The shared groups whose first cell is about to be replaced, by their "si"
pub fn orphaned(
    xml: &str,
    replaced: impl Fn(u32, u32) -> bool,
) -> Result<HashMap<String, Master>, ()> {
    let mut reader = Reader::from_str(xml);
    let mut cell: Option<(u32, u32)> = None;
    // Inside the <f> of a group's first cell, reading its text
    let mut reading: Option<(String, Master)> = None;
    let mut found = HashMap::new();
    loop {
        match reader.read_event().map_err(|_| ())? {
            Event::Eof => break,
            Event::Start(e) | Event::Empty(e) if e.local_name().as_ref() == "c" => {
                cell = super::cells::attribute(&e, "r").and_then(|r| super::cells::parse_cell(&r));
            }
            Event::Start(e) if e.local_name().as_ref() == "f" => {
                let master = super::cells::attribute(&e, "ref").is_some();
                if let (true, Some(si), Some((row, column))) = (master, shared_index(&e), cell) {
                    if replaced(row, column) {
                        let formula = String::new();
                        reading = Some((
                            si,
                            Master {
                                row,
                                column,
                                formula,
                            },
                        ));
                    }
                }
            }
            Event::Text(text) => {
                if let Some((_, master)) = reading.as_mut() {
                    master.formula.push_str(&text.xml10_content());
                }
            }
            Event::GeneralRef(entity) => {
                if let Some((_, master)) = reading.as_mut() {
                    master
                        .formula
                        .push_str(&unescaped_entity(&entity).ok_or(())?);
                }
            }
            Event::End(e) if e.local_name().as_ref() == "f" => {
                if let Some((si, master)) = reading.take() {
                    found.insert(si, master);
                }
            }
            _ => {}
        }
    }
    Ok(found)
}

fn unescaped_entity(name: &str) -> Option<String> {
    quick_xml::escape::unescape(&format!("&{name};"))
        .ok()
        .map(|s| s.into_owned())
}

/// The group's index when the element is the formula of a shared group
pub fn shared_index(element: &quick_xml::events::BytesStart) -> Option<String> {
    (super::cells::attribute(element, "t").as_deref() == Some("shared"))
        .then(|| super::cells::attribute(element, "si"))
        .flatten()
}

/// The formula as Excel would have it in a cell `rows` and `columns` away: relative references move, those with
/// "$" stay. A reference pushed off the sheet becomes #REF!, as when Excel copies it there.
pub fn moved(formula: &str, rows: i64, columns: i64) -> String {
    let chars: Vec<char> = formula.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        // Text, quoted sheet names and bracketed parts (tables, other workbooks) are copied as they are
        if let Some(close) = match c {
            '"' => Some('"'),
            '\'' => Some('\''),
            '[' => Some(']'),
            _ => None,
        } {
            let end = closing(&chars, i, c, close);
            out.extend(&chars[i..end]);
            i = end;
            continue;
        }
        let starts_word = i == 0 || !is_word(chars[i - 1]);
        if starts_word && (c == '$' || c.is_ascii_alphanumeric()) {
            if let Some((length, text)) = moved_reference(&chars[i..], rows, columns) {
                out.push_str(&text);
                i += length;
                continue;
            }
            let end = (i..chars.len())
                .find(|&j| !is_word(chars[j]))
                .unwrap_or(chars.len());
            out.extend(&chars[i..end.max(i + 1)]);
            i = end.max(i + 1);
            continue;
        }
        out.push(c);
        i += 1;
    }
    out
}

fn is_word(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '.' | '$')
}

/// Past the closing mark; a doubled mark inside quotes is the mark itself, and brackets may nest
fn closing(chars: &[char], start: usize, open: char, close: char) -> usize {
    let mut depth = 0;
    let mut i = start;
    while i < chars.len() {
        let c = chars[i];
        if open == close {
            if c == close && i > start {
                if chars.get(i + 1) == Some(&close) {
                    i += 2;
                    continue;
                }
                return i + 1;
            }
        } else if c == open {
            depth += 1;
        } else if c == close {
            depth -= 1;
            if depth == 0 {
                return i + 1;
            }
        }
        i += 1;
    }
    chars.len()
}

/// A cell ("B3", "$B$3") or a range of whole columns ("A:C"), moved; None when the text there isn't one
fn moved_reference(chars: &[char], rows: i64, columns: i64) -> Option<(usize, String)> {
    let (column, after_column) = part(chars, 0, |c| c.is_ascii_alphabetic())?;
    // Past XFD it is a word, such as a table's name
    if column.1.len() > 3 {
        return None;
    }
    let row = part(chars, after_column, |c| c.is_ascii_digit());
    let end = row.as_ref().map_or(after_column, |(_, end)| *end);
    // A function (LOG10), a name or a sheet's name, not a reference
    if chars
        .get(end)
        .is_some_and(|&c| is_word(c) || c == '(' || c == '!')
    {
        return None;
    }
    let column_text = moved_column(&column, columns);
    match row {
        Some((row, _)) => {
            let row_text = moved_row(&row, rows);
            Some((
                end,
                match (column_text, row_text) {
                    (Some(c), Some(r)) => format!("{c}{r}"),
                    _ => "#REF!".to_string(),
                },
            ))
        }
        // Letters alone are a reference only as one side of a column range
        None => {
            if chars.get(end) != Some(&':') {
                return None;
            }
            let (other, other_end) = part(chars, end + 1, |c| c.is_ascii_alphabetic())?;
            if chars
                .get(other_end)
                .is_some_and(|&c| is_word(c) || c == '(')
            {
                return None;
            }
            Some((
                other_end,
                match (column_text, moved_column(&other, columns)) {
                    (Some(a), Some(b)) => format!("{a}:{b}"),
                    _ => "#REF!".to_string(),
                },
            ))
        }
    }
}

/// One side of a reference: whether it is fixed with "$", its text, and where it ends
fn part(
    chars: &[char],
    start: usize,
    kind: impl Fn(char) -> bool,
) -> Option<((bool, String), usize)> {
    let fixed = chars.get(start) == Some(&'$');
    let from = start + usize::from(fixed);
    let end = (from..chars.len())
        .find(|&j| !kind(chars[j]))
        .unwrap_or(chars.len());
    (end > from).then(|| ((fixed, chars[from..end].iter().collect()), end))
}

fn moved_column((fixed, letters): &(bool, String), by: i64) -> Option<String> {
    if letters.len() > 3 {
        return None;
    }
    let index = letters
        .to_ascii_uppercase()
        .bytes()
        .fold(0i64, |n, b| n * 26 + i64::from(b - b'A' + 1))
        - 1;
    let moved = if *fixed { index } else { index + by };
    (0..MAX_COLUMNS).contains(&moved).then(|| {
        let name = super::column_name(moved as u32);
        if *fixed {
            format!("${name}")
        } else {
            name
        }
    })
}

fn moved_row((fixed, digits): &(bool, String), by: i64) -> Option<String> {
    let number: i64 = digits.parse().ok()?;
    let moved = if *fixed { number } else { number + by };
    (1..=MAX_ROWS).contains(&moved).then(|| {
        if *fixed {
            format!("${moved}")
        } else {
            moved.to_string()
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moves_relative_references_and_keeps_fixed_ones() {
        assert_eq!(moved("B1*2+$C$1+C$1+$C1", 3, 1), "C4*2+$C$1+D$1+$C4");
        assert_eq!(moved("SUM(A1:A3)", 1, 0), "SUM(A2:A4)");
        assert_eq!(moved("SUM(A:A)", 0, 2), "SUM(C:C)");
    }

    #[test]
    fn leaves_text_names_and_functions_alone() {
        assert_eq!(
            moved("IF(A1>0,\"B2 \"\"x\"\"\",LOG10(A1))", 1, 0),
            "IF(A2>0,\"B2 \"\"x\"\"\",LOG10(A2))"
        );
        assert_eq!(
            moved("'Hoja B1'!A1+Ventas!B2", 1, 1),
            "'Hoja B1'!B2+Ventas!C3"
        );
        assert_eq!(moved("Tabla1[Importe]*TRUE", 2, 0), "Tabla1[Importe]*TRUE");
    }

    #[test]
    fn a_reference_off_the_sheet_is_ref_error() {
        assert_eq!(moved("A1-B1", 0, -1), "#REF!-A1");
    }

    #[test]
    fn finds_only_the_groups_whose_first_cell_is_replaced() {
        let xml = r#"<worksheet><sheetData><row r="1">
            <c r="A1"><f t="shared" ref="A1:A3" si="0">B1&amp;"x"</f><v>1</v></c>
            <c r="C1"><f t="shared" ref="C1:C2" si="1">D1</f></c>
        </row><row r="2"><c r="A2"><f t="shared" si="0"/></c></row></sheetData></worksheet>"#;
        let found = orphaned(xml, |row, column| (row, column) == (0, 0)).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(
            found["0"],
            Master {
                row: 0,
                column: 0,
                formula: "B1&\"x\"".into()
            }
        );
    }
}
