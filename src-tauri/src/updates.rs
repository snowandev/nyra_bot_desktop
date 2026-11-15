//! Updates are checked, downloaded and installed by the updater plugin from the interface; this only says whether
//! this copy of Nyra can replace itself.

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallKind {
    /// macOS, Windows and Linux's AppImage: the updater installs the new version
    SelfUpdating,
    /// Linux's .deb and .rpm: the system's package manager owns the files, so the user downloads the new one
    Package,
}

/// On Linux only an AppImage can be replaced in place; one runs with $APPIMAGE set to its own file
#[tauri::command]
pub fn install_kind() -> InstallKind {
    if cfg!(target_os = "linux") && std::env::var_os("APPIMAGE").is_none() {
        InstallKind::Package
    } else {
        InstallKind::SelfUpdating
    }
}
