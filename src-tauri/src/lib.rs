// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::fs;
use std::path::Path;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn read_file_content(path: String) -> Result<String, String> {
    let file_path = Path::new(&path);
    fs::read_to_string(file_path).map_err(|err| err.to_string())
}

#[tauri::command]
fn write_file_content(path: String, content: String) -> Result<(), String> {
    let file_path = Path::new(&path);
    fs::write(file_path, content).map_err(|err| err.to_string())
}

#[cfg(target_os = "windows")]
mod win_util {
    use std::ffi::c_void;
    use tauri::{WebviewWindow, Emitter};

    type HWND = *mut c_void;
    type WPARAM = usize;
    type LPARAM = isize;
    type LRESULT = isize;

    type SUBCLASSPROC = unsafe extern "system" fn(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        id_subclass: usize,
        ref_data: usize,
    ) -> LRESULT;

    #[link(name = "comctl32")]
    extern "system" {
        fn SetWindowSubclass(
            hWnd: HWND,
            pfnSubclass: Option<SUBCLASSPROC>,
            uIdSubclass: usize,
            dwRefData: usize,
        ) -> i32;

        fn DefSubclassProc(
            hWnd: HWND,
            uMsg: u32,
            wParam: WPARAM,
            lParam: LPARAM,
        ) -> LRESULT;
    }

    const WM_MOUSEHWHEEL: u32 = 0x020E;

    struct SubclassData {
        window: WebviewWindow,
    }

    unsafe extern "system" fn window_subclass_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id_subclass: usize,
        ref_data: usize,
    ) -> LRESULT {
        if msg == WM_MOUSEHWHEEL {
            // wparam의 상위 16비트에 wheel delta가 들어있음
            let delta = (wparam >> 16) as i16;
            
            // ref_data에서 SubclassData 복원
            let data_ptr = ref_data as *const SubclassData;
            if !data_ptr.is_null() {
                let data = &*data_ptr;
                // 프론트엔드로 가로 휠 스크롤 델타 전송
                let _ = data.window.emit("native-horizontal-wheel", delta);
            }
            
            // WebView2가 이 가로 휠 메시지를 삼켜 deltaX=0으로 만드는 오동작 방지를 위해
            // 메시지를 직접 가로채 처리했으므로 0을 즉시 리턴함.
            return 0;
        }

        DefSubclassProc(hwnd, msg, wparam, lparam)
    }

    pub fn setup_horizontal_wheel_hook(window: WebviewWindow) {
        unsafe {
            if let Ok(hwnd) = window.hwnd() {
                let hwnd_ptr = hwnd.0 as HWND;
                
                let data = Box::new(SubclassData { window });
                let ref_data = Box::into_raw(data) as usize;
                
                SetWindowSubclass(hwnd_ptr, Some(window_subclass_proc), 1001, ref_data);
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().with_denylist(&["settings"]).build())
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    win_util::setup_horizontal_wheel_hook(window);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, read_file_content, write_file_content])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
