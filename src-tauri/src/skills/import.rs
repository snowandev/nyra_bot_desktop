//! Finding skills (Claude Code, a folder, archives, dropped files) and installing the chosen ones.

use super::*;

/// Skills found but not installed yet. Importing takes ids from this list, never paths from the frontend.
#[derive(Default)]
pub struct SkillImports {
    pub(super) pending: Mutex<HashMap<String, (Bundle, Source)>>,
    pub(super) next_id: AtomicU64,
}

#[derive(Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub(super) enum CandidateStatus {
    New,
    Update,
    Imported,
    Conflict,
    Invalid,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) description: String,
    pub(super) location: String,
    pub(super) status: CandidateStatus,
    pub(super) reason: Option<String>,
}

/// How a found skill relates to what is installed.
pub(super) fn status_of(skills: &Path, bundle: &Bundle, meta: &Meta) -> CandidateStatus {
    let target = skills.join(&meta.name);
    if !target.join(SKILL_FILE).is_file() {
        return CandidateStatus::New;
    }
    let record = read_record(&target);
    if record.edited_at.is_some() || record.origin.as_deref() != Some(bundle.origin.as_str()) {
        return CandidateStatus::Conflict;
    }
    if record.content_hash.as_deref() == Some(bundle.content_hash().as_str()) {
        CandidateStatus::Imported
    } else {
        CandidateStatus::Update
    }
}

/// Where dropped files come from. Kept in each skill's record to recognise a newer version on a later drop, so it
/// never changes with the interface's language; only how it is shown does.
pub(super) const DROPPED_ORIGIN: &str = "Archivos soltados";

pub(super) fn display_path(app: &AppHandle, path: &str) -> String {
    if let Some(rest) = path.strip_prefix(DROPPED_ORIGIN) {
        return format!("{}{rest}", t("native.skills.droppedFiles"));
    }
    let home = app
        .path()
        .home_dir()
        .map(|h| h.display().to_string())
        .unwrap_or_default();
    match path.strip_prefix(&home) {
        Some(rest) if !home.is_empty() => format!("~{rest}"),
        _ => path.to_string(),
    }
}

/// Registers what was found and describes it; a source without any valid skill becomes one invalid entry.
pub(super) fn stage(
    app: &AppHandle,
    imports: &SkillImports,
    found: Vec<(Result<Vec<Bundle>, String>, String)>,
    source: Source,
) -> Result<Vec<Candidate>, String> {
    let skills = skills_dir(app)?;
    let mut pending = imports
        .pending
        .lock()
        .map_err(|_| t("native.skills.importUnavailable"))?;
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    for (bundles, label) in found {
        let bundles = match bundles {
            Ok(bundles) => bundles,
            Err(reason) => {
                let location = display_path(app, &label);
                candidates.push(Candidate {
                    id: String::new(),
                    name: location
                        .rsplit(['/', '\\'])
                        .next()
                        .unwrap_or(&location)
                        .to_string(),
                    description: String::new(),
                    location: location.clone(),
                    status: CandidateStatus::Invalid,
                    reason: Some(reason),
                });
                continue;
            }
        };
        for bundle in bundles {
            let id = imports.next_id.fetch_add(1, Ordering::Relaxed).to_string();
            let location = display_path(app, &bundle.origin);
            let candidate = match bundle.meta() {
                Ok(meta) => {
                    // The same skill often appears twice (installed and synced copies); one is enough
                    if !seen.insert((meta.name.clone(), bundle.content_hash())) {
                        continue;
                    }
                    if is_builtin(&skills.join(&meta.name)) {
                        candidates.push(Candidate {
                            id: String::new(),
                            name: meta.name,
                            description: meta.description,
                            location,
                            status: CandidateStatus::Invalid,
                            reason: Some(t("native.skills.reservedByNyra")),
                        });
                        continue;
                    }
                    Candidate {
                        status: status_of(&skills, &bundle, &meta),
                        name: meta.name,
                        description: meta.description,
                        id: id.clone(),
                        location,
                        reason: None,
                    }
                }
                Err(reason) => Candidate {
                    id: String::new(),
                    name: bundle
                        .origin
                        .rsplit('/')
                        .next()
                        .unwrap_or_default()
                        .to_string(),
                    description: String::new(),
                    location,
                    status: CandidateStatus::Invalid,
                    reason: Some(reason),
                },
            };
            if candidate.status != CandidateStatus::Invalid {
                pending.insert(id, (bundle, source));
            }
            candidates.push(candidate);
        }
    }
    Ok(candidates)
}

pub(super) fn bundles_in_folder(dir: &Path) -> Result<Vec<Bundle>, String> {
    bundles_from_files(files_in_dir(dir)?, &dir.display().to_string())
}

use crate::util::claude_dir;

/// Personal skills, skills from plugins, and the `.claude/skills` of every project Claude Code worked in.
#[tauri::command]
pub async fn scan_claude_code_skills(
    app: AppHandle,
    imports: State<'_, SkillImports>,
) -> Result<Vec<Candidate>, String> {
    let claude = claude_dir(&app)?;
    let projects = crate::claude_code::project_paths(&app);
    let found = tauri::async_runtime::spawn_blocking(move || {
        let mut dirs = skill_dirs(&claude.join("skills"), 4);
        dirs.extend(skill_dirs(&claude.join("plugins"), 6));
        for project in projects {
            dirs.extend(skill_dirs(&project.join(".claude").join("skills"), 2));
        }
        dirs.into_iter()
            .map(|dir| (bundles_in_folder(&dir), dir.display().to_string()))
            .collect::<Vec<_>>()
    })
    .await
    .map_err(to_message)?;
    stage(&app, &imports, found, Source::ClaudeCode)
}

/// "Buscar en otra carpeta…" and "Elegir carpeta…": the folder can be one skill or contain several.
#[tauri::command]
pub async fn pick_skill_folder(
    app: AppHandle,
    imports: State<'_, SkillImports>,
    from_claude_code: bool,
) -> Result<Option<Vec<Candidate>>, String> {
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let folder = folder.into_path().map_err(to_message)?;
    let found = if folder.join(SKILL_FILE).is_file() {
        vec![(bundles_in_folder(&folder), folder.display().to_string())]
    } else {
        let dirs = skill_dirs(&folder, 3);
        if dirs.is_empty() {
            vec![(
                Err(t("native.skills.skillFileMissing")),
                folder.display().to_string(),
            )]
        } else {
            dirs.into_iter()
                .map(|dir| (bundles_in_folder(&dir), dir.display().to_string()))
                .collect()
        }
    };
    let source = if from_claude_code {
        Source::ClaudeCode
    } else {
        Source::File
    };
    stage(&app, &imports, found, source).map(Some)
}

#[tauri::command]
pub async fn pick_skill_archives(
    app: AppHandle,
    imports: State<'_, SkillImports>,
) -> Result<Option<Vec<Candidate>>, String> {
    let Some(paths) = app
        .dialog()
        .file()
        .add_filter("Skill", &["zip", "skill"])
        .blocking_pick_files()
    else {
        return Ok(None);
    };
    let found = paths
        .into_iter()
        .filter_map(|path| path.into_path().ok())
        .map(|path| {
            let label = path.display().to_string();
            let bundles = fs::read(&path)
                .map_err(to_message)
                .and_then(|bytes| bundles_from_files(files_in_zip(&bytes)?, &label));
            (bundles, label)
        })
        .collect();
    stage(&app, &imports, found, Source::File).map(Some)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedFile {
    /// Relative path as the drop reported it: "my-skill/SKILL.md", or just "skill.zip"
    pub(super) path: String,
    /// Base64, so binary files survive the trip from the WebView
    pub(super) data: String,
}

/// Files dropped on the import area: archives are opened, loose files are grouped into their folders.
#[tauri::command]
pub async fn stage_dropped_skills(
    app: AppHandle,
    imports: State<'_, SkillImports>,
    files: Vec<DroppedFile>,
) -> Result<Vec<Candidate>, String> {
    use base64::Engine;
    let mut found = Vec::new();
    let mut loose = BTreeMap::new();
    let mut limits = Limits::new();
    for file in files {
        let Some(path) = plain_key(Path::new(&file.path)) else {
            continue;
        };
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(file.data.as_bytes())
            .map_err(to_message)?;
        limits.take(bytes.len() as u64)?;
        let lower = path.to_lowercase();
        if lower.ends_with(".zip") || lower.ends_with(".skill") {
            found.push((
                files_in_zip(&bytes).and_then(|f| bundles_from_files(f, &path)),
                path,
            ));
        } else if !is_ignored(&path) {
            loose.insert(path, bytes);
        }
    }
    if !loose.is_empty() {
        found.push((
            bundles_from_files(loose, DROPPED_ORIGIN),
            DROPPED_ORIGIN.to_string(),
        ));
    }
    stage(&app, &imports, found, Source::File)
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub(super) enum Outcome {
    Imported,
    Updated,
    Conflict,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) outcome: Outcome,
    /// For an update, the version change when both versions declare one
    pub(super) detail: Option<String>,
    /// For a conflict with a skill edited in Nyra, when it was edited
    pub(super) edited_at: Option<i64>,
}

/// Installs the chosen skills. One that would replace a different or edited skill is left pending and
/// reported as a conflict, unless its id is in `replace`.
#[tauri::command]
pub async fn import_skills(
    app: AppHandle,
    imports: State<'_, SkillImports>,
    ids: Vec<String>,
    replace: Vec<String>,
) -> Result<Vec<ImportResult>, String> {
    let skills = skills_dir(&app)?;
    let mut pending = imports
        .pending
        .lock()
        .map_err(|_| t("native.skills.importUnavailable"))?;
    let mut results = Vec::new();
    for id in ids {
        let Some((bundle, source)) = pending.get(&id) else {
            continue;
        };
        let meta = bundle.meta()?;
        let target = skills.join(&meta.name);
        // Staging already left these out; checked again in case one was installed in between
        if is_builtin(&target) {
            return Err(t("native.skills.reservedByNyra"));
        }
        let status = status_of(&skills, bundle, &meta);
        if status == CandidateStatus::Conflict && !replace.contains(&id) {
            results.push(ImportResult {
                id,
                name: meta.name,
                outcome: Outcome::Conflict,
                detail: None,
                edited_at: read_record(&target).edited_at,
            });
            continue;
        }
        let previous_version = fs::read_to_string(target.join(SKILL_FILE))
            .ok()
            .and_then(|text| meta_of(&parse_document(&text).ok()?).ok())
            .and_then(|old| old.metadata.get("version").cloned());
        let record = Record {
            source: *source,
            origin: Some(bundle.origin.clone()),
            content_hash: Some(bundle.content_hash()),
            edited_at: None,
            imported_at: Some(now_millis()),
            // A fresh import replaces any earlier adaptation, so there is nothing to restore
            ..Record::default()
        };
        install(&skills, bundle, &meta.name, &record)?;
        let detail = match (previous_version, meta.metadata.get("version")) {
            (Some(old), Some(new)) if &old != new => Some(t_with(
                "native.skills.versionChange",
                &[("old", &old), ("new", new)],
            )),
            _ => None,
        };
        results.push(ImportResult {
            id: id.clone(),
            name: meta.name,
            outcome: if status == CandidateStatus::New {
                Outcome::Imported
            } else {
                Outcome::Updated
            },
            detail,
            edited_at: None,
        });
        pending.remove(&id);
    }
    Ok(results)
}
