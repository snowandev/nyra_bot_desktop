//! What the welcome needs to know about this computer to recommend a model that runs well on it

/// The computer's memory in bytes, or None when the system won't say
#[tauri::command]
pub async fn system_memory() -> Option<u64> {
    // A program is started to ask (PowerShell on Windows takes a second or two): off the async threads
    tauri::async_runtime::spawn_blocking(total_memory)
        .await
        .ok()
        .flatten()
}

#[cfg(target_os = "macos")]
fn total_memory() -> Option<u64> {
    let output = std::process::Command::new("/usr/sbin/sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .ok()?;
    String::from_utf8_lossy(&output.stdout).trim().parse().ok()
}

#[cfg(target_os = "linux")]
fn total_memory() -> Option<u64> {
    meminfo_total(&std::fs::read_to_string("/proc/meminfo").ok()?)
}

// Through PowerShell rather than the system's API, the same way on every Windows version Nyra supports
#[cfg(windows)]
fn total_memory() -> Option<u64> {
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory",
        ])
        .creation_flags(crate::util::CREATE_NO_WINDOW)
        .output()
        .ok()?;
    String::from_utf8_lossy(&output.stdout).trim().parse().ok()
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn total_memory() -> Option<u64> {
    None
}

/// "MemTotal:       16318332 kB" → bytes
#[cfg(any(target_os = "linux", test))]
fn meminfo_total(meminfo: &str) -> Option<u64> {
    let line = meminfo.lines().find(|line| line.starts_with("MemTotal:"))?;
    let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kb * 1024)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_total_from_meminfo() {
        let meminfo = "MemTotal:       16318332 kB\nMemFree:         1234567 kB\n";
        assert_eq!(meminfo_total(meminfo), Some(16_318_332 * 1024));
        assert_eq!(meminfo_total("MemFree: 1 kB"), None);
    }

    #[test]
    fn knows_this_computers_memory() {
        assert!(total_memory().is_some_and(|bytes| bytes > 1 << 30));
    }
}
