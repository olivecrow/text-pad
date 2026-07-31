use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    env, fs,
    fs::File,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tempfile::NamedTempFile;

const MAX_FILE_SIZE_BYTES: usize = 16 * 1024 * 1024;
const MAX_FILE_LINE_COUNT: usize = 250_000;
const SUPPORTED_TEXT_FORMAT_MANIFEST: &str = include_str!("../../supported-text-formats.json");
const MAX_DIALOG_FILTER_NAME_CHARS: usize = 64;
const MAX_DIALOG_FILTERS: usize = 32;
const MAX_DIALOG_EXTENSIONS: usize = 32;

fn dialog_filter_name(provided: Option<&str>, fallback: &str) -> String {
    let provided = provided.map(str::trim).unwrap_or_default();
    if provided.is_empty()
        || provided.chars().count() > MAX_DIALOG_FILTER_NAME_CHARS
        || provided.chars().any(char::is_control)
    {
        fallback.to_string()
    } else {
        provided.to_string()
    }
}

#[derive(Debug, Deserialize)]
struct SupportedTextFormatManifest {
    formats: Vec<SupportedTextFormatEntry>,
}

#[derive(Debug, Deserialize)]
struct SupportedTextFormatEntry {
    extensions: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogFilter {
    name: String,
    extensions: Vec<String>,
}

fn is_valid_text_extension(extension: &str) -> bool {
    !extension.is_empty()
        && extension.len() <= 16
        && extension
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn supported_text_extensions() -> Result<Vec<String>, FileCommandError> {
    let manifest: SupportedTextFormatManifest =
        serde_json::from_str(SUPPORTED_TEXT_FORMAT_MANIFEST).map_err(|error| {
            FileCommandError::new(
                "format_manifest_error",
                format!("지원 파일 형식 목록을 읽을 수 없습니다: {error}"),
            )
        })?;
    let mut extensions = Vec::new();
    let mut seen = HashSet::new();

    for entry in manifest.formats {
        for extension in entry.extensions {
            let normalized = extension.trim().to_ascii_lowercase();
            if !is_valid_text_extension(&normalized) || !seen.insert(normalized.clone()) {
                return Err(FileCommandError::new(
                    "format_manifest_error",
                    format!("지원 파일 확장자 목록이 올바르지 않습니다: {extension}"),
                ));
            }
            extensions.push(normalized);
        }
    }

    if extensions.is_empty() {
        return Err(FileCommandError::new(
            "format_manifest_error",
            "지원 파일 확장자 목록이 비어 있습니다",
        ));
    }

    Ok(extensions)
}

fn sanitize_dialog_filters(filters: Vec<DialogFilter>, supported: &[String]) -> Vec<DialogFilter> {
    let supported_set: HashSet<&str> = supported.iter().map(String::as_str).collect();
    let mut sanitized = Vec::new();

    for filter in filters.into_iter().take(MAX_DIALOG_FILTERS) {
        let mut seen = HashSet::new();
        let extensions = filter
            .extensions
            .into_iter()
            .take(MAX_DIALOG_EXTENSIONS)
            .map(|extension| extension.trim().to_ascii_lowercase())
            .filter(|extension| {
                supported_set.contains(extension.as_str()) && seen.insert(extension.clone())
            })
            .collect::<Vec<_>>();
        if extensions.is_empty() {
            continue;
        }
        sanitized.push(DialogFilter {
            name: dialog_filter_name(Some(&filter.name), "Text files"),
            extensions,
        });
    }

    if sanitized.is_empty() {
        sanitized.push(DialogFilter {
            name: "Text files".to_string(),
            extensions: supported.to_vec(),
        });
    }

    sanitized
}

#[derive(Debug, Serialize)]
pub struct FileCommandError {
    pub code: &'static str,
    pub message: String,
}

impl FileCommandError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn from_io(err: io::Error) -> Self {
        Self {
            code: file_error_code(err.kind()),
            message: err.to_string(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedFile {
    pub path: String,
    pub content: String,
}

#[derive(Default)]
pub struct ApprovedFilePaths {
    paths: Mutex<HashSet<PathBuf>>,
}

impl ApprovedFilePaths {
    fn approve(&self, path: PathBuf) -> Result<(), FileCommandError> {
        let mut paths = self.paths.lock().map_err(|_| {
            FileCommandError::new("state_error", "승인된 파일 경로 상태를 사용할 수 없습니다")
        })?;
        paths.insert(path);
        Ok(())
    }

    fn resolve_approved(&self, path: &Path) -> Result<PathBuf, FileCommandError> {
        let normalized = normalize_save_path(path).map_err(|err| FileCommandError::from_io(err))?;
        let paths = self.paths.lock().map_err(|_| {
            FileCommandError::new("state_error", "승인된 파일 경로 상태를 사용할 수 없습니다")
        })?;

        if paths.contains(&normalized) {
            Ok(normalized)
        } else {
            Err(FileCommandError::new(
                "path_not_approved",
                "파일 선택창에서 승인하지 않은 경로에는 접근할 수 없습니다",
            ))
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
            "The path does not contain a file name",
        ));
    }

    match file_path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => Ok(parent),
        _ => Ok(Path::new(".")),
    }
}

fn normalize_existing_file_path(file_path: &Path) -> io::Result<PathBuf> {
    if !file_path.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "일반 파일 경로가 아닙니다",
        ));
    }

    fs::canonicalize(file_path)
}

fn normalize_save_path(file_path: &Path) -> io::Result<PathBuf> {
    if file_path.exists() {
        if !file_path.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "일반 파일 경로가 아닙니다",
            ));
        }
        return fs::canonicalize(file_path);
    }

    let parent = target_parent_dir(file_path)?;
    let normalized_parent = fs::canonicalize(parent)?;
    let file_name = file_path.file_name().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "파일 이름이 없는 경로입니다")
    })?;
    Ok(normalized_parent.join(file_name))
}

fn validate_content_limits(
    content: &[u8],
    max_bytes: usize,
    max_lines: usize,
) -> Result<(), FileCommandError> {
    if content.len() > max_bytes {
        return Err(FileCommandError::new(
            "file_too_large",
            format!(
                "파일 크기는 최대 {} MiB까지 지원합니다",
                max_bytes / (1024 * 1024)
            ),
        ));
    }

    let line_count = content
        .iter()
        .filter(|byte| **byte == b'\n')
        .count()
        .saturating_add(1);
    if line_count > max_lines {
        return Err(FileCommandError::new(
            "too_many_lines",
            format!("파일은 최대 {max_lines}줄까지 지원합니다"),
        ));
    }

    Ok(())
}

fn read_file_content_with_limits(
    file_path: &Path,
    max_bytes: usize,
    max_lines: usize,
) -> Result<String, FileCommandError> {
    let file = File::open(file_path).map_err(|err| FileCommandError::from_io(err))?;
    let metadata = file
        .metadata()
        .map_err(|err| FileCommandError::from_io(err))?;

    if metadata.len() > max_bytes as u64 {
        return Err(FileCommandError::new(
            "file_too_large",
            format!(
                "파일 크기는 최대 {} MiB까지 지원합니다",
                max_bytes / (1024 * 1024)
            ),
        ));
    }

    let mut content = Vec::with_capacity(metadata.len() as usize);
    file.take((max_bytes as u64).saturating_add(1))
        .read_to_end(&mut content)
        .map_err(|err| FileCommandError::from_io(err))?;
    validate_content_limits(&content, max_bytes, max_lines)?;

    String::from_utf8(content).map_err(|err| {
        FileCommandError::new(
            "invalid_data",
            format!("UTF-8 텍스트 파일이 아닙니다: {err}"),
        )
    })
}

fn read_file_content_from_path(file_path: &Path) -> Result<String, FileCommandError> {
    read_file_content_with_limits(file_path, MAX_FILE_SIZE_BYTES, MAX_FILE_LINE_COUNT)
}

#[cfg(target_os = "windows")]
fn replace_existing_file(temp_file: NamedTempFile, file_path: &Path) -> io::Result<()> {
    use std::{ffi::c_void, os::windows::ffi::OsStrExt, ptr};

    #[link(name = "kernel32")]
    extern "system" {
        fn ReplaceFileW(
            replaced_file_name: *const u16,
            replacement_file_name: *const u16,
            backup_file_name: *const u16,
            replace_flags: u32,
            exclude: *mut c_void,
            reserved: *mut c_void,
        ) -> i32;
    }

    fn wide_path(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    let temp_path = temp_file.into_temp_path();
    let target_wide = wide_path(file_path);
    let replacement_wide = wide_path(temp_path.as_ref());
    let replaced = unsafe {
        ReplaceFileW(
            target_wide.as_ptr(),
            replacement_wide.as_ptr(),
            ptr::null(),
            0,
            ptr::null_mut(),
            ptr::null_mut(),
        )
    };

    if replaced == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn write_file_content_to_path(file_path: &Path, content: &str) -> io::Result<()> {
    let parent_dir = target_parent_dir(file_path)?;
    let mut temp_file = NamedTempFile::new_in(parent_dir)?;

    temp_file.write_all(content.as_bytes())?;
    temp_file.as_file_mut().sync_all()?;

    #[cfg(target_os = "windows")]
    if file_path.exists() {
        return replace_existing_file(temp_file, file_path);
    }

    temp_file
        .persist(file_path)
        .map(|_| ())
        .map_err(|err| err.error)
}

fn open_file(
    file_path: &Path,
    approved_paths: &ApprovedFilePaths,
) -> Result<OpenedFile, FileCommandError> {
    let normalized = normalize_existing_file_path(file_path).map_err(FileCommandError::from_io)?;
    let content = read_file_content_from_path(&normalized)?;
    approved_paths.approve(normalized.clone())?;

    Ok(OpenedFile {
        path: normalized.to_string_lossy().into_owned(),
        content,
    })
}

#[tauri::command]
pub async fn open_file_dialog(
    app: AppHandle,
    filter_name: String,
    approved_paths: State<'_, ApprovedFilePaths>,
) -> Result<Option<OpenedFile>, FileCommandError> {
    let filter_name = dialog_filter_name(Some(&filter_name), "Text files");
    let extensions = supported_text_extensions()?;
    let extension_refs = extensions.iter().map(String::as_str).collect::<Vec<_>>();
    let selected = app
        .dialog()
        .file()
        .add_filter(filter_name, &extension_refs)
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let file_path = selected.into_path().map_err(|err| {
        FileCommandError::new(
            "invalid_path",
            format!("선택한 파일 경로가 올바르지 않습니다: {err}"),
        )
    })?;

    open_file(&file_path, &approved_paths).map(Some)
}

#[tauri::command]
pub fn get_startup_files(
    approved_paths: State<'_, ApprovedFilePaths>,
) -> Result<Vec<OpenedFile>, FileCommandError> {
    env::args_os()
        .skip(1)
        .filter_map(|arg| {
            let file_path = PathBuf::from(arg);
            file_path.is_file().then_some(file_path)
        })
        .map(|file_path| open_file(&file_path, &approved_paths))
        .collect()
}

#[tauri::command]
pub fn write_file_content(
    path: String,
    content: String,
    approved_paths: State<'_, ApprovedFilePaths>,
) -> Result<(), FileCommandError> {
    validate_content_limits(content.as_bytes(), MAX_FILE_SIZE_BYTES, MAX_FILE_LINE_COUNT)?;
    let file_path = approved_paths.resolve_approved(Path::new(&path))?;
    write_file_content_to_path(&file_path, &content).map_err(FileCommandError::from_io)
}

#[tauri::command]
pub async fn save_file_dialog(
    app: AppHandle,
    default_name: String,
    content: String,
    filters: Vec<DialogFilter>,
    approved_paths: State<'_, ApprovedFilePaths>,
) -> Result<Option<String>, FileCommandError> {
    validate_content_limits(content.as_bytes(), MAX_FILE_SIZE_BYTES, MAX_FILE_LINE_COUNT)?;

    let supported = supported_text_extensions()?;
    let filters = sanitize_dialog_filters(filters, &supported);
    let mut dialog = app.dialog().file().set_file_name(default_name);
    for filter in filters {
        let extension_refs = filter
            .extensions
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>();
        dialog = dialog.add_filter(filter.name, &extension_refs);
    }
    let selected = dialog.blocking_save_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let selected_path = selected.into_path().map_err(|err| {
        FileCommandError::new(
            "invalid_path",
            format!("선택한 파일 경로가 올바르지 않습니다: {err}"),
        )
    })?;
    let normalized =
        normalize_save_path(&selected_path).map_err(|err| FileCommandError::from_io(err))?;

    write_file_content_to_path(&normalized, &content)
        .map_err(|err| FileCommandError::from_io(err))?;
    approved_paths.approve(normalized.clone())?;

    Ok(Some(normalized.to_string_lossy().into_owned()))
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

    #[cfg(target_os = "windows")]
    fn set_acl_protection(file_path: &Path) -> io::Result<()> {
        use std::process::Command;

        let output = Command::new("icacls.exe")
            .arg(file_path)
            .arg("/inheritance:d")
            .output()?;

        if output.status.success() {
            Ok(())
        } else {
            Err(io::Error::other(format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            )))
        }
    }

    #[cfg(target_os = "windows")]
    fn is_acl_protected(file_path: &Path) -> io::Result<bool> {
        use std::process::Command;

        let output = Command::new("icacls.exe").arg(file_path).output()?;
        if !output.status.success() {
            return Err(io::Error::other(String::from_utf8_lossy(&output.stderr)));
        }

        Ok(!String::from_utf8_lossy(&output.stdout).contains("(I)"))
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

    #[cfg(target_os = "windows")]
    #[test]
    fn preserves_existing_file_acl_protection() -> io::Result<()> {
        let dir = create_test_dir("acl")?;
        let target = dir.path.join("note.txt");
        fs::write(&target, "이전 내용")?;
        set_acl_protection(&target)?;
        if !is_acl_protected(&target)? {
            return Err(io::Error::other(
                "테스트 파일의 ACL 보호를 설정하지 못했습니다",
            ));
        }

        write_file_content_to_path(&target, "바뀐 내용")?;

        assert!(is_acl_protected(&target)?);
        assert_eq!(fs::read_to_string(&target)?, "바뀐 내용");
        Ok(())
    }

    #[test]
    fn rejects_oversized_files_before_reading_all_content() -> io::Result<()> {
        let dir = create_test_dir("oversized")?;
        let target = dir.path.join("note.txt");
        fs::write(&target, "12345")?;

        let result = read_file_content_with_limits(&target, 4, 10);

        match result {
            Ok(_) => panic!("크기 제한을 넘은 파일은 열면 안 됩니다"),
            Err(err) => assert_eq!(err.code, "file_too_large"),
        }
        Ok(())
    }

    #[test]
    fn rejects_files_with_too_many_lines() -> io::Result<()> {
        let dir = create_test_dir("lines")?;
        let target = dir.path.join("note.txt");
        fs::write(&target, "1\n2\n3")?;

        let result = read_file_content_with_limits(&target, 64, 2);

        match result {
            Ok(_) => panic!("줄 수 제한을 넘은 파일은 열면 안 됩니다"),
            Err(err) => assert_eq!(err.code, "too_many_lines"),
        }
        Ok(())
    }

    #[test]
    fn supported_format_manifest_drives_dialog_extensions() -> io::Result<()> {
        let extensions =
            supported_text_extensions().map_err(|error| io::Error::other(error.message))?;

        for expected in [
            "txt", "text", "md", "markdown", "jsonl", "env", "srt", "vtt", "lrc",
        ] {
            assert!(extensions.iter().any(|extension| extension == expected));
        }
        assert_eq!(
            extensions.len(),
            extensions.iter().collect::<HashSet<_>>().len()
        );
        Ok(())
    }

    #[test]
    fn dialog_filters_drop_unknown_extensions() -> io::Result<()> {
        let supported =
            supported_text_extensions().map_err(|error| io::Error::other(error.message))?;
        let filters = sanitize_dialog_filters(
            vec![DialogFilter {
                name: "JSON Lines".to_string(),
                extensions: vec!["jsonl".to_string(), "exe".to_string(), "jsonl".to_string()],
            }],
            &supported,
        );

        assert_eq!(filters.len(), 1);
        assert_eq!(filters[0].extensions, vec!["jsonl"]);
        Ok(())
    }

    #[test]
    fn approved_path_state_rejects_unselected_sibling() -> io::Result<()> {
        let dir = create_test_dir("approved")?;
        let selected = dir.path.join("selected.txt");
        let sibling = dir.path.join("sibling.txt");
        fs::write(&selected, "선택됨")?;
        fs::write(&sibling, "선택 안 됨")?;
        let approved_paths = ApprovedFilePaths::default();
        let selected = normalize_existing_file_path(&selected)?;
        approved_paths
            .approve(selected)
            .map_err(|err| io::Error::other(err.message))?;

        let result = approved_paths.resolve_approved(&sibling);

        match result {
            Ok(_) => panic!("선택하지 않은 파일 경로를 승인하면 안 됩니다"),
            Err(err) => assert_eq!(err.code, "path_not_approved"),
        }
        Ok(())
    }
}
