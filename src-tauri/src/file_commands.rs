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
const MAX_DIALOG_EXTENSIONS: usize = 64;

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
                (extension == "*" || supported_set.contains(extension.as_str()))
                    && seen.insert(extension.clone())
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
    pub encoding: TextEncoding,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TextEncoding {
    #[default]
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedFile {
    pub path: String,
    pub encoding: TextEncoding,
}

#[derive(Debug, PartialEq, Eq)]
struct DecodedText {
    content: String,
    encoding: TextEncoding,
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

fn line_count(content: &str) -> usize {
    let bytes = content.as_bytes();
    let mut count = 1usize;

    for (index, byte) in bytes.iter().enumerate() {
        if *byte == b'\n' || (*byte == b'\r' && bytes.get(index + 1) != Some(&b'\n')) {
            count = count.saturating_add(1);
        }
    }

    count
}

fn encoded_text_len(content: &str, encoding: TextEncoding) -> usize {
    match encoding {
        TextEncoding::Utf8 => content.len(),
        TextEncoding::Utf8Bom => content.len().saturating_add(3),
        TextEncoding::Utf16Le | TextEncoding::Utf16Be => content
            .encode_utf16()
            .count()
            .saturating_mul(2)
            .saturating_add(2),
    }
}

fn validate_text_limits(
    content: &str,
    encoding: TextEncoding,
    max_bytes: usize,
    max_lines: usize,
) -> Result<(), FileCommandError> {
    if encoded_text_len(content, encoding) > max_bytes {
        return Err(FileCommandError::new(
            "file_too_large",
            format!(
                "파일 크기는 최대 {} MiB까지 지원합니다",
                max_bytes / (1024 * 1024)
            ),
        ));
    }

    if line_count(content) > max_lines {
        return Err(FileCommandError::new(
            "too_many_lines",
            format!("파일은 최대 {max_lines}줄까지 지원합니다"),
        ));
    }

    Ok(())
}

fn decode_utf16(bytes: &[u8], little_endian: bool) -> Result<String, FileCommandError> {
    let mut chunks = bytes.chunks_exact(2);
    let units = chunks
        .by_ref()
        .map(|chunk| {
            if little_endian {
                u16::from_le_bytes([chunk[0], chunk[1]])
            } else {
                u16::from_be_bytes([chunk[0], chunk[1]])
            }
        })
        .collect::<Vec<_>>();

    if !chunks.remainder().is_empty() {
        return Err(FileCommandError::new(
            "invalid_data",
            "UTF-16 텍스트의 바이트 수가 올바르지 않습니다",
        ));
    }

    String::from_utf16(&units).map_err(|error| {
        FileCommandError::new(
            "invalid_data",
            format!("UTF-16 텍스트가 올바르지 않습니다: {error}"),
        )
    })
}

fn decode_text_bytes(bytes: Vec<u8>) -> Result<DecodedText, FileCommandError> {
    if let Some(content) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return std::str::from_utf8(content)
            .map(|content| DecodedText {
                content: content.to_owned(),
                encoding: TextEncoding::Utf8Bom,
            })
            .map_err(|error| {
                FileCommandError::new(
                    "invalid_data",
                    format!("UTF-8 BOM 텍스트가 올바르지 않습니다: {error}"),
                )
            });
    }

    if bytes.starts_with(&[0xFF, 0xFE, 0x00, 0x00]) || bytes.starts_with(&[0x00, 0x00, 0xFE, 0xFF])
    {
        return Err(FileCommandError::new(
            "invalid_data",
            "UTF-32 텍스트 인코딩은 지원하지 않습니다",
        ));
    }

    if let Some(content) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return decode_utf16(content, true).map(|content| DecodedText {
            content,
            encoding: TextEncoding::Utf16Le,
        });
    }

    if let Some(content) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return decode_utf16(content, false).map(|content| DecodedText {
            content,
            encoding: TextEncoding::Utf16Be,
        });
    }

    String::from_utf8(bytes)
        .map(|content| DecodedText {
            content,
            encoding: TextEncoding::Utf8,
        })
        .map_err(|error| {
            FileCommandError::new(
                "invalid_data",
                format!("지원하는 UTF-8 또는 BOM이 있는 UTF-16 텍스트가 아닙니다: {error}"),
            )
        })
}

fn read_file_content_with_limits(
    file_path: &Path,
    max_bytes: usize,
    max_lines: usize,
) -> Result<DecodedText, FileCommandError> {
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

    let decoded = decode_text_bytes(content)?;
    validate_text_limits(&decoded.content, decoded.encoding, max_bytes, max_lines)?;
    Ok(decoded)
}

fn read_file_content_from_path(file_path: &Path) -> Result<DecodedText, FileCommandError> {
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

fn encode_text(content: &str, encoding: TextEncoding) -> Vec<u8> {
    match encoding {
        TextEncoding::Utf8 => content.as_bytes().to_vec(),
        TextEncoding::Utf8Bom => {
            let mut bytes = Vec::with_capacity(content.len().saturating_add(3));
            bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
            bytes.extend_from_slice(content.as_bytes());
            bytes
        }
        TextEncoding::Utf16Le | TextEncoding::Utf16Be => {
            let mut bytes = Vec::with_capacity(encoded_text_len(content, encoding));
            bytes.extend_from_slice(if encoding == TextEncoding::Utf16Le {
                &[0xFF, 0xFE]
            } else {
                &[0xFE, 0xFF]
            });
            for unit in content.encode_utf16() {
                let encoded_unit = if encoding == TextEncoding::Utf16Le {
                    unit.to_le_bytes()
                } else {
                    unit.to_be_bytes()
                };
                bytes.extend_from_slice(&encoded_unit);
            }
            bytes
        }
    }
}

fn write_file_content_to_path(
    file_path: &Path,
    content: &str,
    encoding: TextEncoding,
) -> io::Result<()> {
    let parent_dir = target_parent_dir(file_path)?;
    let mut temp_file = NamedTempFile::new_in(parent_dir)?;

    temp_file.write_all(&encode_text(content, encoding))?;
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
    let decoded = read_file_content_from_path(&normalized)?;
    approved_paths.approve(normalized.clone())?;

    Ok(OpenedFile {
        path: normalized.to_string_lossy().into_owned(),
        content: decoded.content,
        encoding: decoded.encoding,
    })
}

fn open_existing_files<I>(
    file_paths: I,
    approved_paths: &ApprovedFilePaths,
) -> Result<Vec<OpenedFile>, FileCommandError>
where
    I: IntoIterator<Item = PathBuf>,
{
    file_paths
        .into_iter()
        .filter(|file_path| file_path.is_file())
        .map(|file_path| open_file(&file_path, approved_paths))
        .collect()
}

#[tauri::command]
pub async fn open_file_dialog(
    app: AppHandle,
    filters: Vec<DialogFilter>,
    approved_paths: State<'_, ApprovedFilePaths>,
) -> Result<Option<OpenedFile>, FileCommandError> {
    let supported = supported_text_extensions()?;
    let filters = sanitize_dialog_filters(filters, &supported);
    let mut dialog = app.dialog().file();
    for filter in filters {
        let extension_refs = filter
            .extensions
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>();
        dialog = dialog.add_filter(filter.name, &extension_refs);
    }
    let selected = dialog.blocking_pick_file();
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
    open_existing_files(env::args_os().skip(1).map(PathBuf::from), &approved_paths)
}

#[tauri::command]
pub fn open_file_paths(
    paths: Vec<String>,
    approved_paths: State<'_, ApprovedFilePaths>,
) -> Result<Vec<OpenedFile>, FileCommandError> {
    open_existing_files(paths.into_iter().map(PathBuf::from), &approved_paths)
}

#[tauri::command]
pub fn write_file_content(
    path: String,
    content: String,
    encoding: TextEncoding,
    approved_paths: State<'_, ApprovedFilePaths>,
) -> Result<(), FileCommandError> {
    validate_text_limits(&content, encoding, MAX_FILE_SIZE_BYTES, MAX_FILE_LINE_COUNT)?;
    let file_path = approved_paths.resolve_approved(Path::new(&path))?;
    write_file_content_to_path(&file_path, &content, encoding).map_err(FileCommandError::from_io)
}

fn default_text_encoding_for_path(file_path: &Path) -> TextEncoding {
    match file_path
        .extension()
        .and_then(|extension| extension.to_str())
    {
        Some(extension) if extension.eq_ignore_ascii_case("reg") => TextEncoding::Utf16Le,
        _ => TextEncoding::Utf8,
    }
}

#[tauri::command]
pub async fn save_file_dialog(
    app: AppHandle,
    default_name: String,
    content: String,
    encoding: Option<TextEncoding>,
    filters: Vec<DialogFilter>,
    approved_paths: State<'_, ApprovedFilePaths>,
) -> Result<Option<SavedFile>, FileCommandError> {
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
    let encoding = encoding.unwrap_or_else(|| default_text_encoding_for_path(&normalized));
    validate_text_limits(&content, encoding, MAX_FILE_SIZE_BYTES, MAX_FILE_LINE_COUNT)?;

    write_file_content_to_path(&normalized, &content, encoding)
        .map_err(|err| FileCommandError::from_io(err))?;
    approved_paths.approve(normalized.clone())?;

    Ok(Some(SavedFile {
        path: normalized.to_string_lossy().into_owned(),
        encoding,
    }))
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

        write_file_content_to_path(&target, "새 내용", TextEncoding::Utf8)?;

        assert_eq!(fs::read_to_string(&target)?, "새 내용");
        Ok(())
    }

    #[test]
    fn replaces_existing_file_content() -> io::Result<()> {
        let dir = create_test_dir("replace")?;
        let target = dir.path.join("note.txt");
        fs::write(&target, "이전 내용")?;

        write_file_content_to_path(&target, "바뀐 내용", TextEncoding::Utf8)?;

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

        write_file_content_to_path(&target, "바뀐 내용", TextEncoding::Utf8)?;

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
    fn reads_utf8_bom_without_exposing_the_marker() -> io::Result<()> {
        let dir = create_test_dir("utf8-bom")?;
        let target = dir.path.join("note.txt");
        fs::write(&target, encode_text("내용", TextEncoding::Utf8Bom))?;

        let decoded = read_file_content_from_path(&target)
            .map_err(|error| io::Error::other(error.message))?;

        assert_eq!(decoded.content, "내용");
        assert_eq!(decoded.encoding, TextEncoding::Utf8Bom);
        Ok(())
    }

    #[test]
    fn reads_and_writes_bom_marked_utf16() -> io::Result<()> {
        let dir = create_test_dir("utf16")?;

        for (name, encoding) in [
            ("little.reg", TextEncoding::Utf16Le),
            ("big.xml", TextEncoding::Utf16Be),
        ] {
            let target = dir.path.join(name);
            write_file_content_to_path(&target, "첫 줄\r\n둘째 줄", encoding)?;
            let decoded = read_file_content_from_path(&target)
                .map_err(|error| io::Error::other(error.message))?;

            assert_eq!(decoded.content, "첫 줄\r\n둘째 줄");
            assert_eq!(decoded.encoding, encoding);
        }

        Ok(())
    }

    #[test]
    fn rejects_malformed_utf16() -> io::Result<()> {
        let dir = create_test_dir("invalid-utf16")?;
        let target = dir.path.join("broken.reg");
        fs::write(&target, [0xFF, 0xFE, 0x41])?;

        let result = read_file_content_from_path(&target);

        match result {
            Ok(_) => panic!("손상된 UTF-16 파일은 열면 안 됩니다"),
            Err(error) => assert_eq!(error.code, "invalid_data"),
        }
        Ok(())
    }

    #[test]
    fn rejects_utf32_bom_instead_of_misreading_it_as_utf16() -> io::Result<()> {
        let dir = create_test_dir("utf32")?;
        let target = dir.path.join("unsupported.txt");
        fs::write(&target, [0xFF, 0xFE, 0x00, 0x00, 0x41, 0x00, 0x00, 0x00])?;

        let result = read_file_content_from_path(&target);

        match result {
            Ok(_) => panic!("UTF-32를 UTF-16으로 잘못 판별하면 안 됩니다"),
            Err(error) => assert_eq!(error.code, "invalid_data"),
        }
        Ok(())
    }

    #[test]
    fn new_registry_files_default_to_utf16_little_endian() {
        assert_eq!(
            default_text_encoding_for_path(Path::new("preferences.reg")),
            TextEncoding::Utf16Le
        );
        assert_eq!(
            default_text_encoding_for_path(Path::new("preferences.txt")),
            TextEncoding::Utf8
        );
    }

    #[test]
    fn dialog_filters_allow_explicit_all_files_wildcard() -> io::Result<()> {
        let supported =
            supported_text_extensions().map_err(|error| io::Error::other(error.message))?;
        let filters = sanitize_dialog_filters(
            vec![DialogFilter {
                name: "All files".to_string(),
                extensions: vec!["*".to_string()],
            }],
            &supported,
        );

        assert_eq!(filters.len(), 1);
        assert_eq!(filters[0].extensions, vec!["*"]);
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

    #[test]
    fn opens_dropped_files_in_order_and_ignores_directories() -> io::Result<()> {
        let dir = create_test_dir("dropped")?;
        let first = dir.path.join("first.env");
        let second = dir.path.join("second.txt");
        fs::write(&first, "FIRST=1")?;
        fs::write(&second, "두 번째")?;
        let approved_paths = ApprovedFilePaths::default();

        let opened = open_existing_files(
            vec![first.clone(), dir.path.clone(), second.clone()],
            &approved_paths,
        )
        .map_err(|err| io::Error::other(err.message))?;

        assert_eq!(opened.len(), 2);
        assert_eq!(opened[0].content, "FIRST=1");
        assert_eq!(opened[1].content, "두 번째");
        assert!(approved_paths.resolve_approved(&first).is_ok());
        assert!(approved_paths.resolve_approved(&second).is_ok());
        Ok(())
    }
}
