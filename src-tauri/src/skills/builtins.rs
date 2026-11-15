//! The skills that come with Nyra: installed at start, updated while untouched, never deleted.

use super::*;

// The last eight are the Código space's, for working on a project's code
pub(super) const BUILTIN_SKILLS: [(&str, &str); 12] = [
    (
        "writing",
        include_str!("../../builtin-skills/writing/SKILL.md"),
    ),
    (
        "summarize",
        include_str!("../../builtin-skills/summarize/SKILL.md"),
    ),
    (
        "explain",
        include_str!("../../builtin-skills/explain/SKILL.md"),
    ),
    ("plan", include_str!("../../builtin-skills/plan/SKILL.md")),
    (
        "explain-project",
        include_str!("../../builtin-skills/explain-project/SKILL.md"),
    ),
    (
        "code-review",
        include_str!("../../builtin-skills/code-review/SKILL.md"),
    ),
    (
        "write-tests",
        include_str!("../../builtin-skills/write-tests/SKILL.md"),
    ),
    ("debug", include_str!("../../builtin-skills/debug/SKILL.md")),
    (
        "refactor",
        include_str!("../../builtin-skills/refactor/SKILL.md"),
    ),
    (
        "commit-and-pr",
        include_str!("../../builtin-skills/commit-and-pr/SKILL.md"),
    ),
    (
        "update-dependencies",
        include_str!("../../builtin-skills/update-dependencies/SKILL.md"),
    ),
    (
        "document-code",
        include_str!("../../builtin-skills/document-code/SKILL.md"),
    ),
];

/// The built-ins' names before they were in English, as (old, new)
pub(super) const RENAMED_BUILTINS: [(&str, &str); 11] = [
    ("escribir", "writing"),
    ("resumir", "summarize"),
    ("explicar", "explain"),
    ("explicar-proyecto", "explain-project"),
    ("revisar-codigo", "code-review"),
    ("escribir-tests", "write-tests"),
    ("depurar", "debug"),
    ("refactorizar", "refactor"),
    ("commit-y-pr", "commit-and-pr"),
    ("actualizar-dependencias", "update-dependencies"),
    ("documentar-codigo", "document-code"),
];

/// A built-in's current name for one it had before, so what refers to it by name can follow it
pub fn renamed_builtin(name: &str) -> Option<&'static str> {
    RENAMED_BUILTINS
        .iter()
        .find(|(old, _)| *old == name)
        .map(|(_, new)| *new)
}

/// Built-ins Nyra no longer includes: "plan" took the welcome screen's place of the brainstorming one
pub(super) const RETIRED_BUILTINS: [&str; 2] = ["lluvia-de-ideas", "brainstorm"];

/// An untouched copy of an old or retired built-in goes. One the user edited or adapted stays under its name as their
/// own skill, which they can then delete.
pub(super) fn retire_old_builtins(skills: &Path) -> Result<(), String> {
    let old_names = RENAMED_BUILTINS.iter().map(|(old, _)| *old);
    for old in old_names.chain(RETIRED_BUILTINS) {
        let dir = skills.join(old);
        if !is_builtin(&dir) {
            continue;
        }
        let mut record = read_record(&dir);
        if record.edited_at.is_none() && record.adapted_at.is_none() {
            fs::remove_dir_all(&dir).map_err(to_message)?;
        } else {
            record.source = Source::Own;
            write_record(&dir, &record)?;
        }
    }
    Ok(())
}

/// Earlier versions recorded here which built-ins were offered, so a deleted one wasn't brought back
pub(super) const LEGACY_BUILTINS_FILE: &str = ".nyra-builtins.json";

/// Built-ins can be edited but never deleted, renamed or replaced by an import: the welcome screen relies on them.
pub(super) fn is_builtin(dir: &Path) -> bool {
    dir.join(SKILL_FILE).is_file() && read_record(dir).source == Source::Nyra
}

pub(super) fn builtin_bundle(name: &str, text: &str) -> Bundle {
    Bundle {
        files: BTreeMap::from([(SKILL_FILE.to_string(), text.as_bytes().to_vec())]),
        origin: format!("nyra:{name}"),
    }
}

/// A missing built-in is installed (also one deleted before they became permanent); one the user edited, or a
/// skill of theirs with the same name, is never overwritten; an untouched one is updated when Nyra changes it.
/// Each one on its own: one that can't be installed doesn't leave the rest out.
pub(super) fn install_builtins_in(skills: &Path) -> Result<(), String> {
    // Listing the skills runs this too, and two at once would write the same folders
    static INSTALLING: Mutex<()> = Mutex::new(());
    let _guard = crate::util::lock(&INSTALLING);
    let mut failed = Vec::new();
    if let Err(error) = retire_old_builtins(skills) {
        failed.push(error);
    }
    for (name, text) in BUILTIN_SKILLS {
        let bundle = builtin_bundle(name, text);
        let hash = bundle.content_hash();
        let target = skills.join(name);
        let should_install = !target.join(SKILL_FILE).is_file() || {
            let record = read_record(&target);
            record.source == Source::Nyra
                && record.edited_at.is_none()
                && record.content_hash.as_deref() != Some(hash.as_str())
        };
        if should_install {
            let record = Record {
                source: Source::Nyra,
                origin: Some(bundle.origin.clone()),
                content_hash: Some(hash),
                imported_at: Some(now_millis()),
                ..Record::default()
            };
            if let Err(error) = install(skills, &bundle, name, &record) {
                failed.push(format!("{name}: {error}"));
            }
        }
    }
    match fs::remove_file(skills.join(LEGACY_BUILTINS_FILE)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => failed.push(to_message(e)),
        _ => {}
    }
    if failed.is_empty() {
        Ok(())
    } else {
        Err(t_with(
            "native.skills.installFailed",
            &[("details", &failed.join("; "))],
        ))
    }
}

pub fn install_builtin_skills(app: &AppHandle) -> Result<(), String> {
    install_builtins_in(&skills_dir(app)?)
}
