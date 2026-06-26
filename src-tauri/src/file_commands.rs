use serde::Serialize;
use std::{
    env, fs,
    io::{self, Write},
    path::Path,
};
use tempfile::NamedTempFile;

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
        io::ErrorKind::InvalidInput => "invalid_path",
        io::ErrorKind::InvalidData => "invalid_data",
        io::ErrorKind::AlreadyExists => "already_exists",
        io::ErrorKind::WriteZero => "write_failed",
        _ => "io_error",
    }
}

fn target_parent_dir(file_path: &Path) -> io::Result<&Path> {
    if file_path.file_name().is_none() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "파일 이름이 없는 경로입니다",
        ));
    }

    match file_path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => Ok(parent),
        _ => Ok(Path::new(".")),
    }
}

fn write_file_content_to_path(file_path: &Path, content: &str) -> io::Result<()> {
    let parent_dir = target_parent_dir(file_path)?;
    let mut temp_file = NamedTempFile::new_in(parent_dir)?;

    temp_file.write_all(content.as_bytes())?;
    temp_file.as_file_mut().sync_all()?;
    temp_file
        .persist(file_path)
        .map(|_| ())
        .map_err(|err| err.error)
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
    write_file_content_to_path(file_path, &content)
        .map_err(|err| FileCommandError::from_io("파일을 저장할 수 없습니다", err))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    struct TestDir {
        path: PathBuf,
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn create_test_dir(name: &str) -> io::Result<TestDir> {
        let unique = match SystemTime::now().duration_since(UNIX_EPOCH) {
            Ok(duration) => duration.as_nanos(),
            Err(_) => 0,
        };
        let mut path = env::temp_dir();
        path.push(format!(
            "text-pad-file-commands-{name}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir(&path)?;
        Ok(TestDir { path })
    }

    #[test]
    fn writes_new_file_content() -> io::Result<()> {
        let dir = create_test_dir("new")?;
        let target = dir.path.join("note.txt");

        write_file_content_to_path(&target, "새 내용")?;

        assert_eq!(fs::read_to_string(&target)?, "새 내용");
        Ok(())
    }

    #[test]
    fn replaces_existing_file_content() -> io::Result<()> {
        let dir = create_test_dir("replace")?;
        let target = dir.path.join("note.txt");
        fs::write(&target, "이전 내용")?;

        write_file_content_to_path(&target, "바뀐 내용")?;

        assert_eq!(fs::read_to_string(&target)?, "바뀐 내용");
        Ok(())
    }

    #[test]
    fn rejects_paths_without_file_name() {
        let result = write_file_content(String::new(), "내용".to_string());

        match result {
            Ok(()) => panic!("파일 이름 없는 경로는 저장하면 안 됩니다"),
            Err(err) => assert_eq!(err.code, "invalid_path"),
        }
    }
}
