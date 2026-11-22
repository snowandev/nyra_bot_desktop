//! Agent Skills (https://agentskills.io): a folder with a `SKILL.md` (YAML frontmatter plus Markdown
//! instructions) and optional `scripts/`, `references/` and `assets/`. Skills live in `skills/<name>/` inside
//! the app's data directory, exactly as the standard defines them, so they can be exported and used anywhere.
//! What Nyra needs to remember about one (where it came from, whether it was edited here) goes in a separate
//! file, so `SKILL.md` never gets fields of our own.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use yaml_rust2::yaml::Hash;
use yaml_rust2::{Yaml, YamlEmitter, YamlLoader};

use crate::i18n::{t, t_with};
use crate::storage::now_millis;
use crate::util::{data_dir, plain_key, to_message, where_to_save};

mod builtins;
mod bundles;
mod document;
pub mod files;
pub mod import;

pub use builtins::{install_builtin_skills, renamed_builtin};
pub use import::SkillImports;
// Each part reaches the others' items through here
use builtins::*;
use bundles::*;
use document::*;
use import::*;

const SKILL_FILE: &str = "SKILL.md";
const RECORD_FILE: &str = ".nyra-skill.json";
const NAME_MAX: usize = 64;
const DESCRIPTION_MAX: usize = 1024;
const COMPATIBILITY_MAX: usize = 500;
// A skill is instructions plus a few helper files; anything bigger is almost certainly not one
const MAX_BUNDLE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_BUNDLE_FILES: usize = 500;

fn skills_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("skills");
    fs::create_dir_all(&dir).map_err(to_message)?;
    Ok(dir)
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Source {
    #[default]
    Own,
    ClaudeCode,
    File,
    /// Comes with Nyra (`builtin-skills/`)
    Nyra,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Record {
    source: Source,
    origin: Option<String>,
    content_hash: Option<String>,
    edited_at: Option<i64>,
    imported_at: Option<i64>,
    /// When the skill was rewritten to work with any model
    adapted_at: Option<i64>,
    /// The skill before its first adaptation, so it can be restored
    original: Option<OriginalSkill>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OriginalSkill {
    text: String,
    edited_at: Option<i64>,
}

fn read_record(dir: &Path) -> Record {
    fs::read_to_string(dir.join(RECORD_FILE))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_record(dir: &Path, record: &Record) -> Result<(), String> {
    let json = serde_json::to_string_pretty(record).map_err(to_message)?;
    fs::write(dir.join(RECORD_FILE), json).map_err(to_message)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFile {
    path: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    name: String,
    description: String,
    license: Option<String>,
    compatibility: Option<String>,
    metadata: BTreeMap<String, String>,
    body: String,
    files: Vec<SkillFile>,
    source: Source,
    edited_at: Option<i64>,
    adapted_at: Option<i64>,
    has_original: bool,
    // Where it is installed: the model runs its scripts by their full path
    dir: String,
}

fn load_skill(dir: &Path) -> Result<Skill, String> {
    let text = fs::read_to_string(dir.join(SKILL_FILE))
        .map_err(|_| t("native.skills.skillFileMissing"))?;
    let document = parse_document(&text)?;
    let meta = meta_of(&document)?;
    let record = read_record(dir);
    let files = file_sizes_in_dir(dir)?
        .into_iter()
        .map(|(path, size)| SkillFile { path, size })
        .collect();
    Ok(Skill {
        name: meta.name,
        description: meta.description,
        license: meta.license,
        compatibility: meta.compatibility,
        metadata: meta.metadata,
        body: document.body,
        files,
        source: record.source,
        edited_at: record.edited_at,
        adapted_at: record.adapted_at,
        has_original: record.original.is_some(),
        dir: dir.to_string_lossy().into_owned(),
    })
}

fn installed_dir(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    validate_name(name)?;
    Ok(skills_dir(app)?.join(name))
}

/// Writes next to the target and swaps it in, so a failure halfway never leaves a broken skill behind.
fn install(dir: &Path, bundle: &Bundle, name: &str, record: &Record) -> Result<(), String> {
    let staging = dir.join(format!(".tmp-{name}-{}", now_millis()));
    let result = write_staged(&staging, bundle, record).and_then(|()| swap_in(dir, &staging, name));
    // Nothing half written is left behind; the skills list skips these folders, but they would pile up
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

/// The old skill is set aside rather than deleted first: if the new one can't be moved in, the old one goes back
fn swap_in(dir: &Path, staging: &Path, name: &str) -> Result<(), String> {
    let target = &dir.join(name);
    if !target.exists() {
        return move_into_place(staging, target);
    }
    // Only a skill's folder is replaced; anything else with its name is left alone
    if !target.is_dir() {
        return Err(to_message(std::io::Error::from(
            std::io::ErrorKind::AlreadyExists,
        )));
    }
    let old = dir.join(format!(".old-{name}-{}", now_millis()));
    move_into_place(target, &old)?;
    if let Err(e) = move_into_place(staging, target) {
        let _ = move_into_place(&old, target);
        return Err(e);
    }
    let _ = fs::remove_dir_all(&old);
    Ok(())
}

fn write_staged(staging: &Path, bundle: &Bundle, record: &Record) -> Result<(), String> {
    for (path, bytes) in &bundle.files {
        let file = staging.join(path);
        if let Some(parent) = file.parent() {
            fs::create_dir_all(parent).map_err(to_message)?;
        }
        fs::write(&file, bytes).map_err(to_message)?;
    }
    write_record(staging, record)
}

/// On Windows the antivirus or the search indexer may still hold files just written, so moving their folder is
/// refused for a moment; it is tried again a few times before giving up.
fn move_into_place(from: &Path, to: &Path) -> Result<(), String> {
    const ATTEMPTS: u64 = 5;
    for attempt in 1..ATTEMPTS {
        match fs::rename(from, to) {
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                std::thread::sleep(std::time::Duration::from_millis(100 * attempt));
            }
            result => return result.map_err(to_message),
        }
    }
    fs::rename(from, to).map_err(to_message)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillList {
    skills: Vec<Skill>,
    /// Why some of Nyra's skills are missing, so the user sees it instead of an empty list
    install_error: Option<String>,
}

#[tauri::command]
pub async fn list_skills(app: AppHandle) -> Result<SkillList, String> {
    let dir = skills_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        // Also tried at startup; again here, so one that failed then (a file still locked) gets another chance
        let install_error = install_builtins_in(&dir).err();
        let mut skills: Vec<Skill> = fs::read_dir(&dir)
            .map_err(to_message)?
            .flatten()
            .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
            // A folder that isn't a valid skill (copied by hand, half written) can't be used, so it isn't listed
            .filter_map(|entry| load_skill(&entry.path()).ok())
            .collect();
        skills.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(SkillList {
            skills,
            install_error,
        })
    })
    .await
    .map_err(to_message)?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataEntry {
    key: String,
    value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDraft {
    name: String,
    description: String,
    license: String,
    metadata: Vec<MetadataEntry>,
    body: String,
}

fn apply_draft(document: &mut Document, draft: &SkillDraft) {
    let fields = &mut document.fields;
    fields.insert(key("name"), Yaml::String(draft.name.clone()));
    fields.insert(
        key("description"),
        Yaml::String(draft.description.trim().to_string()),
    );
    let license = draft.license.trim();
    if license.is_empty() {
        fields.remove(&key("license"));
    } else {
        fields.insert(key("license"), Yaml::String(license.to_string()));
    }
    let metadata: Hash = draft
        .metadata
        .iter()
        .filter(|entry| !entry.key.trim().is_empty())
        .map(|entry| {
            (
                key(entry.key.trim()),
                Yaml::String(entry.value.trim().to_string()),
            )
        })
        .collect();
    if metadata.is_empty() {
        fields.remove(&key("metadata"));
    } else {
        fields.insert(key("metadata"), Yaml::Hash(metadata));
    }
    document.body = draft.body.clone();
}

/// Creates a skill (`original` is None) or edits one, keeping any frontmatter field Nyra doesn't know about.
#[tauri::command]
pub async fn save_skill(
    app: AppHandle,
    original: Option<String>,
    draft: SkillDraft,
) -> Result<(), String> {
    validate_name(&draft.name)?;
    validate_description(draft.description.trim())?;
    let dir = skills_dir(&app)?;
    let target = dir.join(&draft.name);
    let renamed = original.as_deref() != Some(draft.name.as_str());
    if renamed && target.exists() {
        return Err(t_with("native.skills.nameTaken", &[("name", &draft.name)]));
    }

    let (mut document, mut record) = match &original {
        Some(name) => {
            let current = installed_dir(&app, name)?;
            if renamed && is_builtin(&current) {
                return Err(t("native.skills.builtinRename"));
            }
            let text = fs::read_to_string(current.join(SKILL_FILE)).map_err(to_message)?;
            if renamed {
                fs::rename(&current, &target).map_err(to_message)?;
            }
            (parse_document(&text)?, read_record(&target))
        }
        None => {
            fs::create_dir_all(&target).map_err(to_message)?;
            (
                Document {
                    fields: Hash::new(),
                    body: String::new(),
                },
                Record::default(),
            )
        }
    };
    apply_draft(&mut document, &draft);
    record.edited_at = Some(now_millis());
    fs::write(target.join(SKILL_FILE), render(&document)?).map_err(to_message)?;
    write_record(&target, &record)
}

/// Saves the model-neutral version of a skill. Only the description and the instructions change; the first
/// adaptation keeps the previous SKILL.md so `restore_original_skill` can undo it.
#[tauri::command]
pub async fn save_adapted_skill(
    app: AppHandle,
    name: String,
    description: String,
    body: String,
) -> Result<(), String> {
    let description = description.trim();
    validate_description(description)?;
    if body.trim().is_empty() {
        return Err(t("native.skills.adaptedEmpty"));
    }
    let dir = installed_dir(&app, &name)?;
    let text = fs::read_to_string(dir.join(SKILL_FILE)).map_err(to_message)?;
    let mut document = parse_document(&text)?;
    let mut record = read_record(&dir);
    if record.original.is_none() {
        record.original = Some(OriginalSkill {
            text,
            edited_at: record.edited_at,
        });
    }
    document
        .fields
        .insert(key("description"), Yaml::String(description.to_string()));
    document.body = body;
    let now = now_millis();
    // An adaptation is an edit made in Nyra, so re-importing the source won't silently overwrite it
    record.edited_at = Some(now);
    record.adapted_at = Some(now);
    fs::write(dir.join(SKILL_FILE), render(&document)?).map_err(to_message)?;
    write_record(&dir, &record)
}

/// Puts back the SKILL.md from before the first adaptation, with its previous edit state.
#[tauri::command]
pub async fn restore_original_skill(app: AppHandle, name: String) -> Result<(), String> {
    let dir = installed_dir(&app, &name)?;
    let mut record = read_record(&dir);
    let Some(original) = record.original.take() else {
        return Err(t("native.skills.noOriginal"));
    };
    fs::write(dir.join(SKILL_FILE), &original.text).map_err(to_message)?;
    record.edited_at = original.edited_at;
    record.adapted_at = None;
    write_record(&dir, &record)
}

#[tauri::command]
pub async fn delete_skill(app: AppHandle, name: String) -> Result<(), String> {
    let dir = installed_dir(&app, &name)?;
    if is_builtin(&dir) {
        return Err(t("native.skills.builtinDelete"));
    }
    fs::remove_dir_all(dir).map_err(to_message)
}

/// Asks where to save and writes a standard archive: a `<name>/` folder with every file but Nyra's own.
#[tauri::command]
pub async fn export_skill(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let dir = installed_dir(&app, &name)?;
    let Some(destination) = where_to_save(
        &app,
        format!("{name}.zip"),
        Some(("Skill".into(), &["zip"])),
    )
    .await?
    else {
        return Ok(None);
    };
    let mut writer = zip::ZipWriter::new(fs::File::create(&destination).map_err(to_message)?);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for (path, bytes) in files_in_dir(&dir)? {
        writer
            .start_file(format!("{name}/{path}"), options)
            .map_err(to_message)?;
        writer.write_all(&bytes).map_err(to_message)?;
    }
    writer.finish().map_err(to_message)?;
    Ok(Some(destination.display().to_string()))
}

#[cfg(test)]
mod tests {

    #[test]
    fn adds_replaces_and_removes_files_but_never_skill_md() {
        use base64::Engine;
        let encode = |text: &str| base64::engine::general_purpose::STANDARD.encode(text);
        let dir = std::env::temp_dir().join(format!("nyra-skill-edit-{}", now_millis()));
        fs::create_dir_all(dir.join("references")).unwrap();
        fs::write(dir.join(SKILL_FILE), "---\nname: x\n---\n").unwrap();
        fs::write(dir.join("references/viejo.md"), "viejo").unwrap();
        let added = vec![DroppedFile {
            path: "scripts/contar.py".into(),
            data: encode("print(1)"),
        }];
        apply_file_changes(&dir, added, &["references/viejo.md".into()]).unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("scripts/contar.py")).unwrap(),
            "print(1)"
        );
        assert!(!dir.join("references/viejo.md").exists());
        for refused in [
            SKILL_FILE,
            "skill.md",
            "Skill.MD. ",
            "../fuera.py",
            RECORD_FILE,
            ".NYRA-SKILL.json",
        ] {
            let file = DroppedFile {
                path: refused.into(),
                data: encode("x"),
            };
            assert!(
                apply_file_changes(&dir, vec![file], &[]).is_err(),
                "{refused}"
            );
        }
        assert!(apply_file_changes(&dir, vec![], &[SKILL_FILE.into()]).is_err());
        assert!(apply_file_changes(&dir, vec![], &["skill.md".into()]).is_err());
        assert!(dir.join(SKILL_FILE).exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn shows_only_plain_files_inside_the_skill() {
        let dir = std::env::temp_dir().join(format!("nyra-skill-file-{}", now_millis()));
        fs::create_dir_all(dir.join("scripts")).unwrap();
        fs::write(dir.join("scripts/extraer.py"), "print('hola')").unwrap();
        assert!(skill_file_path(&dir, "scripts/extraer.py").is_ok());
        for refused in [
            "",
            "../secreto.txt",
            "/etc/hosts",
            "scripts/../../x",
            "scripts",
        ] {
            assert!(skill_file_path(&dir, refused).is_err(), "{refused}");
        }
        fs::remove_dir_all(dir).unwrap();
    }
    use super::files::*;
    use super::*;

    const SKILL: &str = "---\nname: code-review\ndescription: Revisa código. Úsala con un diff.\nlicense: MIT\nallowed-tools: Bash(git:*)\nmetadata:\n  author: equipo\n  version: \"1.2\"\n---\n\n# Revisión\n\nPasos…\n";

    #[test]
    fn builtin_skills_follow_the_standard() {
        for (name, text) in BUILTIN_SKILLS {
            let meta = builtin_bundle(name, text).meta().unwrap();
            assert_eq!(meta.name, name, "the folder and the name must match");
        }
    }

    fn temp_skills_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nyra-test-{}-{label}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn builtins_install_once_and_respect_the_user() {
        let dir = temp_skills_dir("builtins");
        install_builtins_in(&dir).unwrap();
        for (name, _) in BUILTIN_SKILLS {
            let record = read_record(&dir.join(name));
            assert!(record.source == Source::Nyra && record.edited_at.is_none());
        }

        // Deleted before built-ins became permanent: brought back
        fs::remove_dir_all(dir.join("summarize")).unwrap();
        // Edited by the user: kept as it is, even when Nyra's version differs
        let edited = dir.join("writing");
        fs::write(
            edited.join(SKILL_FILE),
            "---\nname: writing\ndescription: Mía.\n---\nMía",
        )
        .unwrap();
        let mut record = read_record(&edited);
        record.edited_at = Some(1);
        record.content_hash = Some("old".to_string());
        write_record(&edited, &record).unwrap();
        // Untouched but from an older version of Nyra: updated
        let outdated = dir.join("explain");
        fs::write(
            outdated.join(SKILL_FILE),
            "---\nname: explain\ndescription: Vieja.\n---\nVieja",
        )
        .unwrap();
        let mut record = read_record(&outdated);
        record.content_hash = Some("old".to_string());
        write_record(&outdated, &record).unwrap();

        install_builtins_in(&dir).unwrap();
        assert!(is_builtin(&dir.join("summarize")));
        assert!(fs::read_to_string(edited.join(SKILL_FILE))
            .unwrap()
            .contains("Mía"));
        assert!(!fs::read_to_string(outdated.join(SKILL_FILE))
            .unwrap()
            .contains("Vieja"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn old_and_retired_builtins_go_unless_the_user_changed_them() {
        let dir = temp_skills_dir("renamed");
        for (name, edited_at) in [
            ("resumir", None),
            ("escribir", Some(1)),
            ("brainstorm", None),
        ] {
            let text = format!("---\nname: {name}\ndescription: Vieja.\n---\nVieja");
            let record = Record {
                source: Source::Nyra,
                edited_at,
                ..Record::default()
            };
            install(&dir, &builtin_bundle(name, &text), name, &record).unwrap();
        }

        install_builtins_in(&dir).unwrap();
        assert!(!dir.join("resumir").exists() && !dir.join("brainstorm").exists());
        assert!(dir.join("escribir").exists() && !is_builtin(&dir.join("escribir")));
        assert!(is_builtin(&dir.join("summarize")) && is_builtin(&dir.join("writing")));
        assert_eq!(renamed_builtin("commit-y-pr"), Some("commit-and-pr"));
        assert_eq!(renamed_builtin("mine"), None);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn one_built_in_that_cannot_be_installed_does_not_leave_the_rest_out() {
        let dir = temp_skills_dir("blocked");
        // A file where the folder should go: it can't be replaced, so that one fails
        fs::write(dir.join("summarize"), "no es una carpeta").unwrap();
        let error = install_builtins_in(&dir).unwrap_err();
        assert!(error.contains("summarize"));
        assert!(BUILTIN_SKILLS
            .iter()
            .filter(|(name, _)| *name != "summarize")
            .all(|(name, _)| is_builtin(&dir.join(name))));
        let leftovers = fs::read_dir(&dir).unwrap().flatten();
        assert!(!leftovers
            .into_iter()
            .any(|e| e.file_name().to_string_lossy().starts_with(".tmp-")));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn replacing_a_skill_keeps_only_the_new_one() {
        let dir = temp_skills_dir("replace");
        let record = Record::default();
        let old = "---\nname: notas\ndescription: Vieja.\n---\nVieja";
        let new = "---\nname: notas\ndescription: Nueva.\n---\nNueva";
        install(&dir, &builtin_bundle("notas", old), "notas", &record).unwrap();
        install(&dir, &builtin_bundle("notas", new), "notas", &record).unwrap();
        assert!(fs::read_to_string(dir.join("notas").join(SKILL_FILE))
            .unwrap()
            .contains("Nueva"));
        let names: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["notas".to_string()]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn reads_every_standard_field() {
        let document = parse_document(SKILL).unwrap();
        let meta = meta_of(&document).unwrap();
        assert_eq!(meta.name, "code-review");
        assert_eq!(meta.license.as_deref(), Some("MIT"));
        assert_eq!(meta.metadata["version"], "1.2");
        // Not used by Nyra yet, but part of the standard: it stays in the file
        assert_eq!(
            text_field(&document.fields, "allowed-tools").as_deref(),
            Some("Bash(git:*)")
        );
        assert!(document.body.starts_with("# Revisión"));
    }

    #[test]
    fn handles_windows_line_endings_and_a_bom() {
        let text = format!("\u{feff}{}", SKILL.replace('\n', "\r\n"));
        assert_eq!(
            meta_of(&parse_document(&text).unwrap()).unwrap().name,
            "code-review"
        );
    }

    #[test]
    fn applies_the_naming_rules() {
        for good in ["a", "pdf-processing", "v2-tools"] {
            assert!(validate_name(good).is_ok(), "{good}");
        }
        for bad in [
            "",
            "PDF",
            "-pdf",
            "pdf-",
            "pdf--tools",
            "mis notas",
            "../etc",
            &"a".repeat(65),
        ] {
            assert!(validate_name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn reports_a_long_description_with_its_length() {
        let error = validate_description(&"x".repeat(1310)).unwrap_err();
        let length = format!("1{}310", t("native.skills.thousandsSeparator"));
        assert_eq!(
            error,
            t_with("native.skills.descriptionTooLong", &[("length", &length)])
        );
    }

    #[test]
    fn editing_keeps_fields_nyra_does_not_know() {
        let mut document = parse_document(SKILL).unwrap();
        let draft = SkillDraft {
            name: "code-review".into(),
            description: "Nueva descripción".into(),
            license: String::new(),
            metadata: vec![MetadataEntry {
                key: "version".into(),
                value: "2.0".into(),
            }],
            body: "# Nuevo".into(),
        };
        apply_draft(&mut document, &draft);
        let reread = parse_document(&render(&document).unwrap()).unwrap();
        let meta = meta_of(&reread).unwrap();
        assert_eq!(meta.description, "Nueva descripción");
        assert_eq!(meta.license, None);
        assert_eq!(
            text_field(&reread.fields, "allowed-tools").as_deref(),
            Some("Bash(git:*)")
        );
        assert_eq!(meta.metadata.get("author"), None);
        assert_eq!(reread.body, "# Nuevo");
    }

    #[test]
    fn finds_one_skill_per_skill_md_but_not_nested_examples() {
        let files: BTreeMap<String, Vec<u8>> = [
            ("a/SKILL.md", SKILL),
            ("a/references/r.md", "ref"),
            ("a/examples/demo/SKILL.md", SKILL),
            ("b/SKILL.md", SKILL),
            ("notes.txt", "x"),
        ]
        .into_iter()
        .map(|(p, c)| (p.to_string(), c.as_bytes().to_vec()))
        .collect();
        let bundles = bundles_from_files(files, "zip").unwrap();
        assert_eq!(bundles.len(), 2);
        assert!(bundles[0].files.contains_key("references/r.md"));
        assert!(bundles[0].files.contains_key("examples/demo/SKILL.md"));
        assert_eq!(bundles[1].origin, "zip/b");
    }

    #[test]
    fn archives_cannot_write_outside_the_skill_folder() {
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buffer);
            let options = zip::write::SimpleFileOptions::default();
            for name in [
                "skill/SKILL.md",
                "../../evil.sh",
                "/etc/passwd",
                "skill/__MACOSX/x",
            ] {
                writer.start_file(name, options).unwrap();
                writer.write_all(SKILL.as_bytes()).unwrap();
            }
            writer.finish().unwrap();
        }
        let files = files_in_zip(buffer.get_ref()).unwrap();
        assert!(files
            .keys()
            .all(|path| !path.contains("..") && !path.starts_with('/')));
        assert!(files.contains_key("skill/SKILL.md"));
        assert!(!files.keys().any(|path| path.contains("__MACOSX")));
    }

    #[test]
    fn what_a_zip_holds_counts_by_what_is_read_not_what_it_declares() {
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buffer);
            // Compressed, the three files take a few kilobytes; unpacked they pass the 20 MB limit
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            let big = vec![b'a'; 8 * 1024 * 1024];
            for name in ["skill/SKILL.md", "skill/a.txt", "skill/b.txt"] {
                writer.start_file(name, options).unwrap();
                writer.write_all(&big).unwrap();
            }
            writer.finish().unwrap();
        }
        assert_eq!(
            files_in_zip(buffer.get_ref()).unwrap_err(),
            t("native.skills.tooBig")
        );
    }

    #[test]
    fn a_folder_without_skill_md_is_reported() {
        let files = BTreeMap::from([("readme.md".to_string(), b"x".to_vec())]);
        assert_eq!(
            bundles_from_files(files, "x").err(),
            Some(t("native.skills.skillFileMissing"))
        );
    }
}
