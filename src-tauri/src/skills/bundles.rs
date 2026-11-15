//! A skill's files before they are installed: from a zip, a folder or loose files, within the limits.

use super::*;

/// A skill's files in memory, with paths relative to the skill's folder and always forward slashes.
pub(super) struct Bundle {
    pub(super) files: BTreeMap<String, Vec<u8>>,
    /// Where it was found, for the import list and to recognise a newer version later
    pub(super) origin: String,
}

impl Bundle {
    pub(super) fn skill_text(&self) -> Option<String> {
        self.files
            .get(SKILL_FILE)
            .map(|bytes| String::from_utf8_lossy(bytes).into_owned())
    }

    pub(super) fn meta(&self) -> Result<Meta, String> {
        let text = self
            .skill_text()
            .ok_or_else(|| t("native.skills.skillFileMissing"))?;
        meta_of(&parse_document(&text)?)
    }

    /// FNV-1a over paths and contents: stable across Rust versions, unlike the std hasher
    pub(super) fn content_hash(&self) -> String {
        let mut hash: u64 = 0xcbf29ce484222325;
        for (path, bytes) in &self.files {
            for byte in path
                .bytes()
                .chain([0])
                .chain(bytes.iter().copied())
                .chain([0])
            {
                hash ^= u64::from(byte);
                hash = hash.wrapping_mul(0x100000001b3);
            }
        }
        format!("{hash:016x}")
    }
}

pub(super) fn is_ignored(path: &str) -> bool {
    path.split('/')
        .any(|part| part == "__MACOSX" || part == ".DS_Store" || part == RECORD_FILE)
}

/// Splits loose files into one bundle per SKILL.md found (at most two folders deep), so one archive or
/// folder can hold several skills.
pub(super) fn bundles_from_files(
    files: BTreeMap<String, Vec<u8>>,
    origin: &str,
) -> Result<Vec<Bundle>, String> {
    let mut roots: Vec<String> = files
        .keys()
        .filter_map(|path| path.strip_suffix(SKILL_FILE))
        .filter(|prefix| prefix.is_empty() || prefix.ends_with('/'))
        .map(str::to_string)
        .filter(|prefix| prefix.matches('/').count() <= 2)
        .collect();
    roots.sort_by_key(|prefix| prefix.len());
    // A SKILL.md inside another skill (an example, a template) is part of that skill, not a new one
    let mut kept: Vec<String> = Vec::new();
    for root in roots {
        if !kept.iter().any(|outer| root.starts_with(outer.as_str())) {
            kept.push(root);
        }
    }
    if kept.is_empty() {
        return Err(t("native.skills.skillFileMissing"));
    }
    Ok(kept
        .iter()
        .map(|root| Bundle {
            files: files
                .iter()
                .filter_map(|(path, bytes)| {
                    Some((path.strip_prefix(root.as_str())?.to_string(), bytes.clone()))
                })
                .collect(),
            origin: format!("{origin}/{}", root.trim_end_matches('/'))
                .trim_end_matches('/')
                .to_string(),
        })
        .collect())
}

pub(super) struct Limits {
    pub(super) files: usize,
    pub(super) bytes: u64,
}

impl Limits {
    pub(super) fn new() -> Self {
        Self { files: 0, bytes: 0 }
    }

    pub(super) fn take(&mut self, size: u64) -> Result<(), String> {
        self.files += 1;
        self.bytes += size;
        if self.files > MAX_BUNDLE_FILES {
            return Err(t_with(
                "native.skills.tooManyFiles",
                &[("max", &MAX_BUNDLE_FILES.to_string())],
            ));
        }
        if self.bytes > MAX_BUNDLE_BYTES {
            return Err(t("native.skills.tooBig"));
        }
        Ok(())
    }
}

pub(super) fn files_in_zip(bytes: &[u8]) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| t("native.skills.notZip"))?;
    let mut files = BTreeMap::new();
    let mut limits = Limits::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(to_message)?;
        if entry.is_dir() || entry.is_symlink() {
            continue;
        }
        let Some(path) = entry.enclosed_name().as_deref().and_then(plain_key) else {
            continue;
        };
        if is_ignored(&path) {
            continue;
        }
        // The declared size can lie (zip bombs, or many entries that say 0 bytes), so what counts is what is read,
        // and reading stops at what is left of the limit
        let mut content = Vec::new();
        entry
            .by_ref()
            .take(MAX_BUNDLE_BYTES - limits.bytes + 1)
            .read_to_end(&mut content)
            .map_err(to_message)?;
        limits.take(content.len() as u64)?;
        files.insert(path, content);
    }
    Ok(files)
}

pub(super) fn files_in_dir(dir: &Path) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let mut files = BTreeMap::new();
    walk_files(dir, &mut |relative, path, _| {
        files.insert(relative, fs::read(path).map_err(to_message)?);
        Ok(())
    })?;
    Ok(files)
}

/// The same files with their sizes, without reading them: what listing the skills needs
pub(super) fn file_sizes_in_dir(dir: &Path) -> Result<Vec<(String, u64)>, String> {
    let mut files = Vec::new();
    walk_files(dir, &mut |relative, _, size| {
        files.push((relative, size));
        Ok(())
    })?;
    files.sort();
    Ok(files)
}

/// Each file of a skill's folder within the limits, with its path inside it and its size
fn walk_files(
    dir: &Path,
    on_file: &mut dyn FnMut(String, &Path, u64) -> Result<(), String>,
) -> Result<(), String> {
    fn walk(
        dir: &Path,
        base: &Path,
        on_file: &mut dyn FnMut(String, &Path, u64) -> Result<(), String>,
        limits: &mut Limits,
    ) -> Result<(), String> {
        for entry in fs::read_dir(dir).map_err(to_message)?.flatten() {
            // Symlinks are not followed: they could point anywhere on the computer
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if kind.is_dir() {
                if entry.file_name() != ".git" {
                    walk(&path, base, on_file, limits)?;
                }
            } else if kind.is_file() {
                let Some(relative) = path.strip_prefix(base).ok().and_then(plain_key) else {
                    continue;
                };
                if is_ignored(&relative) {
                    continue;
                }
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                limits.take(size)?;
                on_file(relative, &path, size)?;
            }
        }
        Ok(())
    }
    walk(dir, dir, on_file, &mut Limits::new())
}

/// Folders holding a SKILL.md below `root`, without looking inside a skill once found.
pub(super) fn skill_dirs(root: &Path, max_depth: usize) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut pending = vec![(root.to_path_buf(), 0)];
    while let Some((dir, depth)) = pending.pop() {
        if dir.join(SKILL_FILE).is_file() {
            found.push(dir);
            continue;
        }
        if depth >= max_depth {
            continue;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let skip = matches!(name.as_str(), ".trash" | ".git" | "node_modules" | "cache");
            if !skip && entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                pending.push((entry.path(), depth + 1));
            }
        }
    }
    found.sort();
    found
}
