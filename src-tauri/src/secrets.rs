//! The providers' API keys, kept only when the user asks to. They go to the system keychain (Keychain on macOS,
//! Credential Manager on Windows, Secret Service on Linux); where there is none, to a file in the app's data
//! folder that only the user can read. The frontend says which one before saving. A separate list, with no secrets,
//! says which providers have a key saved, so the keychain is read only when a key is about to be used: on macOS
//! each read can ask for permission.

use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use crate::i18n::{t, t_with};
use crate::util::{data_dir, to_message};
use keyring::Entry;
use serde::Serialize;
use tauri::AppHandle;

const SERVICE: &str = "com.snowandev.nyrabot";
const FILE_NAME: &str = "api_keys.json";
const SAVED_FILE_NAME: &str = "api_keys_saved.json";
const PROVIDER_MAX: usize = 32;

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum SecretStore {
    Keychain,
    File,
}

/// Provider ids name the keychain entry and the file's keys, so only a plain short token is accepted.
fn valid_provider(id: &str) -> Result<(), String> {
    let plain = !id.is_empty()
        && id.len() <= PROVIDER_MAX
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if plain {
        Ok(())
    } else {
        Err(t("native.secrets.invalidProvider"))
    }
}

fn entry(provider: &str) -> keyring::Result<Entry> {
    Entry::new(SERVICE, &format!("api-key:{provider}"))
}

/// On Linux the store can open without a Secret Service running; only a real read tells. Checked once per run.
fn store() -> SecretStore {
    static STORE: OnceLock<SecretStore> = OnceLock::new();
    *STORE.get_or_init(|| {
        match Entry::new(SERVICE, "probe").and_then(|probe| probe.get_password()) {
            Ok(_) | Err(keyring::Error::NoEntry) => SecretStore::Keychain,
            Err(_) => SecretStore::File,
        }
    })
}

fn keys_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(FILE_NAME))
}

fn saved_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(SAVED_FILE_NAME))
}

/// None when the list was never written: keys saved before it existed
fn read_saved(path: &Path) -> Result<Option<BTreeSet<String>>, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(serde_json::from_str(&text).unwrap_or_default())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(to_message(e)),
    }
}

fn write_saved(path: &Path, saved: &BTreeSet<String>) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(to_message)?;
    }
    let json = serde_json::to_string(saved).map_err(to_message)?;
    fs::write(path, json).map_err(to_message)
}

fn mark_saved(path: &Path, provider: &str, is_saved: bool) -> Result<(), String> {
    let mut saved = read_saved(path)?.unwrap_or_default();
    let changed = if is_saved {
        saved.insert(provider.to_string())
    } else {
        saved.remove(provider)
    };
    if changed || !path.exists() {
        write_saved(path, &saved)?;
    }
    Ok(())
}

fn read_file(path: &Path) -> Result<HashMap<String, String>, String> {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).map_err(|_| t("native.secrets.damagedFile")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(e) => Err(to_message(e)),
    }
}

/// Written whole to a temporary file that is then renamed, so a crash never leaves half a file. On Unix it is
/// created readable only by the user; on Windows the app's data folder already belongs to the user alone.
fn write_file(path: &Path, keys: &HashMap<String, String>) -> Result<(), String> {
    if keys.is_empty() {
        return match fs::remove_file(path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(to_message(e)),
            _ => Ok(()),
        };
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(to_message)?;
    }
    let json = serde_json::to_string(keys).map_err(to_message)?;
    crate::util::write_atomically(path, json.as_bytes(), None).map_err(to_message)
}

fn remove_from_file(path: &Path, provider: &str) -> Result<(), String> {
    let mut keys = read_file(path)?;
    if keys.remove(provider).is_some() {
        write_file(path, &keys)?;
    }
    Ok(())
}

fn keychain_error(error: keyring::Error) -> String {
    t_with("native.secrets.keychain", &[("error", &error.to_string())])
}

#[tauri::command]
pub async fn secret_store() -> SecretStore {
    tauri::async_runtime::spawn_blocking(store)
        .await
        .unwrap_or(SecretStore::File)
}

/// The key remembered for a provider. A keychain that can't be read right now (e.g. locked and the user cancelled)
/// just leaves it out: the user can paste it again.
fn read_key(keys_path: &Path, provider: &str) -> Result<Option<String>, String> {
    let from_keychain = match store() {
        SecretStore::Keychain => entry(provider).and_then(|e| e.get_password()).ok(),
        SecretStore::File => None,
    };
    Ok(from_keychain.or(read_file(keys_path)?.remove(provider)))
}

/// Which providers have a key saved, without reading any. Keys saved before the list existed are read once to
/// write it.
#[tauri::command]
pub async fn saved_api_keys(app: AppHandle, providers: Vec<String>) -> Result<Vec<String>, String> {
    for provider in &providers {
        valid_provider(provider)?;
    }
    let keys_path = keys_file(&app)?;
    let saved_path = saved_file(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let saved = match read_saved(&saved_path)? {
            Some(saved) => saved,
            None => {
                let mut found = BTreeSet::new();
                for provider in &providers {
                    if read_key(&keys_path, provider)?.is_some() {
                        found.insert(provider.clone());
                    }
                }
                write_saved(&saved_path, &found)?;
                found
            }
        };
        Ok(providers
            .into_iter()
            .filter(|p| saved.contains(p))
            .collect())
    })
    .await
    .map_err(to_message)?
}

#[tauri::command]
pub async fn load_api_key(app: AppHandle, provider: String) -> Result<Option<String>, String> {
    valid_provider(&provider)?;
    let keys_path = keys_file(&app)?;
    tauri::async_runtime::spawn_blocking(move || read_key(&keys_path, &provider))
        .await
        .map_err(to_message)?
}

#[tauri::command]
pub async fn save_api_key(app: AppHandle, provider: String, key: String) -> Result<(), String> {
    valid_provider(&provider)?;
    let path = keys_file(&app)?;
    let saved_path = saved_file(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let key = key.trim();
        if key.is_empty() {
            return forget(&path, &saved_path, &provider);
        }
        match store() {
            SecretStore::Keychain => {
                entry(&provider)
                    .and_then(|e| e.set_password(key))
                    .map_err(keychain_error)?;
                // A key saved before the keychain was available must not stay behind in the file
                remove_from_file(&path, &provider)?;
            }
            SecretStore::File => {
                let mut keys = read_file(&path)?;
                keys.insert(provider.clone(), key.to_string());
                write_file(&path, &keys)?;
            }
        }
        mark_saved(&saved_path, &provider, true)
    })
    .await
    .map_err(to_message)?
}

fn forget(path: &Path, saved_path: &Path, provider: &str) -> Result<(), String> {
    if store() == SecretStore::Keychain {
        match entry(provider).and_then(|e| e.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => return Err(keychain_error(error)),
        }
    }
    remove_from_file(path, provider)?;
    mark_saved(saved_path, provider, false)
}

#[tauri::command]
pub async fn forget_api_key(app: AppHandle, provider: String) -> Result<(), String> {
    valid_provider(&provider)?;
    let path = keys_file(&app)?;
    let saved_path = saved_file(&app)?;
    tauri::async_runtime::spawn_blocking(move || forget(&path, &saved_path, &provider))
        .await
        .map_err(to_message)?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(label: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("nyra-test-{}-secrets-{label}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join(FILE_NAME)
    }

    #[test]
    fn accepts_only_plain_provider_ids() {
        assert!(valid_provider("anthropic").is_ok());
        assert!(valid_provider("openai-compatible").is_ok());
        assert!(valid_provider("").is_err());
        assert!(valid_provider("../x").is_err());
        assert!(valid_provider("Anthropic").is_err());
        assert!(valid_provider(&"a".repeat(PROVIDER_MAX + 1)).is_err());
    }

    #[test]
    fn writes_reads_and_removes_keys() {
        let path = temp_file("roundtrip");
        assert!(read_file(&path).unwrap().is_empty());

        let keys = HashMap::from([
            ("anthropic".to_string(), "sk-ant-1".to_string()),
            ("ollama".to_string(), "secret".to_string()),
        ]);
        write_file(&path, &keys).unwrap();
        assert_eq!(read_file(&path).unwrap(), keys);

        remove_from_file(&path, "ollama").unwrap();
        assert_eq!(read_file(&path).unwrap().len(), 1);
        // The last key gone, the file goes too
        remove_from_file(&path, "anthropic").unwrap();
        assert!(!path.exists());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn the_file_is_readable_only_by_the_user() {
        use std::os::unix::fs::PermissionsExt;
        let path = temp_file("mode");
        write_file(
            &path,
            &HashMap::from([("anthropic".to_string(), "k".to_string())]),
        )
        .unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn the_saved_list_tracks_providers_without_their_keys() {
        let path = temp_file("saved").with_file_name(SAVED_FILE_NAME);
        assert_eq!(read_saved(&path).unwrap(), None);
        mark_saved(&path, "anthropic", true).unwrap();
        mark_saved(&path, "ollama", true).unwrap();
        mark_saved(&path, "ollama", false).unwrap();
        let saved = read_saved(&path).unwrap().unwrap();
        assert_eq!(saved, BTreeSet::from(["anthropic".to_string()]));
        assert!(!fs::read_to_string(&path).unwrap().contains("sk-"));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_damaged_file_is_an_error_not_an_empty_list() {
        let path = temp_file("damaged");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{not json").unwrap();
        assert!(read_file(&path).is_err());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
