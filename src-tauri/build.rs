fn main() {
    // ScreenCaptureKit only exists from macOS 12.3: weakly linked, Nyra still starts on older systems and captures
    // the screen another way there (screen_kit.rs)
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,ScreenCaptureKit");
    }
    tauri_build::build()
}
