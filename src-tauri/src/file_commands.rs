use serde::Serialize;
use std::{env, fs, io, path::Path};

#[derive(Debug, Serialize)]
pub struct FileCommandError {
    pub code: &'static str,
    pub message: String,
}

impl FileCommandError {
    fn from_io(context: &'static str, err: io::Error) -> Self {
        Self {
            code: file_error_code(err.kind()),
            message: format!("{context}: {err}"),
        }
    }
}

fn file_error_code(kind: io::ErrorKind) -> &'static str {
    match kind {
        io::ErrorKind::NotFound => "not_found",
        io::ErrorKind::PermissionDenied => "permission_denied",
        io::ErrorKind::InvalidData => "invalid_data",
        io::ErrorKind::AlreadyExists => "already_exists",
        io::ErrorKind::WriteZero => "write_failed",
        _ => "io_error",
    }
}

#[tauri::command]
pub fn read_file_content(path: String) -> Result<String, FileCommandError> {
    let file_path = Path::new(&path);
    fs::read_to_string(file_path)
        .map_err(|err| FileCommandError::from_io("파일을 읽을 수 없습니다", err))
}

#[tauri::command]
pub fn get_startup_file_paths() -> Vec<String> {
    env::args_os()
        .skip(1)
        .filter_map(|arg| {
            let file_path = Path::new(&arg);
            file_path
                .is_file()
                .then(|| file_path.to_string_lossy().into_owned())
        })
        .collect()
}

#[tauri::command]
pub fn write_file_content(path: String, content: String) -> Result<(), FileCommandError> {
    let file_path = Path::new(&path);
    fs::write(file_path, content)
        .map_err(|err| FileCommandError::from_io("파일을 저장할 수 없습니다", err))
}
