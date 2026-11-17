mod file_commands;
mod instance;

#[cfg(target_os = "windows")]
mod windows_wheel;

use file_commands::{
    get_startup_files, open_file_dialog, open_file_paths, read_document_image, save_file_dialog,
    write_file_content, ApprovedFilePaths,
};
use instance::{set_separate_virtual_desktop_windows, take_pending_open_files, EditorOpenRequests};
use tauri::Manager;

#[tauri::command]
fn setup_editor_window_wheel(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return windows_wheel::setup_horizontal_wheel_hook(window);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let window_state_flags = tauri_plugin_window_state::StateFlags::SIZE
        | tauri_plugin_window_state::StateFlags::POSITION
        | tauri_plugin_window_state::StateFlags::MAXIMIZED
        | tauri_plugin_window_state::StateFlags::VISIBLE
        | tauri_plugin_window_state::StateFlags::FULLSCREEN;

    let builder = tauri::Builder::default();
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(
        instance::handle_second_instance,
    ));

    builder
        .manage(ApprovedFilePaths::default())
        .manage(EditorOpenRequests::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window
                    .state::<EditorOpenRequests>()
                    .remove_window(window.label());
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&["settings"])
                .with_state_flags(window_state_flags)
                .build(),
        )
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(err) = windows_wheel::setup_horizontal_wheel_hook(window) {
                        eprintln!("{err}");
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_startup_files,
            open_file_dialog,
            open_file_paths,
            save_file_dialog,
            write_file_content,
            setup_editor_window_wheel,
            read_document_image,
            take_pending_open_files,
            set_separate_virtual_desktop_windows,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
