//! The texts Rust shows the user (errors, the tray menu), taken from the same catalogs as the interface: one source,
//! and the catalogs' test also covers them. The frontend says which language to use on start and on every change.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::LazyLock;

use serde_json::Value;
use tauri::AppHandle;

use crate::tray;

#[derive(Clone, Copy, PartialEq)]
enum Language {
    Spanish = 0,
    English = 1,
}

/// Until the frontend says otherwise, the interface's fallback language
static LANGUAGE: AtomicU8 = AtomicU8::new(Language::English as u8);

static CATALOGS: LazyLock<[HashMap<String, String>; 2]> = LazyLock::new(|| {
    [
        texts_of(include_str!("../../src/shared/i18n/locales/es.json")),
        texts_of(include_str!("../../src/shared/i18n/locales/en.json")),
    ]
});

/// "a.b.c" → text, for every text of a catalog
fn texts_of(json: &str) -> HashMap<String, String> {
    fn walk(value: &Value, prefix: &str, texts: &mut HashMap<String, String>) {
        match value {
            Value::Object(fields) => {
                for (key, inner) in fields {
                    let path = if prefix.is_empty() {
                        key.clone()
                    } else {
                        format!("{prefix}.{key}")
                    };
                    walk(inner, &path, texts);
                }
            }
            Value::String(text) => {
                texts.insert(prefix.to_string(), text.clone());
            }
            _ => {}
        }
    }
    let mut texts = HashMap::new();
    // Both catalogs are part of the build and their test checks they are valid
    if let Ok(value) = serde_json::from_str::<Value>(json) {
        walk(&value, "", &mut texts);
    }
    texts
}

fn current() -> Language {
    if LANGUAGE.load(Ordering::Relaxed) == Language::Spanish as u8 {
        Language::Spanish
    } else {
        Language::English
    }
}

/// The text in the current language; one missing there comes in English, and a missing key shows as itself
fn lookup(key: &str) -> String {
    let catalogs = &*CATALOGS;
    catalogs[current() as usize]
        .get(key)
        .or_else(|| catalogs[Language::English as usize].get(key))
        .cloned()
        .unwrap_or_else(|| key.to_string())
}

/// For web pages and searches: the localized version in the interface's language, if the site has one
pub fn accept_language() -> &'static str {
    match current() {
        Language::Spanish => "es-ES,es;q=0.9,en;q=0.8",
        Language::English => "en-US,en;q=0.9",
    }
}

pub fn t(key: &str) -> String {
    lookup(key)
}

/// `{{name}}` takes the value given for "name"; "{{count, number}}" is i18next's number format, here the plain number
fn fill(mut text: String, values: &[(&str, &str)]) -> String {
    for (name, value) in values {
        text = text
            .replace(&format!("{{{{{name}}}}}"), value)
            .replace(&format!("{{{{{name}, number}}}}"), value);
    }
    text
}

/// With its data, as `{{name}}` in the text
pub fn t_with(key: &str, values: &[(&str, &str)]) -> String {
    fill(lookup(key), values)
}

/// Settings → General → Apariencia → Idioma, already resolved ("Sistema" gives "es" or "en"). Async, so it runs off
/// the main thread: a save rebuilding "Recientes" holds that menu while it waits for the main thread, so a command
/// there wanting the same menu would block both (tray::retitle holds no lock while it changes the menu).
#[tauri::command]
pub async fn set_language(app: AppHandle, language: String) {
    let chosen = if language == "es" {
        Language::Spanish
    } else {
        Language::English
    };
    LANGUAGE.store(chosen as u8, Ordering::Relaxed);
    tray::retitle(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fills_in_the_data() {
        let text = "{{count, number}} archivos de {{name}}".to_string();
        assert_eq!(
            fill(text, &[("count", "3"), ("name", "Marta")]),
            "3 archivos de Marta"
        );
    }

    #[test]
    fn reads_both_catalogs_and_shows_a_missing_key_as_itself() {
        for catalog in CATALOGS.iter() {
            assert!(!catalog["native.tray.open"].is_empty());
        }
        assert_ne!(
            CATALOGS[Language::Spanish as usize]["native.tray.open"],
            CATALOGS[Language::English as usize]["native.tray.open"]
        );
        assert_eq!(t("native.no.such.key"), "native.no.such.key");
    }

    #[test]
    fn every_text_rust_asks_for_is_in_both_catalogs() {
        let source_files = rust_sources(std::path::Path::new("src"));
        let catalogs = &*CATALOGS;
        for key in keys_used(&source_files) {
            for (language, catalog) in catalogs.iter().enumerate() {
                let found = catalog.contains_key(&key) || key.starts_with("native.no.");
                assert!(found, "{key} is missing in catalog {language}");
            }
        }
    }

    fn rust_sources(dir: &std::path::Path) -> Vec<String> {
        let mut texts = Vec::new();
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                texts.extend(rust_sources(&path));
            } else if path.extension().is_some_and(|e| e == "rs") {
                texts.push(std::fs::read_to_string(&path).unwrap());
            }
        }
        texts
    }

    /// The keys passed as a literal to t or t_with
    fn keys_used(sources: &[String]) -> Vec<String> {
        let mut keys = Vec::new();
        for source in sources {
            for call in ["t(\"", "t_with(\""] {
                for (start, _) in source.match_indices(call) {
                    let rest = &source[start + call.len()..];
                    if let Some(end) = rest.find('"') {
                        if rest[..end].starts_with("native.") {
                            keys.push(rest[..end].to_string());
                        }
                    }
                }
            }
        }
        keys
    }
}
