fn main() {
    println!("cargo:rerun-if-changed=icons/icon.ico");
    let app_manifest = tauri_build::AppManifest::new().commands(&[
        "get_startup_files",
        "open_file_dialog",
        "open_file_paths",
        "save_file_dialog",
        "write_file_content",
    ]);
    let attributes = tauri_build::Attributes::new().app_manifest(app_manifest);

    if let Err(error) = tauri_build::try_build(attributes) {
        eprintln!("Tauri 빌드 설정을 생성할 수 없습니다: {error:#}");
        std::process::exit(1);
    }
}
