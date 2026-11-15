use std::collections::HashSet;
use std::fs;
use std::io::{Cursor, Write};

use base64::Engine;
use serde::Deserialize;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::i18n::t;
use crate::spreadsheet::table::{table_xlsx, TableCell};
use crate::util::{ask_where_to_save, to_message};
use tauri::image::Image;
use tauri::ipc::{InvokeBody, Request};
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
// A long reply at double resolution stays well below this; anything bigger isn't a capture of a message
const MAX_IMAGE_BYTES: usize = 40 * 1024 * 1024;

/// The PNG arrives as the raw request body, so megabytes don't go through JSON as arrays of numbers.
fn png_of<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(bytes)
            if bytes.starts_with(PNG_SIGNATURE) && bytes.len() <= MAX_IMAGE_BYTES =>
        {
            Ok(bytes)
        }
        _ => Err(t("native.share.invalidImage")),
    }
}

#[tauri::command]
pub async fn copy_image(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let image = Image::from_bytes(png_of(&request)?).map_err(to_message)?;
    app.clipboard()
        .write_image(&image)
        .map_err(|_| t("native.share.copyFailed"))
}

/// false when the user closes the save dialog without choosing a place.
#[tauri::command]
pub async fn save_image(app: AppHandle, request: Request<'_>) -> Result<bool, String> {
    let bytes = png_of(&request)?;
    let Some(destination) = ask_where_to_save(
        &app,
        t("native.share.imageFile"),
        Some((&t("native.share.pngFilter"), &["png"])),
    )?
    else {
        return Ok(false);
    };
    fs::write(destination, bytes).map_err(|_| t("native.share.saveImageFailed"))?;
    Ok(true)
}

/// Only a plain `name.<extension>` is offered as the default name; it comes from a model, so anything else is replaced.
pub(crate) fn document_filename(requested: &str, extension: &str) -> String {
    // Letters of any script: a document titled in Chinese or Japanese keeps its name
    let plain = requested.ends_with(&format!(".{extension}"))
        && requested.chars().count() <= 100
        && requested
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '.')
        && !requested.starts_with('.');
    if plain {
        requested.to_string()
    } else {
        format!("{}.{extension}", t("native.share.fallbackName"))
    }
}

const PDF_SIGNATURE: &[u8] = b"%PDF-";
// A long report is a few hundred kilobytes; this is far above any document Nyra writes
const MAX_PDF_BYTES: usize = 50 * 1024 * 1024;

/// The PDF arrives as the raw request body and its suggested name in a header, like the images.
/// false when the user closes the save dialog without choosing a place.
#[tauri::command]
pub async fn save_pdf(app: AppHandle, request: Request<'_>) -> Result<bool, String> {
    let bytes = match request.body() {
        InvokeBody::Raw(bytes)
            if bytes.starts_with(PDF_SIGNATURE) && bytes.len() <= MAX_PDF_BYTES =>
        {
            bytes
        }
        _ => return Err(t("native.share.invalidPdf")),
    };
    let requested = request
        .headers()
        .get("x-filename")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let Some(destination) = ask_where_to_save(
        &app,
        document_filename(requested, "pdf"),
        Some(("PDF", &["pdf"])),
    )?
    else {
        return Ok(false);
    };
    fs::write(destination, bytes).map_err(|_| t("native.share.savePdfFailed"))?;
    Ok(true)
}

/// false when the user closes the save dialog without choosing a place.
#[tauri::command]
pub async fn save_markdown(
    app: AppHandle,
    filename: String,
    content: String,
) -> Result<bool, String> {
    let Some(destination) = ask_where_to_save(
        &app,
        document_filename(&filename, "md"),
        Some(("Markdown", &["md"])),
    )?
    else {
        return Ok(false);
    };
    fs::write(destination, content).map_err(|_| t("native.share.saveDocumentFailed"))?;
    Ok(true)
}

// Many screenshots at their highest quality fit well below this
const MAX_ZIP_BYTES: usize = 200 * 1024 * 1024;

/// An image of the conversation that a document shows, by the file name its link uses; base64
#[derive(Deserialize)]
pub struct DocumentImage {
    name: String,
    data: String,
}

/// Only a name, never a path: inside the .zip it goes next to the Markdown, where its link points
fn is_plain_file_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 200
        && !name.starts_with('.')
        && !name.contains(['/', '\\', '\0'])
}

/// The Markdown and the images it shows, side by side, so its links work once unzipped. An image without a plain name,
/// or named twice, is left out.
fn markdown_zip(
    markdown_name: &str,
    content: &str,
    images: &[DocumentImage],
) -> Result<Vec<u8>, String> {
    let failed = |_| t("native.share.saveDocumentFailed");
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let text = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    // PNG and JPEG are compressed already
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    zip.start_file(markdown_name, text).map_err(failed)?;
    zip.write_all(content.as_bytes())
        .map_err(|_| t("native.share.saveDocumentFailed"))?;
    let mut names = HashSet::from([markdown_name.to_string()]);
    let mut total = content.len();
    for image in images {
        if !is_plain_file_name(&image.name) || !names.insert(image.name.clone()) {
            continue;
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&image.data)
            .map_err(|_| t("native.share.saveDocumentFailed"))?;
        total += bytes.len();
        if total > MAX_ZIP_BYTES {
            return Err(t("native.share.documentTooLarge"));
        }
        zip.start_file(image.name.as_str(), stored)
            .map_err(failed)?;
        zip.write_all(&bytes)
            .map_err(|_| t("native.share.saveDocumentFailed"))?;
    }
    Ok(zip.finish().map_err(failed)?.into_inner())
}

/// A document that shows images of the conversation: the Markdown and those images in one .zip.
/// false when the user closes the save dialog without choosing a place.
#[tauri::command]
pub async fn save_markdown_zip(
    app: AppHandle,
    filename: String,
    content: String,
    images: Vec<DocumentImage>,
) -> Result<bool, String> {
    let markdown_name = document_filename(&filename, "md");
    let zip = markdown_zip(&markdown_name, &content, &images)?;
    let suggested = format!("{}.zip", markdown_name.trim_end_matches(".md"));
    let Some(destination) = ask_where_to_save(&app, suggested, Some(("ZIP", &["zip"])))? else {
        return Ok(false);
    };
    fs::write(destination, zip).map_err(|_| t("native.share.saveDocumentFailed"))?;
    Ok(true)
}

/// A table from a reply as an Excel workbook, its first row the header. false when the user closes the save dialog.
#[tauri::command]
pub async fn save_table(
    app: AppHandle,
    filename: String,
    rows: Vec<Vec<TableCell>>,
) -> Result<bool, String> {
    let xlsx = table_xlsx(&t("native.share.tableSheet"), &rows)
        .ok_or_else(|| t("native.share.invalidTable"))?
        .map_err(|_| t("native.share.saveTableFailed"))?;
    let Some(destination) = ask_where_to_save(
        &app,
        document_filename(&filename, "xlsx"),
        Some((&t("native.share.excelFilter"), &["xlsx"])),
    )?
    else {
        return Ok(false);
    };
    fs::write(destination, xlsx).map_err(|_| t("native.share.saveTableFailed"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_png_by_its_signature() {
        assert!(b"\x89PNG\r\n\x1a\nrest".starts_with(PNG_SIGNATURE));
        assert!(!b"GIF89a".starts_with(PNG_SIGNATURE));
    }

    #[test]
    fn only_offers_plain_markdown_names() {
        assert_eq!(
            document_filename("instalar-python.md", "md"),
            "instalar-python.md"
        );
        let fallback = |extension: &str| format!("{}.{extension}", t("native.share.fallbackName"));
        assert_eq!(document_filename("../secreto.md", "md"), fallback("md"));
        assert_eq!(document_filename("notas.sh", "md"), fallback("md"));
        assert_eq!(document_filename(".md", "md"), fallback("md"));
        assert_eq!(document_filename("informe.pdf", "pdf"), "informe.pdf");
        assert_eq!(document_filename("东京会议.md", "md"), "东京会议.md");
        assert_eq!(document_filename("会議/メモ.md", "md"), fallback("md"));
        assert_eq!(document_filename("informe.md", "pdf"), fallback("pdf"));
    }

    #[test]
    fn zips_the_markdown_with_the_images_it_shows() {
        use std::io::Read;
        let png = base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\nimagen");
        let image = |name: &str| DocumentImage {
            name: name.to_string(),
            data: png.clone(),
        };
        let images = [
            image("Panel de ventas.png"),
            image("Panel de ventas.png"),
            image("../fuera.png"),
            image(".oculta.png"),
            image("carpeta/otra.png"),
        ];
        let bytes =
            markdown_zip("informe.md", "![Panel](Panel%20de%20ventas.png)", &images).unwrap();
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        // The Markdown and one copy of the image with a plain name; the others are left out
        assert_eq!(zip.len(), 2);
        let mut markdown = String::new();
        zip.by_name("informe.md")
            .unwrap()
            .read_to_string(&mut markdown)
            .unwrap();
        assert!(markdown.contains("Panel%20de%20ventas.png"));
        let mut picture = Vec::new();
        zip.by_name("Panel de ventas.png")
            .unwrap()
            .read_to_end(&mut picture)
            .unwrap();
        assert!(picture.starts_with(b"\x89PNG"));
    }
}
