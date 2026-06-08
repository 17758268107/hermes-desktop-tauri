fn main() {
    // Re-run tauri-build (and the procedural `tauri::generate_context!` macro
    // that embeds the frontend bundle) whenever the embedded assets change.
    // Without this, cargo's incremental builder can't see updates to
    // `dist/client/**` and the embedded `hermes-workspace.exe` keeps shipping
    // stale JS/CSS — see incident 2026-06-08 where the dist was updated but
    // the release binary didn't pick it up.
    println!("cargo:rerun-if-changed=../dist/client/index.html");
    println!("cargo:rerun-if-changed=../dist/client/assets");
    println!("cargo:rerun-if-changed=../dist/client/sw.js");
    println!("cargo:rerun-if-changed=../dist/client/manifest.json");
    tauri_build::build()
}
