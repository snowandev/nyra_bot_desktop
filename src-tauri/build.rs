fn main() {
    // ScreenCaptureKit only exists from macOS 12.3: weakly linked, Nyra still starts on older systems and captures
    // the screen another way there (screen_kit.rs)
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,ScreenCaptureKit");
        // Taps of the computer's sound only exist from macOS 14.2: weakly linked too, Nyra starts on older systems and
        // records only the microphone there (audio_devices.rs)
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,CoreAudio");
    }
    tauri_build::build()
}
