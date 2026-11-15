//! Keeps the app's window on the app. A link or script that tries to load another page would replace the
//! whole interface (and could show a convincing fake one), so any navigation away is refused; external links
//! are opened in the system browser by the frontend instead.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Runtime, Url};

/// Where the app itself is served from: the custom protocol in production (its form differs per system)
/// and Vite's dev server while developing.
fn is_app_url(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => match url.host_str() {
            Some("tauri.localhost") => true,
            Some("localhost") => cfg!(debug_assertions) && url.port() == Some(1420),
            _ => false,
        },
        // The app loads data and blob URLs as content (images, PDFs), never as the window's page: a link to one could
        // put a fake interface in its place, so navigating to them is refused
        "about" => url.as_str() == "about:blank",
        _ => false,
    }
}

pub fn guard<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("navigation-guard")
        .on_navigation(|_, url| is_app_url(url))
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(url: &str) -> bool {
        is_app_url(&Url::parse(url).expect("valid test URL"))
    }

    #[test]
    fn allows_the_app_itself() {
        assert!(allowed("tauri://localhost/index.html"));
        assert!(allowed("http://tauri.localhost/"));
        assert!(allowed("https://tauri.localhost/"));
        assert!(allowed("about:blank"));
    }

    #[test]
    fn refuses_other_sites() {
        assert!(!allowed("https://example.com/"));
        assert!(!allowed("http://localhost:11434/"));
        assert!(!allowed("https://tauri.localhost.evil.com/"));
        assert!(!allowed("file:///etc/passwd"));
        assert!(!allowed("javascript:alert(1)"));
        assert!(!allowed("data:text/html,<h1>Nyra</h1>"));
        assert!(!allowed(
            "blob:tauri://localhost/1b4f0e98-5e2c-4d6a-9c55-3d0b7a8e2f11"
        ));
        assert!(!allowed("about:srcdoc"));
    }
}
