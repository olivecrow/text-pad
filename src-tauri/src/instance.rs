use crate::file_commands::{open_existing_files, ApprovedFilePaths, FileCommandError, OpenedFile};
use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

pub const OPEN_FILES_REQUESTED_EVENT: &str = "text-pad-open-files-requested";
const MAX_PENDING_OPEN_REQUESTS: usize = 64;
const MAX_FILES_PER_OPEN_REQUEST: usize = 128;

#[derive(Debug)]
struct PendingOpenRequest {
    target_window_label: String,
    paths: Vec<PathBuf>,
}

#[derive(Default)]
pub struct PendingOpenFiles {
    requests: Mutex<VecDeque<PendingOpenRequest>>,
}

impl PendingOpenFiles {
    fn enqueue(&self, target_window_label: String, paths: Vec<PathBuf>) {
        if paths.is_empty() {
            return;
        }

        let Ok(mut requests) = self.requests.lock() else {
            return;
        };
        if requests.len() >= MAX_PENDING_OPEN_REQUESTS {
            requests.pop_front();
        }
        requests.push_back(PendingOpenRequest {
            target_window_label,
            paths,
        });
    }

    fn take_for_window(&self, window_label: &str) -> Result<Vec<PathBuf>, FileCommandError> {
        let mut requests = self.requests.lock().map_err(|_| {
            FileCommandError::new(
                "state_unavailable",
                "대기 중인 파일 열기 요청을 읽을 수 없습니다",
            )
        })?;
        let mut matching_paths = Vec::new();
        let mut remaining = VecDeque::with_capacity(requests.len());

        while let Some(request) = requests.pop_front() {
            if request.target_window_label == window_label {
                matching_paths.extend(request.paths);
            } else {
                remaining.push_back(request);
            }
        }
        *requests = remaining;
        Ok(matching_paths)
    }
}

fn resolve_instance_file_paths(args: Vec<String>, cwd: &str) -> Vec<PathBuf> {
    let cwd = Path::new(cwd);
    args.into_iter()
        .skip(1)
        .take(MAX_FILES_PER_OPEN_REQUEST)
        .map(PathBuf::from)
        .map(|path| {
            if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            }
        })
        .filter(|path| path.is_file())
        .collect()
}

fn select_target_editor_window(app: &AppHandle) -> Option<WebviewWindow> {
    let mut editor_windows = app
        .webview_windows()
        .into_values()
        .filter(|window| window.label() == "main" || window.label().starts_with("editor-"))
        .collect::<Vec<_>>();
    editor_windows.sort_by(|left, right| left.label().cmp(right.label()));

    editor_windows
        .iter()
        .find(|window| window.is_focused().unwrap_or(false))
        .cloned()
        .or_else(|| {
            editor_windows
                .iter()
                .find(|window| window.label() == "main")
                .cloned()
        })
        .or_else(|| editor_windows.into_iter().next())
}

pub fn handle_second_instance(app: &AppHandle, args: Vec<String>, cwd: String) {
    let Some(target_window) = select_target_editor_window(app) else {
        return;
    };
    let target_window_label = target_window.label().to_string();
    let paths = resolve_instance_file_paths(args, &cwd);

    if !paths.is_empty() {
        app.state::<PendingOpenFiles>()
            .enqueue(target_window_label.clone(), paths);
        let _ = app.emit_to(&target_window_label, OPEN_FILES_REQUESTED_EVENT, ());
    }

    let _ = target_window.show();
    let _ = target_window.unminimize();
    let _ = target_window.set_focus();
}

#[tauri::command]
pub fn take_pending_open_files(
    window: WebviewWindow,
    pending_open_files: State<'_, PendingOpenFiles>,
    approved_paths: State<'_, ApprovedFilePaths>,
) -> Result<Vec<OpenedFile>, FileCommandError> {
    let paths = pending_open_files.take_for_window(window.label())?;
    open_existing_files(paths, &approved_paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, io};

    #[test]
    fn resolves_relative_second_instance_files_from_its_working_directory() -> io::Result<()> {
        let test_dir = tempfile::tempdir()?;
        let relative_file = test_dir.path().join("relative.txt");
        let absolute_file = test_dir.path().join("absolute.txt");
        fs::write(&relative_file, "relative")?;
        fs::write(&absolute_file, "absolute")?;

        let resolved = resolve_instance_file_paths(
            vec![
                "text-pad.exe".to_string(),
                "relative.txt".to_string(),
                absolute_file.to_string_lossy().into_owned(),
                "missing.txt".to_string(),
            ],
            &test_dir.path().to_string_lossy(),
        );

        assert_eq!(resolved, vec![relative_file, absolute_file]);
        Ok(())
    }

    #[test]
    fn pending_requests_are_drained_only_by_the_target_window() {
        let pending = PendingOpenFiles::default();
        pending.enqueue("main".to_string(), vec![PathBuf::from("main.txt")]);
        pending.enqueue(
            "editor-two".to_string(),
            vec![PathBuf::from("detached.txt")],
        );

        assert_eq!(
            pending.take_for_window("editor-two").unwrap_or_default(),
            vec![PathBuf::from("detached.txt")]
        );
        assert_eq!(
            pending.take_for_window("main").unwrap_or_default(),
            vec![PathBuf::from("main.txt")]
        );
    }
}
