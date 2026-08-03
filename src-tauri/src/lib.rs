mod file_commands;

#[cfg(target_os = "windows")]
mod windows_wheel;

use file_commands::{
    get_startup_files, open_file_dialog, open_file_paths, save_file_dialog, write_file_content,
    ApprovedFilePaths,
};

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

    tauri::Builder::default()
        .manage(ApprovedFilePaths::default())
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
                use tauri::Manager;
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
