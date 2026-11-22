//! Folders the user connects to a conversation so the model can read them. Read only: nothing here writes to them.
//! Only a folder the user picked in the system dialog can be read, and only the files of its latest index, so a
//! path written by the model (or by a page it read) can never reach anything else.

pub mod changes;
pub mod meaning;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine;
use ignore::{DirEntry, WalkBuilder};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::i18n::t;
use crate::spreadsheet::{self, is_spreadsheet};
use crate::storage::{now_millis, Database};
use crate::util::{plain_key, plain_path, real_path, to_message};

// The folder a saved conversation works in. The index on it lets the folders in use be listed without reading every
// conversation; a query uses it only when it writes the same expression.
const SAVED_FOLDER: &str = "json_extract(data, '$.workspace.path')";
pub const SAVED_FOLDER_INDEX: &str =
    "CREATE INDEX IF NOT EXISTS conversations_workspace ON conversations (json_extract(data, '$.workspace.path'));";

pub const SCHEMA: &str = "
    CREATE TABLE workspace_roots (
        path TEXT PRIMARY KEY,
        added_at INTEGER NOT NULL
    );
";

/// Past this the index stops growing; the model still gets a summary of what was found
const MAX_INDEX_FILES: usize = 20_000;
pub(crate) const MAX_READ_BYTES: u64 = 2 * 1024 * 1024;
/// The same limit as an attached PDF; the frontend takes its text out
const MAX_PDF_BYTES: u64 = 10 * 1024 * 1024;
/// The same limit as an attached image; the frontend scales it down before a model sees it
const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;
/// Images a vision model can look at, the same kinds an attachment can be. Binary all the same: never written.
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp"];
pub(crate) const MAX_SEARCH_FILE_BYTES: u64 = 1024 * 1024;
const MAX_SEARCH_SCANNED_BYTES: u64 = 200 * 1024 * 1024;
const MAX_SEARCH_MATCHES: usize = 60;
const MAX_MATCHES_PER_FILE: usize = 5;
const MATCH_PREVIEW_CHARS: usize = 200;
/// Text files don't contain NUL bytes, so one in the first bytes means the file is binary
const BINARY_SNIFF_BYTES: usize = 8000;

/// Dependencies and build output that are rarely in a .gitignore of a folder without git
pub(crate) const SKIPPED_DIRS: &[&str] = &["node_modules", "__pycache__"];
/// Hidden folders that are history, caches or environments, not the project: huge and of no use to read. Other hidden
/// files (CI settings, tool configs, .env.example) are indexed like any other.
const HIDDEN_SKIPPED_DIRS: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    ".venv",
    ".idea",
    ".gradle",
    ".cache",
    ".next",
    ".nuxt",
    ".turbo",
    ".terraform",
    ".pytest_cache",
    ".mypy_cache",
    ".parcel-cache",
    ".yarn",
];
/// Version control internals: never read, not even asked for by path (a remote's address can carry a token)
const VCS_DIRS: &[&str] = &[".git", ".hg", ".svn"];
const BINARY_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "icns", "tiff", "heic", "psd", "mp3", "wav",
    "flac", "ogg", "m4a", "mp4", "mov", "avi", "mkv", "webm", "zip", "gz", "tgz", "bz2", "xz",
    "7z", "rar", "jar", "exe", "dll", "so", "dylib", "a", "o", "obj", "lib", "bin", "dmg", "iso",
    "pkg", "msi", "deb", "rpm", "class", "pyc", "wasm", "woff", "woff2", "ttf", "otf", "eot",
    "doc", "docx", "xls", "xlsx", "ppt", "pptx", "sqlite", "db", "lock",
];

/// The last index of each folder, so a read can check the file is one the user's folder offers
#[derive(Default)]
pub struct Workspaces {
    indexes: Mutex<HashMap<PathBuf, HashSet<String>>>,
    /// Picked in a private conversation: allowed until the app closes, never written down
    session_roots: Mutex<HashSet<PathBuf>>,
}

#[derive(Serialize)]
pub struct ConnectedFolder {
    path: String,
    name: String,
}

#[derive(Serialize, Debug)]
pub struct IndexedFile {
    /// Relative to the folder, always with "/" so it reads the same on every system
    path: String,
    size: u64,
    modified: i64,
}

#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum IndexOutcome {
    Ready {
        files: Vec<IndexedFile>,
        /// Secrets and binaries found and left out
        skipped: usize,
        truncated: bool,
    },
    Missing,
    NoAccess,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SkipReason {
    Secret,
    Ignored,
    Outside,
    Binary,
    TooLarge,
    Missing,
    /// A spreadsheet that can't be opened: damaged or protected with a password
    Unreadable,
    /// A spreadsheet Nyra only reads (.xls, .ods)
    ReadOnly,
    /// A sheet protected in Excel, which Nyra doesn't unprotect
    SheetProtected,
}

#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReadOutcome {
    #[serde(rename_all = "camelCase")]
    Read {
        content: String,
        total_lines: usize,
        from: usize,
        to: usize,
        size: u64,
        /// Not in the index (the .gitignore leaves it out, or it is in node_modules): read because it was asked for by
        /// its exact path
        #[serde(skip_serializing_if = "std::ops::Not::not")]
        ignored: bool,
    },
    /// The file as it is, in base64: the frontend reads its text with the same reader as attached PDFs.
    /// modified: so a PDF changed without changing size isn't taken for the one read before
    Pdf {
        data: String,
        size: u64,
        modified: i64,
    },
    /// The same version the frontend said it already has: up to 10 MB that don't need to travel again
    PdfUnchanged,
    /// The image as it is, in base64, for vision models
    #[serde(rename_all = "camelCase")]
    Image {
        data: String,
        size: u64,
        mime_type: &'static str,
    },
    Skipped {
        reason: SkipReason,
    },
}

/// The version of a PDF the frontend already read, to read other parts of it without sending it again
#[derive(Deserialize, Debug, Clone, Copy)]
pub struct KnownPdf {
    size: u64,
    modified: i64,
}

#[derive(Serialize, Debug)]
pub struct SearchMatch {
    path: String,
    line: usize,
    text: String,
}

/// The definitions of the files under a folder (or of one file), a map of the code without reading it
#[derive(Serialize, Debug)]
pub struct OutlineOutcome {
    entries: Vec<SearchMatch>,
    files: usize,
    truncated: bool,
}

#[derive(Serialize, Debug)]
pub struct SearchOutcome {
    matches: Vec<SearchMatch>,
    /// Every match found, also past the ones returned
    total: usize,
    truncated: bool,
}

pub(crate) use crate::util::modified_millis;

pub(crate) fn relative(root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root).ok().and_then(plain_key)
}

/// Files that hold keys and passwords are never read, wherever they are and whatever the .gitignore says
/// .env.example and the like are templates without real values, and they say which settings a project needs
fn is_env_template(name: &str) -> bool {
    [".example", ".sample", ".template", ".dist"]
        .iter()
        .any(|suffix| name.ends_with(suffix))
}

pub(crate) fn is_secret(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path).to_lowercase();
    name == ".env"
        || (name.starts_with(".env.") && !is_env_template(&name))
        || name.ends_with(".pem")
        || name.ends_with(".key")
        || name.ends_with(".p12")
        || name.ends_with(".pfx")
        || name.ends_with(".p8")
        || name.ends_with(".jks")
        || name.ends_with(".keystore")
        || name.starts_with("id_rsa")
        || name.starts_with("id_ed25519")
        || name.starts_with("id_ecdsa")
        || name.starts_with("id_dsa")
        // Terraform keeps every value it manages in plain text, passwords included
        || name.ends_with(".tfstate")
        || name.ends_with(".tfstate.backup")
        || [
            ".npmrc",
            ".netrc",
            ".pypirc",
            ".pgpass",
            ".git-credentials",
            ".htpasswd",
            "credentials",
            "credentials.json",
        ]
        .contains(&name.as_str())
}

pub(crate) fn is_pdf(path: &str) -> bool {
    path.to_lowercase().ends_with(".pdf")
}

fn extension_of(path: &str) -> String {
    path.rsplit_once('.')
        .map(|(_, ext)| ext.to_lowercase())
        .unwrap_or_default()
}

pub(crate) fn is_image(path: &str) -> bool {
    IMAGE_EXTENSIONS.contains(&extension_of(path).as_str())
}

fn image_mime(path: &str) -> &'static str {
    match extension_of(path).as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "image/jpeg",
    }
}

pub(crate) fn is_binary_name(path: &str) -> bool {
    BINARY_EXTENSIONS.contains(&extension_of(path).as_str())
}

fn is_skipped_dir(entry: &DirEntry) -> bool {
    let name = entry.file_name().to_string_lossy();
    entry.file_type().is_some_and(|t| t.is_dir())
        && (SKIPPED_DIRS.contains(&name.as_ref()) || HIDDEN_SKIPPED_DIRS.contains(&name.as_ref()))
}

pub(crate) fn is_in_vcs_dir(key: &str) -> bool {
    key.split('/').any(|part| VCS_DIRS.contains(&part))
}

/// The path the model asked for, as plain names under the folder (no "..", no drive or root), with its key in the
/// index. A model may write Windows separators ("src\\App.tsx"); they mean the same folders.
pub(crate) fn safe_relative(path: &str) -> Option<(PathBuf, String)> {
    let path = path.trim().replace('\\', "/");
    let path = path.trim_start_matches("./");
    // A drive ("C:/…") is never inside the folder. On Windows no ":" is: "a.txt:x" names a hidden stream of a.txt,
    // past the checks on its name. Elsewhere it is a plain character, as in "notas 10:30.md".
    let is_drive =
        path.len() >= 2 && path.as_bytes()[1] == b':' && path.as_bytes()[0].is_ascii_alphabetic();
    if is_drive || (cfg!(windows) && path.contains(':')) {
        return None;
    }
    let candidate = Path::new(path);
    plain_key(candidate).map(|key| (candidate.to_path_buf(), key))
}

fn index_folder(root: &Path) -> IndexOutcome {
    match fs::read_dir(root) {
        Err(e) if e.kind() == ErrorKind::PermissionDenied => return IndexOutcome::NoAccess,
        Err(_) => return IndexOutcome::Missing,
        Ok(_) => {}
    }
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_exclude(true)
        .git_global(false)
        .require_git(false)
        .parents(false)
        .filter_entry(|entry| !is_skipped_dir(entry))
        .build();
    let mut files = Vec::new();
    let mut skipped = 0;
    let mut truncated = false;
    // Symbolic links aren't followed, so nothing outside the folder gets into the index
    for entry in walker.flatten() {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let Some(path) = relative(root, entry.path()) else {
            continue;
        };
        if is_secret(&path) || (is_binary_name(&path) && !is_image(&path) && !is_spreadsheet(&path))
        {
            skipped += 1;
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if files.len() == MAX_INDEX_FILES {
            truncated = true;
            break;
        }
        files.push(IndexedFile {
            path,
            size: metadata.len(),
            modified: modified_millis(&metadata),
        });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    IndexOutcome::Ready {
        files,
        skipped,
        truncated,
    }
}

/// How a text file is stored: UTF-8, or the Windows encoding for Western languages, which Excel and older apps still
/// use for CSV files. A file that isn't valid UTF-8 is read as the latter: it maps every byte, so the text that a
/// change doesn't touch is written back byte for byte.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum TextEncoding {
    #[default]
    Utf8,
    Windows1252,
    // With its byte order mark, as Windows writes it (Notepad, PowerShell); kept when written back
    Utf16Le,
    Utf16Be,
}

const UTF16_LE_BOM: [u8; 2] = [0xFF, 0xFE];
const UTF16_BE_BOM: [u8; 2] = [0xFE, 0xFF];

fn decode_utf16(
    bytes: &[u8],
    encoding: TextEncoding,
) -> Result<(String, TextEncoding), SkipReason> {
    let decoder = if encoding == TextEncoding::Utf16Le {
        encoding_rs::UTF_16LE
    } else {
        encoding_rs::UTF_16BE
    };
    decoder
        .decode_without_bom_handling_and_without_replacement(&bytes[2..])
        .filter(|text| !text.contains('\0'))
        .map(|text| (text.into_owned(), encoding))
        .ok_or(SkipReason::Binary)
}

pub(crate) fn decode_text(bytes: &[u8]) -> Result<(String, TextEncoding), SkipReason> {
    // Its zero bytes are part of each character, so it is told apart before looking for binary content
    if bytes.starts_with(&UTF16_LE_BOM) {
        return decode_utf16(bytes, TextEncoding::Utf16Le);
    }
    if bytes.starts_with(&UTF16_BE_BOM) {
        return decode_utf16(bytes, TextEncoding::Utf16Be);
    }
    if bytes.iter().take(BINARY_SNIFF_BYTES).any(|&b| b == 0) {
        return Err(SkipReason::Binary);
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => Ok((text.to_string(), TextEncoding::Utf8)),
        Err(_) => {
            let (text, _) = encoding_rs::WINDOWS_1252.decode_without_bom_handling(bytes);
            Ok((text.into_owned(), TextEncoding::Windows1252))
        }
    }
}

pub(crate) fn encode_text(text: &str, encoding: TextEncoding) -> Result<Vec<u8>, String> {
    match encoding {
        TextEncoding::Utf8 => Ok(text.as_bytes().to_vec()),
        TextEncoding::Windows1252 => {
            let (bytes, _, unmappable) = encoding_rs::WINDOWS_1252.encode(text);
            if unmappable {
                return Err(t("native.workspace.encoding"));
            }
            Ok(bytes.into_owned())
        }
        TextEncoding::Utf16Le => Ok(UTF16_LE_BOM
            .into_iter()
            .chain(text.encode_utf16().flat_map(u16::to_le_bytes))
            .collect()),
        TextEncoding::Utf16Be => Ok(UTF16_BE_BOM
            .into_iter()
            .chain(text.encode_utf16().flat_map(u16::to_be_bytes))
            .collect()),
    }
}

pub(crate) fn read_text(path: &Path) -> Result<String, SkipReason> {
    let bytes = fs::read(path).map_err(|_| SkipReason::Missing)?;
    decode_text(&bytes).map(|(text, _)| text)
}

/// Lines are counted from 1 and both ends are included; without them, the whole file
fn read_file(
    root: &Path,
    indexed: &HashSet<String>,
    requested: &str,
    from: Option<usize>,
    to: Option<usize>,
    known: Option<KnownPdf>,
) -> ReadOutcome {
    let skip = |reason| ReadOutcome::Skipped { reason };
    let Some((relative_path, key)) = safe_relative(requested) else {
        return skip(SkipReason::Outside);
    };
    if is_secret(&key) {
        return skip(SkipReason::Secret);
    }
    // Left out of the index on purpose, so not a matter of the .gitignore
    if is_binary_name(&key) && !is_image(&key) && !is_spreadsheet(&key) {
        return skip(SkipReason::Binary);
    }
    let path = root.join(&relative_path);
    // A link inside the folder may still point outside it
    let real = match real_path(&path) {
        Ok(real) if real.starts_with(root) => real,
        Ok(_) => return skip(SkipReason::Outside),
        Err(_) => return skip(SkipReason::Missing),
    };
    // Or, under a harmless name, to a secret or into version control ("notes.txt" -> ".env")
    let Some(real_key) = relative(root, &real) else {
        return skip(SkipReason::Outside);
    };
    if is_secret(&real_key) {
        return skip(SkipReason::Secret);
    }
    if is_in_vcs_dir(&real_key) {
        return skip(SkipReason::Ignored);
    }
    // Outside the index it is still read when asked for by its exact path (a log, a built file, a dependency's code),
    // but never inside version control and never a folder
    let ignored = !indexed.contains(&key);
    if ignored && (is_in_vcs_dir(&key) || !path.is_file()) {
        return skip(SkipReason::Ignored);
    }
    let metadata = fs::metadata(&path).ok();
    let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
    if is_image(&key) {
        if size > MAX_IMAGE_BYTES {
            return skip(SkipReason::TooLarge);
        }
        return match fs::read(&path) {
            Ok(bytes) => ReadOutcome::Image {
                data: base64::engine::general_purpose::STANDARD.encode(bytes),
                size,
                mime_type: image_mime(&key),
            },
            Err(_) => skip(SkipReason::Missing),
        };
    }
    if is_pdf(&key) {
        if size > MAX_PDF_BYTES {
            return skip(SkipReason::TooLarge);
        }
        let modified = metadata.as_ref().map(modified_millis).unwrap_or(0);
        if known.is_some_and(|k| k.size == size && k.modified == modified) {
            return ReadOutcome::PdfUnchanged;
        }
        return match fs::read(&path) {
            Ok(bytes) => ReadOutcome::Pdf {
                data: base64::engine::general_purpose::STANDARD.encode(bytes),
                size,
                modified,
            },
            Err(_) => skip(SkipReason::Missing),
        };
    }
    // Read as a table, one row per line, so the model reads a long one by rows like any long file
    let text = if is_spreadsheet(&key) {
        if size > spreadsheet::MAX_FILE_BYTES {
            return skip(SkipReason::TooLarge);
        }
        let Ok(bytes) = fs::read(&path) else {
            return skip(SkipReason::Missing);
        };
        match spreadsheet::workbook_text(&bytes, spreadsheet::MAX_FOLDER_TEXT) {
            Ok(text) => text,
            Err(_) => return skip(SkipReason::Unreadable),
        }
    } else {
        if size > MAX_READ_BYTES {
            return skip(SkipReason::TooLarge);
        }
        match read_text(&path) {
            Ok(text) => text,
            Err(reason) => return skip(reason),
        }
    };
    let lines: Vec<&str> = text.lines().collect();
    let total_lines = lines.len();
    let from = from.unwrap_or(1).clamp(1, total_lines.max(1));
    let to = to.unwrap_or(total_lines).clamp(from, total_lines.max(from));
    let content = lines
        .get(from - 1..to.min(total_lines))
        .unwrap_or_default()
        .join("\n");
    ReadOutcome::Read {
        content,
        total_lines,
        from,
        to: to.min(total_lines),
        size,
        ignored,
    }
}

fn preview(line: &str) -> String {
    let line = line.trim();
    if line.chars().count() <= MATCH_PREVIEW_CHARS {
        return line.to_string();
    }
    let cut: String = line.chars().take(MATCH_PREVIEW_CHARS).collect();
    format!("{cut}…")
}

/// Plain text, without regard to case, in the files of the index
const MAX_OUTLINE_ENTRIES: usize = 400;
/// Lines that start a definition in the common languages; deeper than this they are inside a body, not a member
const OUTLINE_MAX_INDENT: usize = 4;
const DEFINITION_STARTS: &[&str] = &[
    "export ",
    "pub fn ",
    "pub(crate) fn ",
    "pub async fn ",
    "async fn ",
    "fn ",
    "pub struct ",
    "pub(crate) struct ",
    "struct ",
    "pub enum ",
    "pub(crate) enum ",
    "enum ",
    "impl ",
    "impl<",
    "pub trait ",
    "trait ",
    "pub mod ",
    "mod ",
    "class ",
    "abstract class ",
    "def ",
    "async def ",
    "function ",
    "async function ",
    "interface ",
    "type ",
    "func ",
    "public ",
    "protected ",
    "private ",
    "module ",
    "macro_rules!",
    // Kotlin
    "fun ",
    "suspend fun ",
    "override fun ",
    "private fun ",
    "internal fun ",
    "data class ",
    "sealed class ",
    "object ",
    "companion object",
    // C and C++
    "typedef ",
    "#define ",
    "namespace ",
    "template<",
    "template <",
];

const C_FAMILY: &[&str] = &["c", "h", "cc", "cpp", "cxx", "hpp", "hh", "hxx", "m", "mm"];
/// Words that start a statement, not a definition, in a line shaped like "word word(...)"
const STATEMENT_WORDS: &[&str] = &[
    "if", "for", "while", "switch", "return", "else", "do", "case", "goto", "sizeof", "delete",
    "new", "throw",
];

/// `const handler = (…) => …`: an arrow function, which JavaScript and TypeScript define without a keyword
fn is_arrow_function(trimmed: &str) -> bool {
    (trimmed.starts_with("const ") || trimmed.starts_with("let "))
        && trimmed.contains('=')
        && trimmed.contains("=>")
}

/// `int main(void) {` or `static char *name(int a)`: in C and C++ a function starts with its return type, not a
/// keyword. At the start of the line, two or more words before "(", no ";" after it, not a statement.
fn is_c_function(line: &str) -> bool {
    if line.starts_with(char::is_whitespace) || line.trim_end().ends_with(';') {
        return false;
    }
    let Some((head, _)) = line.split_once('(') else {
        return false;
    };
    let words: Vec<&str> = head.split_whitespace().collect();
    let is_word = |w: &&str| {
        w.chars()
            .all(|c| c.is_alphanumeric() || "_*&:<>,~".contains(c))
    };
    words.len() >= 2
        && words.iter().all(is_word)
        && !STATEMENT_WORDS.contains(&words[0])
        && words.last().is_some_and(|name| {
            name.trim_start_matches(['*', '&'])
                .chars()
                .next()
                .is_some_and(|c| c.is_alphabetic() || c == '_' || c == '~')
        })
}

fn is_definition(line: &str, path: &str) -> bool {
    let trimmed = line.trim_start();
    if line.len() - trimmed.len() > OUTLINE_MAX_INDENT {
        return false;
    }
    let extension = extension_of(path);
    DEFINITION_STARTS
        .iter()
        .any(|start| trimmed.starts_with(start))
        || is_arrow_function(trimmed)
        || (C_FAMILY.contains(&extension.as_str()) && is_c_function(line))
}

/// A file of the index as it is now on disk, with its size: still inside the folder (a link put in its place after
/// indexing could point anywhere), a plain file, and neither a secret nor inside version control under its real name
pub(crate) fn indexed_file(root: &Path, key: &str) -> Option<(PathBuf, u64)> {
    let real = real_path(&root.join(key)).ok()?;
    if !real.starts_with(root) {
        return None;
    }
    let real_key = relative(root, &real)?;
    if is_secret(&real_key) || is_in_vcs_dir(&real_key) {
        return None;
    }
    let metadata = fs::metadata(&real).ok()?;
    metadata.is_file().then_some((real, metadata.len()))
}

fn outline_files(root: &Path, indexed: &HashSet<String>, folder: &str) -> OutlineOutcome {
    let folder = folder.trim().trim_start_matches("./").trim_end_matches('/');
    let mut paths: Vec<&String> = indexed
        .iter()
        .filter(|p| folder.is_empty() || *p == folder || p.starts_with(&format!("{folder}/")))
        .filter(|p| !is_pdf(p) && !is_image(p))
        .collect();
    paths.sort();
    let mut entries = Vec::new();
    let mut truncated = false;
    for relative_path in &paths {
        let Some((path, size)) = indexed_file(root, relative_path) else {
            continue;
        };
        if size > MAX_SEARCH_FILE_BYTES {
            continue;
        }
        let Ok(text) = read_text(&path) else {
            continue;
        };
        for (i, line) in text.lines().enumerate() {
            if !is_definition(line, relative_path) {
                continue;
            }
            if entries.len() == MAX_OUTLINE_ENTRIES {
                truncated = true;
                break;
            }
            entries.push(SearchMatch {
                path: (*relative_path).clone(),
                line: i + 1,
                text: preview(line),
            });
        }
        if truncated {
            break;
        }
    }
    OutlineOutcome {
        entries,
        files: paths.len(),
        truncated,
    }
}

fn search_files(root: &Path, indexed: &HashSet<String>, query: &str) -> SearchOutcome {
    let needle = query.trim().to_lowercase();
    let mut paths: Vec<&String> = indexed.iter().collect();
    paths.sort();
    let mut matches = Vec::new();
    let mut total = 0;
    let mut scanned = 0;
    let mut truncated = false;
    if needle.is_empty() {
        return SearchOutcome {
            matches,
            total,
            truncated,
        };
    }
    for relative_path in paths {
        // A PDF's text is compressed inside the file, and an image has none
        if is_pdf(relative_path) || is_image(relative_path) {
            continue;
        }
        let Some((path, size)) = indexed_file(root, relative_path) else {
            continue;
        };
        if size > MAX_SEARCH_FILE_BYTES {
            continue;
        }
        if scanned + size > MAX_SEARCH_SCANNED_BYTES {
            truncated = true;
            break;
        }
        scanned += size;
        let Ok(text) = read_text(&path) else {
            continue;
        };
        let mut in_file = 0;
        for (i, line) in text.lines().enumerate() {
            if !line.to_lowercase().contains(&needle) {
                continue;
            }
            total += 1;
            in_file += 1;
            if in_file <= MAX_MATCHES_PER_FILE && matches.len() < MAX_SEARCH_MATCHES {
                matches.push(SearchMatch {
                    path: relative_path.clone(),
                    line: i + 1,
                    text: preview(line),
                });
            }
        }
    }
    truncated |= total > matches.len();
    SearchOutcome {
        matches,
        total,
        truncated,
    }
}

impl Workspaces {
    /// A file Nyra just created, so it can be read without waiting for the next index
    pub(crate) fn add_indexed(&self, root: &Path, path: String) -> Result<(), String> {
        Self::lock(&self.indexes)?
            .entry(root.to_path_buf())
            .or_default()
            .insert(path);
        Ok(())
    }

    fn lock<T>(mutex: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>, String> {
        mutex.lock().map_err(|_| t("native.workspace.noAccess"))
    }

    pub(crate) fn indexed(&self, root: &Path) -> Result<HashSet<String>, String> {
        Ok(Self::lock(&self.indexes)?
            .get(root)
            .cloned()
            .unwrap_or_default())
    }
}

/// The folder as the user picked it; anything else is refused before touching the disk
pub(crate) fn allowed_root(
    db: &Database,
    workspaces: &Workspaces,
    root: &str,
) -> Result<PathBuf, String> {
    let refused = || t("native.workspace.notConnected");
    // Folders kept before paths were made plain (\\?\C:\… on Windows) still compare with what is read inside them
    let path = plain_path(PathBuf::from(root));
    if Workspaces::lock(&workspaces.session_roots)?.contains(&path) {
        return Ok(path);
    }
    let known = db.with(|c| {
        c.query_row(
            "SELECT COUNT(*) FROM workspace_roots WHERE path = ?1",
            params![root],
            |row| row.get::<_, i64>(0),
        )
    })?;
    if known > 0 {
        Ok(path)
    } else {
        Err(refused())
    }
}

/// A folder the user picked and Nyra keeps (not one of a private conversation, allowed only until Nyra closes): a
/// project is written down, so its folder must be too
pub(crate) fn remembered_root(db: &Database, root: &str) -> Result<PathBuf, String> {
    let known = db.with(|c| {
        c.query_row(
            "SELECT COUNT(*) FROM workspace_roots WHERE path = ?1",
            params![root],
            |row| row.get::<_, i64>(0),
        )
    })?;
    if known > 0 {
        Ok(PathBuf::from(root))
    } else {
        Err(t("native.workspace.notConnected"))
    }
}

pub(crate) async fn blocking<T: Send + 'static>(
    run: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(run)
        .await
        .map_err(to_message)
}

/// Writes down a folder the user allowed (picked, or made a project of), so it stays allowed after Nyra closes
pub(crate) fn remember_root(connection: &rusqlite::Connection, path: &str) -> rusqlite::Result<()> {
    connection
        .execute(
            "INSERT OR IGNORE INTO workspace_roots (path, added_at) VALUES (?1, ?2)",
            params![path, now_millis()],
        )
        .map(|_| ())
}

/// remember is false in a private conversation: the folder is allowed until Nyra closes and never written down
#[tauri::command]
pub async fn pick_workspace_folder(
    app: AppHandle,
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    remember: bool,
) -> Result<Option<ConnectedFolder>, String> {
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let folder = real_path(&folder.into_path().map_err(to_message)?).map_err(to_message)?;
    let path = folder.to_string_lossy().into_owned();
    if remember {
        db.with(|c| remember_root(c, &path))?;
    } else {
        Workspaces::lock(&workspaces.session_roots)?.insert(folder.clone());
    }
    let name = folder
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.clone());
    Ok(Some(ConnectedFolder { path, name }))
}

/// The folders to let go: allowed (written down or for this session) or with vectors, and used neither by a saved
/// conversation nor by one open in memory. Their access and their vectors go; the folders themselves aren't touched.
fn release_unused(
    connection: &rusqlite::Connection,
    session: &HashSet<PathBuf>,
    in_use: &HashSet<String>,
) -> rusqlite::Result<Vec<String>> {
    let column = |sql: &str| -> rusqlite::Result<HashSet<String>> {
        let mut statement = connection.prepare(sql)?;
        let values = statement.query_map([], |row| row.get::<_, String>(0))?;
        values.collect()
    };
    let mut saved = column(&format!(
        "SELECT DISTINCT {SAVED_FOLDER} FROM conversations WHERE {SAVED_FOLDER} IS NOT NULL"
    ))?;
    // A project keeps its folder even before its first conversation
    saved.extend(column("SELECT path FROM projects WHERE removed = 0")?);
    let mut known = column("SELECT path FROM workspace_roots")?;
    known.extend(column("SELECT DISTINCT root FROM workspace_chunks")?);
    known.extend(session.iter().map(|p| p.to_string_lossy().into_owned()));
    let mut released: Vec<String> = known
        .into_iter()
        .filter(|path| !saved.contains(path) && !in_use.contains(path))
        .collect();
    released.sort();
    let transaction = connection.unchecked_transaction()?;
    for path in &released {
        transaction.execute("DELETE FROM workspace_roots WHERE path = ?1", params![path])?;
        crate::workspace::meaning::forget_root(&transaction, path)?;
    }
    transaction.commit()?;
    Ok(released)
}

/// After a folder is disconnected or a conversation deleted. in_use: the folders of the conversations in memory,
/// which may not be saved yet (a new one, a private one). Returns the folders let go.
#[tauri::command]
pub async fn release_unused_workspaces(
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    in_use: Vec<String>,
) -> Result<Vec<String>, String> {
    let in_use: HashSet<String> = in_use.into_iter().collect();
    let session = Workspaces::lock(&workspaces.session_roots)?.clone();
    let released = db.with(|c| release_unused(c, &session, &in_use))?;
    let mut session = Workspaces::lock(&workspaces.session_roots)?;
    let mut indexes = Workspaces::lock(&workspaces.indexes)?;
    for path in &released {
        let path = PathBuf::from(path);
        session.remove(&path);
        indexes.remove(&path);
    }
    Ok(released)
}

#[tauri::command]
pub async fn index_workspace(
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    root: String,
) -> Result<IndexOutcome, String> {
    let root = allowed_root(&db, &workspaces, &root)?;
    let walked = root.clone();
    let outcome = blocking(move || index_folder(&walked)).await?;
    let paths = match &outcome {
        IndexOutcome::Ready { files, .. } => files.iter().map(|f| f.path.clone()).collect(),
        _ => HashSet::new(),
    };
    Workspaces::lock(&workspaces.indexes)?.insert(root, paths);
    Ok(outcome)
}

#[tauri::command]
pub async fn read_workspace_file(
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    root: String,
    path: String,
    from: Option<usize>,
    to: Option<usize>,
    known: Option<KnownPdf>,
) -> Result<ReadOutcome, String> {
    let root = allowed_root(&db, &workspaces, &root)?;
    let indexed = workspaces.indexed(&root)?;
    blocking(move || read_file(&root, &indexed, &path, from, to, known)).await
}

#[tauri::command]
pub async fn search_workspace(
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    root: String,
    query: String,
) -> Result<SearchOutcome, String> {
    let root = allowed_root(&db, &workspaces, &root)?;
    let indexed = workspaces.indexed(&root)?;
    blocking(move || search_files(&root, &indexed, &query)).await
}

#[tauri::command]
pub async fn outline_workspace(
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    root: String,
    path: String,
) -> Result<OutlineOutcome, String> {
    let root = allowed_root(&db, &workspaces, &root)?;
    let indexed = workspaces.indexed(&root)?;
    blocking(move || outline_files(&root, &indexed, &path)).await
}

/// Shows a file of the folder (or the folder itself, with an empty path) in Finder, Explorer or the file manager
#[tauri::command]
pub async fn reveal_workspace_file(
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    root: String,
    path: String,
) -> Result<(), String> {
    let root = allowed_root(&db, &workspaces, &root)?;
    let target = if path.is_empty() {
        root
    } else {
        let (relative_path, _) =
            safe_relative(&path).ok_or_else(|| t("native.workspace.fileNotInFolder"))?;
        root.join(relative_path)
    };
    tauri_plugin_opener::reveal_item_in_dir(target).map_err(to_message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_utf16_file_reads_and_writes_back_as_it_was() {
        let text = "Informe: año 2025, café\r\n";
        for encoding in [TextEncoding::Utf16Le, TextEncoding::Utf16Be] {
            let bytes = encode_text(text, encoding).unwrap();
            assert_eq!(decode_text(&bytes).unwrap(), (text.to_string(), encoding));
        }
        let mut odd = UTF16_LE_BOM.to_vec();
        odd.push(0x41);
        assert!(decode_text(&odd).is_err(), "half a character is not text");
    }

    #[test]
    fn a_path_with_windows_separators_stays_in_the_folder() {
        assert_eq!(safe_relative("src\\App.tsx").unwrap().1, "src/App.tsx");
        assert_eq!(safe_relative(".\\a\\b.ts").unwrap().1, "a/b.ts");
        assert!(safe_relative("..\\fuera.txt").is_none());
        assert!(safe_relative("\\raiz.txt").is_none());
        assert!(safe_relative("C:\\Windows\\x").is_none());
        assert!(safe_relative("\\\\servidor\\carpeta").is_none());
        assert!(safe_relative("C:/Windows/x").is_none());
        assert_eq!(
            safe_relative("notas 10:30.md").map(|(_, key)| key),
            (!cfg!(windows)).then(|| "notas 10:30.md".to_string())
        );
    }

    fn folder(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "nyra-test-{}-workspace-{label}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("src/components")).unwrap();
        fs::create_dir_all(dir.join("node_modules/react")).unwrap();
        fs::create_dir_all(dir.join("dist")).unwrap();
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::write(
            dir.join("src/App.tsx"),
            "line one\nconst useChat = 1;\nline three\n",
        )
        .unwrap();
        fs::write(dir.join("src/components/Chat.tsx"), "useChat()\n").unwrap();
        fs::write(dir.join("README.md"), "# Proyecto\n").unwrap();
        fs::write(dir.join(".env"), "API_KEY=secreto\n").unwrap();
        fs::write(dir.join("logo.png"), [0u8, 1, 2]).unwrap();
        fs::write(dir.join("app.zip"), [0u8, 1, 2]).unwrap();
        fs::write(dir.join("informe.pdf"), b"%PDF-1.7 useChat").unwrap();
        fs::write(dir.join("data.txt"), [b'a', 0, b'b']).unwrap();
        fs::write(dir.join("node_modules/react/index.js"), "x").unwrap();
        fs::write(dir.join("dist/bundle.js"), "x").unwrap();
        fs::write(dir.join(".git/config"), "x").unwrap();
        fs::write(dir.join(".gitignore"), "dist/\n").unwrap();
        fs::create_dir_all(dir.join(".github/workflows")).unwrap();
        fs::write(dir.join(".github/workflows/ci.yml"), "on: push\n").unwrap();
        fs::create_dir_all(dir.join(".venv/lib")).unwrap();
        fs::write(dir.join(".venv/lib/site.py"), "x").unwrap();
        dir.canonicalize().unwrap()
    }

    fn ready(outcome: IndexOutcome) -> (Vec<String>, usize) {
        match outcome {
            IndexOutcome::Ready { files, skipped, .. } => {
                (files.into_iter().map(|f| f.path).collect(), skipped)
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn indexes_readable_files_and_leaves_out_ignored_secret_and_binary_ones() {
        let root = folder("index");
        let (paths, skipped) = ready(index_folder(&root));
        assert_eq!(
            paths,
            [
                ".github/workflows/ci.yml",
                ".gitignore",
                "README.md",
                "data.txt",
                "informe.pdf",
                "logo.png",
                "src/App.tsx",
                "src/components/Chat.tsx"
            ]
        );
        // .env (a secret) and app.zip. Hidden configs stay, .git and .venv don't; images stay for vision models
        assert_eq!(skipped, 2);
        assert!(matches!(
            index_folder(&root.join("no-existe")),
            IndexOutcome::Missing
        ));
    }

    #[test]
    fn reads_spreadsheets_as_tables_by_rows() {
        let root = folder("spreadsheet");
        fs::write(
            root.join("ventas.xlsx"),
            crate::spreadsheet::tests::sample_xlsx(),
        )
        .unwrap();
        fs::write(root.join("roto.xlsx"), b"not a spreadsheet").unwrap();
        let (paths, _) = ready(index_folder(&root));
        assert!(paths.contains(&"ventas.xlsx".to_string()));
        let indexed: HashSet<String> = paths.into_iter().collect();
        match read_file(&root, &indexed, "ventas.xlsx", Some(3), Some(4), None) {
            ReadOutcome::Read {
                content,
                total_lines,
                ..
            } => {
                assert_eq!(total_lines, 5);
                assert_eq!(
                    content,
                    "| 1 | Producto | Unidades | Precio | Total |\n| 2 | Manzana | 10 | 1.5 | =B2*C2 → 15 |"
                );
            }
            other => panic!("{other:?}"),
        }
        assert!(matches!(
            read_file(&root, &indexed, "roto.xlsx", None, None, None),
            ReadOutcome::Skipped {
                reason: SkipReason::Unreadable
            }
        ));
    }

    #[test]
    fn reads_only_indexed_files_inside_the_folder() {
        let root = folder("read");
        let (paths, _) = ready(index_folder(&root));
        let indexed: HashSet<String> = paths.into_iter().collect();
        let read = |path: &str| read_file(&root, &indexed, path, None, None, None);

        match read("src/App.tsx") {
            ReadOutcome::Read {
                content,
                total_lines,
                ..
            } => {
                assert_eq!(total_lines, 3);
                assert!(content.contains("useChat"));
            }
            other => panic!("{other:?}"),
        }
        let reason = |outcome| match outcome {
            ReadOutcome::Skipped { reason } => reason,
            other => panic!("{other:?}"),
        };
        assert_eq!(reason(read(".env")), SkipReason::Secret);
        assert!(is_secret(".env.local") && is_secret("config/.env.production"));
        assert!(!is_secret(".env.example") && !is_secret(".env.sample"));
        for secret in [
            "home/.ssh/id_ecdsa",
            ".git-credentials",
            ".pgpass",
            ".pypirc",
            "android/release.jks",
            "app.keystore",
            "AuthKey_ABC123.p8",
            "infra/terraform.tfstate",
            "terraform.tfstate.backup",
        ] {
            assert!(is_secret(secret), "{secret}");
        }
        assert!(!is_secret("src/keystore.ts") && !is_secret("main.tf"));
        // Left out of the index, but read when asked for by its exact path, and marked as such
        for ignored in ["dist/bundle.js", "node_modules/react/index.js"] {
            match read(ignored) {
                ReadOutcome::Read { ignored, .. } => assert!(ignored),
                other => panic!("{other:?}"),
            }
        }
        // Version control is never read, and a folder isn't a file
        assert_eq!(reason(read(".git/config")), SkipReason::Ignored);
        assert_eq!(reason(read("dist")), SkipReason::Ignored);
        assert_eq!(reason(read("../secreto.txt")), SkipReason::Outside);
        assert_eq!(reason(read("/etc/hosts")), SkipReason::Outside);
        assert_eq!(reason(read("C:\\Windows\\win.ini")), SkipReason::Outside);
        assert_eq!(reason(read("data.txt")), SkipReason::Binary);
        assert_eq!(reason(read("app.zip")), SkipReason::Binary);
        match read("logo.png") {
            ReadOutcome::Image { mime_type, .. } => assert_eq!(mime_type, "image/png"),
            other => panic!("{other:?}"),
        }
        match read("informe.pdf") {
            ReadOutcome::Pdf { data, size, .. } => {
                assert_eq!(
                    data,
                    base64::engine::general_purpose::STANDARD.encode(b"%PDF-1.7 useChat")
                );
                assert_eq!(size, 16);
            }
            other => panic!("{other:?}"),
        }
        // The version already read isn't sent again; another one is
        let modified = modified_millis(&fs::metadata(root.join("informe.pdf")).unwrap());
        let known = |modified| Some(KnownPdf { size: 16, modified });
        assert!(matches!(
            read_file(&root, &indexed, "informe.pdf", None, None, known(modified)),
            ReadOutcome::PdfUnchanged
        ));
        assert!(matches!(
            read_file(
                &root,
                &indexed,
                "informe.pdf",
                None,
                None,
                known(modified - 1)
            ),
            ReadOutcome::Pdf { .. }
        ));
        assert_eq!(reason(read("src/no-existe.ts")), SkipReason::Missing);
    }

    #[cfg(unix)]
    #[test]
    fn searching_never_follows_a_link_put_in_place_of_an_indexed_file() {
        let dir = folder("swapped").canonicalize().unwrap();
        let outside =
            std::env::temp_dir().join(format!("nyra-test-{}-swapped-out.txt", std::process::id()));
        fs::write(&outside, "clave-secreta\n").unwrap();
        std::os::unix::fs::symlink(&outside, dir.join("notes.txt")).unwrap();
        let indexed = HashSet::from(["notes.txt".to_string()]);
        assert_eq!(search_files(&dir, &indexed, "clave-secreta").total, 0);
        assert!(indexed_file(&dir, "notes.txt").is_none());
        let _ = fs::remove_file(outside);
    }

    #[test]
    fn lists_the_folders_in_use_from_the_index() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE conversations (id TEXT PRIMARY KEY, data TEXT NOT NULL);")
            .unwrap();
        c.execute_batch(SAVED_FOLDER_INDEX).unwrap();
        let plan: String = c
            .query_row(
                &format!(
                    "EXPLAIN QUERY PLAN SELECT DISTINCT {SAVED_FOLDER} FROM conversations
                     WHERE {SAVED_FOLDER} IS NOT NULL"
                ),
                [],
                |row| row.get(3),
            )
            .unwrap();
        assert!(plan.contains("conversations_workspace"), "{plan}");
    }

    #[test]
    fn lets_go_of_folders_no_conversation_uses() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch(SCHEMA).unwrap();
        c.execute_batch(crate::workspace::meaning::SCHEMA).unwrap();
        c.execute_batch(
            "CREATE TABLE conversations (id TEXT PRIMARY KEY, data TEXT NOT NULL);
             INSERT INTO conversations VALUES ('a', '{\"workspace\":{\"path\":\"/saved\",\"name\":\"saved\"}}');
             INSERT INTO conversations VALUES ('b', '{\"messages\":[]}');",
        )
        .unwrap();
        c.execute_batch(crate::projects::SCHEMA).unwrap();
        c.execute_batch(
            "INSERT INTO projects (id, name, path, added_at) VALUES ('p', 'web', '/project', 1);
             INSERT INTO projects (id, name, path, added_at, removed) VALUES ('q', 'old', '/removed', 1, 1);
             INSERT INTO workspace_roots VALUES ('/saved', 1), ('/open', 1), ('/gone', 1), ('/project', 1),
                                                ('/removed', 1);
             INSERT INTO workspace_chunks VALUES ('/gone', 'a.ts', 1, 1, 40, 'm', x'00'),
                                                 ('/saved', 'a.ts', 1, 1, 40, 'm', x'00'),
                                                 ('/orphan', 'a.ts', 1, 1, 40, 'm', x'00');",
        )
        .unwrap();
        let session = HashSet::from([PathBuf::from("/private"), PathBuf::from("/closed")]);
        let in_use = HashSet::from(["/open".to_string(), "/private".to_string()]);
        let released = release_unused(&c, &session, &in_use).unwrap();
        assert_eq!(released, ["/closed", "/gone", "/orphan", "/removed"]);
        let roots: Vec<String> = c
            .prepare("SELECT path FROM workspace_roots ORDER BY path")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(roots, ["/open", "/project", "/saved"]);
        let chunks: Vec<String> = c
            .prepare("SELECT root FROM workspace_chunks")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(chunks, ["/saved"]);
    }

    #[cfg(unix)]
    #[test]
    fn a_link_pointing_outside_is_not_read() {
        let root = folder("link");
        let outside =
            std::env::temp_dir().join(format!("nyra-test-{}-outside.txt", std::process::id()));
        fs::write(&outside, "fuera").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("fuera.txt")).unwrap();
        let (paths, _) = ready(index_folder(&root));
        assert!(!paths.contains(&"fuera.txt".to_string()));
        let mut indexed: HashSet<String> = paths.into_iter().collect();
        // Even if it somehow got into the index
        indexed.insert("fuera.txt".to_string());
        assert!(matches!(
            read_file(&root, &indexed, "fuera.txt", None, None, None),
            ReadOutcome::Skipped {
                reason: SkipReason::Outside
            }
        ));
    }

    #[cfg(unix)]
    #[test]
    fn a_link_to_a_secret_or_version_control_is_not_read() {
        let root = folder("link-secret");
        fs::write(root.join(".env"), "KEY=1").unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".git/config"), "[remote]").unwrap();
        std::os::unix::fs::symlink(root.join(".env"), root.join("notas.txt")).unwrap();
        std::os::unix::fs::symlink(root.join(".git/config"), root.join("config.txt")).unwrap();
        let indexed = HashSet::new();
        assert!(matches!(
            read_file(&root, &indexed, "notas.txt", None, None, None),
            ReadOutcome::Skipped {
                reason: SkipReason::Secret
            }
        ));
        assert!(matches!(
            read_file(&root, &indexed, "config.txt", None, None, None),
            ReadOutcome::Skipped {
                reason: SkipReason::Ignored
            }
        ));
    }

    #[test]
    fn reads_a_range_of_lines() {
        let root = folder("range");
        let (paths, _) = ready(index_folder(&root));
        let indexed: HashSet<String> = paths.into_iter().collect();
        match read_file(&root, &indexed, "src/App.tsx", Some(2), Some(9), None) {
            ReadOutcome::Read {
                content, from, to, ..
            } => {
                assert_eq!(content, "const useChat = 1;\nline three");
                assert_eq!((from, to), (2, 3));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn outlines_the_definitions_of_a_folder() {
        let root = folder("outline");
        fs::write(
            root.join("src/hooks.ts"),
            "import x from 'y';\nexport function useChat() {\n  const a = 1;\n}\n  class Inner {}\n",
        )
        .unwrap();
        let (paths, _) = ready(index_folder(&root));
        let indexed: HashSet<String> = paths.into_iter().collect();
        let outline = outline_files(&root, &indexed, "src/");
        let lines: Vec<(String, usize)> = outline
            .entries
            .into_iter()
            .map(|e| (e.path, e.line))
            .collect();
        assert_eq!(
            lines,
            [
                ("src/hooks.ts".to_string(), 2),
                ("src/hooks.ts".to_string(), 5)
            ]
        );
        assert_eq!(outline.files, 3);
    }

    #[test]
    fn recognizes_definitions_in_common_languages() {
        let defined = [
            ("app.kt", "fun main(args: Array<String>) {"),
            ("app.kt", "data class User(val name: String)"),
            ("app.kt", "    suspend fun load() {"),
            ("app.ts", "const handler = async (req) => {"),
            ("app.c", "int main(void) {"),
            ("app.c", "static char *copy_name(const char *src)"),
            (
                "app.cpp",
                "std::vector<int> Parser::parse(const std::string& s) {",
            ),
            ("app.cpp", "namespace net {"),
            ("app.h", "#define MAX_LEN 64"),
            ("app.java", "    public void run() {"),
            ("app.py", "def main():"),
        ];
        for (path, line) in defined {
            assert!(is_definition(line, path), "{path}: {line}");
        }
        let not_defined = [
            ("app.c", "    printf(\"hola\");"),
            ("app.c", "if (x > 0) {"),
            ("app.c", "int count = sum(a, b);"),
            ("notes.md", "Hola mundo (prueba)"),
            ("app.ts", "const total = items.length;"),
            ("app.rs", "#[tauri::command]"),
        ];
        for (path, line) in not_defined {
            assert!(!is_definition(line, path), "{path}: {line}");
        }
    }

    #[test]
    fn searches_the_indexed_files_without_regard_to_case() {
        let root = folder("search");
        let (paths, _) = ready(index_folder(&root));
        let indexed: HashSet<String> = paths.into_iter().collect();
        let found = search_files(&root, &indexed, "USECHAT");
        let lines: Vec<(String, usize)> = found
            .matches
            .into_iter()
            .map(|m| (m.path, m.line))
            .collect();
        assert_eq!(
            lines,
            [
                ("src/App.tsx".to_string(), 2),
                ("src/components/Chat.tsx".to_string(), 1)
            ]
        );
        assert_eq!(found.total, 2);
        assert!(search_files(&root, &indexed, "API_KEY").matches.is_empty());
    }
}
