use crate::file_commands::{open_file, ApprovedFilePaths, FileCommandError, OpenedFile};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

const OPEN_FILES_REQUESTED: &str = "text-pad-open-files-requested";

pub struct EditorOpenRequests {
    windows: Mutex<HashMap<String, WindowFiles>>,
    separate_virtual_desktop_windows: AtomicBool,
    #[cfg(windows)]
    routing: Mutex<u64>,
}

impl Default for EditorOpenRequests {
    fn default() -> Self {
        Self {
            windows: Mutex::default(),
            separate_virtual_desktop_windows: AtomicBool::new(true),
            #[cfg(windows)]
            routing: Mutex::default(),
        }
    }
}

#[derive(Default)]
struct WindowFiles {
    open: HashSet<String>,
    pending: Vec<PathBuf>,
    opening: HashSet<String>,
}

impl WindowFiles {
    fn contains(&self, key: &str) -> bool {
        self.open.contains(key)
            || self.opening.contains(key)
            || self.pending.iter().any(|path| path_key(path) == key)
    }
}

impl EditorOpenRequests {
    pub fn remove_window(&self, label: &str) {
        if let Ok(mut windows) = self.windows.lock() {
            windows.remove(label);
        }
    }

    fn owner<'a>(&self, windows: &'a [WebviewWindow], key: &str) -> Option<&'a WebviewWindow> {
        let files = self.windows.lock().ok()?;
        windows.iter().find(|window| {
            files
                .get(window.label())
                .is_some_and(|files| files.contains(key))
        })
    }

    fn enqueue(&self, label: &str, path: PathBuf) -> bool {
        let Ok(mut windows) = self.windows.lock() else {
            return false;
        };
        let pending = &mut windows.entry(label.to_string()).or_default().pending;
        let key = path_key(&path);
        if !pending.iter().any(|queued| path_key(queued) == key) {
            pending.push(path);
        }
        true
    }

    fn take(&self, label: &str, open: &HashSet<String>) -> Result<Vec<PathBuf>, FileCommandError> {
        let mut windows = self.windows.lock().map_err(|_| {
            FileCommandError::new("state_error", "대기 중인 파일 열기 요청을 읽을 수 없습니다")
        })?;
        let files = windows.entry(label.to_string()).or_default();
        files.open.clone_from(open);
        let pending = std::mem::take(&mut files.pending);
        // 받은 요청은 프론트엔드가 다음 실제 탭 목록을 보낼 때까지 이 창에 속한다.
        files.opening = pending.iter().map(|path| path_key(path)).collect();
        Ok(pending)
    }
}

fn path_key(path: &Path) -> String {
    #[cfg(windows)]
    {
        let path = path.to_string_lossy().replace('/', "\\").to_lowercase();
        if let Some(unc) = path.strip_prefix(r"\\?\unc\") {
            return format!(r"\\{unc}");
        }
        path.strip_prefix(r"\\?\").unwrap_or(&path).to_string()
    }
    #[cfg(not(windows))]
    path.to_string_lossy().into_owned()
}

fn editor_windows(app: &AppHandle, separate_desktops: bool) -> Vec<WebviewWindow> {
    let mut windows = app
        .webview_windows()
        .into_values()
        .filter(|window| window.label() == "main" || window.label().starts_with("editor-"))
        .collect::<Vec<_>>();
    #[cfg(windows)]
    let current = windows_desktop::current_window_labels(&windows);
    #[cfg(windows)]
    if separate_desktops {
        windows.retain(|window| current.contains(window.label()));
    }
    #[cfg(not(windows))]
    let _ = separate_desktops;

    windows.sort_by_cached_key(|window| {
        #[cfg(windows)]
        let other_desktop = !current.contains(window.label());
        #[cfg(not(windows))]
        let other_desktop = false;
        (
            other_desktop,
            !window.is_focused().unwrap_or(false),
            window.label() != "main",
            window.label().to_string(),
        )
    });
    windows
}

fn notify(window: &WebviewWindow) {
    let _ = window.emit_to(window.label(), OPEN_FILES_REQUESTED, ());
}

fn focus(window: &WebviewWindow) {
    // 시작 중인 창은 파일을 받은 뒤 화면을 표시한다.
    if window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn focus_open_target(
    window: &WebviewWindow,
    separate_desktops: bool,
    source: Option<&WebviewWindow>,
) {
    #[cfg(windows)]
    if !separate_desktops {
        windows_desktop::bring_to_current_desktop(window, source);
    }
    #[cfg(not(windows))]
    let _ = (separate_desktops, source);
    focus(window);
}

pub fn reuse_open_file(app: &AppHandle, source: &WebviewWindow, path: &Path) -> bool {
    if source.label() == "settings" {
        return false;
    }
    let requests = app.state::<EditorOpenRequests>();
    let separate_desktops = requests
        .separate_virtual_desktop_windows
        .load(Ordering::Relaxed);
    let windows = editor_windows(app, separate_desktops);
    let Some(window) = requests.owner(&windows, &path_key(path)) else {
        return false;
    };
    if window.label() == source.label() {
        return false;
    }
    if !requests.enqueue(window.label(), path.to_path_buf()) {
        return false;
    }
    notify(window);
    focus_open_target(window, separate_desktops, Some(source));
    true
}

#[cfg(windows)]
pub fn handle_second_instance(app: &AppHandle, args: Vec<String>, cwd: String) {
    let app = app.clone();
    // Windows의 메시지 수신기 밖에서 새 창 생성을 요청해야 메인 스레드가 응답할 수 있다.
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = route_launch(&app, args, &cwd) {
            eprintln!("파일 열기 요청을 편집기 창으로 전달하지 못했습니다: {error}");
        }
    });
}

#[cfg(windows)]
fn route_launch(app: &AppHandle, args: Vec<String>, cwd: &str) -> Result<(), String> {
    let paths = args
        .into_iter()
        .skip(1)
        .map(|arg| Path::new(cwd).join(arg))
        .filter_map(|path| crate::file_commands::normalize_existing_file_path(&path).ok());
    let requests = app.state::<EditorOpenRequests>();
    let mut serial = requests.routing.lock().map_err(|err| err.to_string())?;
    let separate_desktops = requests
        .separate_virtual_desktop_windows
        .load(Ordering::Relaxed);
    let mut windows = editor_windows(app, separate_desktops);
    if windows.is_empty() {
        let mut config = app
            .config()
            .app
            .windows
            .iter()
            .find(|config| config.label == "main")
            .ok_or("메인 편집기 창 설정을 찾을 수 없습니다")?
            .clone();
        *serial += 1;
        config.label = format!("editor-launch-{serial}");
        windows.push(
            tauri::WebviewWindowBuilder::from_config(app, &config)
                .and_then(|builder| builder.build())
                .map_err(|err| err.to_string())?,
        );
    }

    let preferred = &windows[0];
    let mut last = preferred;
    let mut notified = HashSet::new();
    for path in paths {
        last = requests
            .owner(&windows, &path_key(&path))
            .unwrap_or(preferred);
        if requests.enqueue(last.label(), path) {
            notified.insert(last.label());
        }
    }
    for window in windows
        .iter()
        .filter(|window| notified.contains(window.label()))
    {
        notify(window);
    }
    focus_open_target(last, separate_desktops, None);
    Ok(())
}

#[tauri::command]
pub fn set_separate_virtual_desktop_windows(
    enabled: bool,
    requests: State<'_, EditorOpenRequests>,
) {
    requests
        .separate_virtual_desktop_windows
        .store(enabled, Ordering::Relaxed);
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileOpenRequest {
    Activate { path: String },
    Open { file: OpenedFile },
    Error { error: FileCommandError },
}

#[tauri::command]
pub async fn take_pending_open_files(
    window: WebviewWindow,
    paths: Vec<String>,
    requests: State<'_, EditorOpenRequests>,
    approved_paths: State<'_, ApprovedFilePaths>,
) -> Result<Vec<FileOpenRequest>, FileCommandError> {
    let open = paths
        .iter()
        .map(|path| path_key(Path::new(path)))
        .collect::<HashSet<_>>();
    let pending = requests.take(window.label(), &open)?;

    Ok(pending
        .into_iter()
        .map(|path| {
            if open.contains(&path_key(&path)) {
                FileOpenRequest::Activate {
                    path: path.to_string_lossy().into_owned(),
                }
            } else {
                match open_file(&path, &approved_paths) {
                    Ok(file) => FileOpenRequest::Open { file },
                    Err(error) => FileOpenRequest::Error { error },
                }
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_requests_stay_with_the_target_until_the_tab_list_is_updated(
    ) -> Result<(), FileCommandError> {
        let requests = EditorOpenRequests::default();
        let first = PathBuf::from("first.txt");
        let second = PathBuf::from("second.txt");
        let key = path_key(&first);
        let empty = HashSet::new();
        let owns_first = || {
            requests.windows.lock().ok().is_some_and(|windows| {
                windows
                    .get("main")
                    .is_some_and(|files| files.contains(&key))
            })
        };

        assert!(requests.enqueue("main", first.clone()));
        assert!(requests.enqueue("main", first.clone()));
        assert!(requests.enqueue("main", second.clone()));
        assert!(requests.take("editor-other", &empty)?.is_empty());
        assert_eq!(requests.take("main", &empty)?, vec![first, second]);
        assert!(owns_first());
        assert!(requests
            .take("main", &HashSet::from([key.clone()]))?
            .is_empty());
        assert!(owns_first());
        assert!(requests.take("main", &empty)?.is_empty());
        assert!(!owns_first());
        Ok(())
    }

    #[cfg(windows)]
    #[test]
    fn windows_path_keys_match_aliases_used_by_editor_tabs() {
        assert_eq!(
            path_key(Path::new(r"\\?\C:\Docs\NOTE.txt")),
            path_key(Path::new("c:/docs/note.txt"))
        );
        assert_eq!(
            path_key(Path::new(r"\\?\UNC\SERVER\Share\NOTE.txt")),
            path_key(Path::new(r"\\server\share\note.txt"))
        );
    }
}

#[cfg(windows)]
mod windows_desktop {
    use std::collections::HashSet;
    use tauri::WebviewWindow;
    use windows::core::{BOOL, GUID};
    use windows::Win32::{
        Foundation::{HWND, LPARAM, RPC_E_CHANGED_MODE},
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED,
        },
        UI::{
            Shell::{IVirtualDesktopManager, VirtualDesktopManager},
            WindowsAndMessaging::{EnumWindows, GetForegroundWindow, IsWindowVisible},
        },
    };

    fn with_desktop_manager<T>(action: impl FnOnce(&IVirtualDesktopManager) -> T) -> Option<T> {
        let apartment = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        if apartment.is_err() && apartment != RPC_E_CHANGED_MODE {
            return None;
        }

        let desktop: windows::core::Result<IVirtualDesktopManager> =
            unsafe { CoCreateInstance(&VirtualDesktopManager, None, CLSCTX_INPROC_SERVER) };
        let result = desktop.ok().map(|manager| action(&manager));
        if apartment.is_ok() {
            unsafe { CoUninitialize() };
        }
        result
    }

    pub fn current_window_labels(windows: &[WebviewWindow]) -> HashSet<String> {
        with_desktop_manager(|desktop| {
            windows
                .iter()
                .filter(|window| {
                    window.hwnd().is_ok_and(|hwnd| {
                        unsafe { desktop.IsWindowOnCurrentVirtualDesktop(hwnd) }
                            .is_ok_and(|current| current.as_bool())
                    })
                })
                .map(|window| window.label().to_string())
                .collect()
        })
        .unwrap_or_default()
    }

    pub fn bring_to_current_desktop(window: &WebviewWindow, source: Option<&WebviewWindow>) {
        let Ok(hwnd) = window.hwnd() else {
            return;
        };
        with_desktop_manager(|desktop| {
            if !unsafe { desktop.IsWindowOnCurrentVirtualDesktop(hwnd) }
                .is_ok_and(|current| !current.as_bool())
            {
                return;
            }
            let source = source.and_then(|window| window.hwnd().ok());
            let foreground = unsafe { GetForegroundWindow() };
            let target = source
                .into_iter()
                .chain([foreground])
                .find_map(|reference| current_desktop_id(desktop, reference))
                .or_else(|| {
                    // 바탕 화면이나 작업 표시줄에 초점이 있으면 다른 보이는 창을 기준으로 삼는다.
                    let mut search = DesktopSearch {
                        desktop,
                        found: None,
                    };
                    let context = LPARAM(&mut search as *mut DesktopSearch<'_> as isize);
                    // EnumWindows는 콜백 실행을 마친 뒤 반환하므로 스택 참조가 유지된다.
                    let _ = unsafe { EnumWindows(Some(find_current_desktop), context) };
                    search.found
                });
            if let Some(target) = target {
                let _ = unsafe { desktop.MoveWindowToDesktop(hwnd, &target) };
            }
        });
    }

    fn current_desktop_id(desktop: &IVirtualDesktopManager, reference: HWND) -> Option<GUID> {
        if !unsafe { desktop.IsWindowOnCurrentVirtualDesktop(reference) }
            .is_ok_and(|current| current.as_bool())
        {
            return None;
        }
        unsafe { desktop.GetWindowDesktopId(reference) }
            .ok()
            .filter(|id| *id != GUID::zeroed())
    }

    struct DesktopSearch<'a> {
        desktop: &'a IVirtualDesktopManager,
        found: Option<GUID>,
    }

    unsafe extern "system" fn find_current_desktop(window: HWND, context: LPARAM) -> BOOL {
        let search = unsafe { &mut *(context.0 as *mut DesktopSearch<'_>) };
        if unsafe { IsWindowVisible(window) }.as_bool() {
            search.found = current_desktop_id(search.desktop, window);
        }
        BOOL::from(search.found.is_none())
    }
}
