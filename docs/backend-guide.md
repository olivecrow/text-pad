# text-pad 백엔드 가이드

백엔드는 Rust와 Tauri 2로 구성되며, 로컬 파일 입출력과 운영체제 창 동작을 담당한다.

## 현재 진입점

- `src-tauri/src/main.rs`: 애플리케이션 실행 진입점.
- `src-tauri/src/lib.rs`: Tauri 빌더, 명령 등록, 플러그인 설정.
- `supported-text-formats.json`: 프론트엔드와 Rust가 함께 읽는 제품 지원 형식·확장자·샘플 목록.
- `src-tauri/src/file_commands.rs`: 파일 읽기/쓰기 명령, 중앙 확장자 목록 기반 대화상자 필터와 파일 오류 응답.
- `src-tauri/src/windows_wheel.rs`: Windows 가로 휠 처리.
- `src-tauri/capabilities/default.json`, `src-tauri/capabilities/settings.json`: 창별 프론트엔드 명령 권한.
- `src-tauri/tauri.conf.json`: 창 설정과 빌드 설정.
- `.github/workflows/release.yml`: `main`의 버전 태그에서 서명된 Windows 릴리스와 업데이트 메타데이터를 만드는 작업.
- `src-tauri/installer.nsi`: NSIS 실행 설치 파일 템플릿.
- `src-tauri/Cargo.toml`: Rust 의존성과 Tauri 플러그인 의존성.

## Tauri 명령

- `open_file_dialog() -> Result<Option<OpenedFile>, FileCommandError>`
  - Rust가 파일 선택창을 열고 사용자가 고른 실제 파일만 읽는다.
  - 승인된 정규화 경로와 UTF-8 원문을 함께 반환한다.
- `get_startup_files() -> Result<Vec<OpenedFile>, FileCommandError>`
  - 운영체제가 앱 실행 인자로 넘긴 값 중 실제 파일만 제한 안에서 읽는다.
  - 파일 직접 열기나 기본 앱 연결로 실행된 파일을 시작 탭 데이터로 반환한다.
- `open_file_paths(paths: Vec<String>) -> Result<Vec<OpenedFile>, FileCommandError>`
  - 메인 창에 드롭된 경로 중 실제 파일만 UTF-8 크기·줄 수 제한 안에서 읽는다.
  - 읽은 정규화 경로를 승인 목록에 추가하고 드롭 순서를 유지해 탭 데이터로 반환한다.
  - `build.rs`의 앱 명령 목록에서 권한을 생성하고 메인 창의 Tauri capability에 `allow-open-file-paths`를 부여해야 하며, 검증 명령은 어느 한쪽이라도 누락되면 실패한다.
- `write_file_content(path: String, content: String) -> Result<(), FileCommandError>`
  - 앞선 열기나 저장 대화상자에서 승인한 정규화 경로만 저장한다.
  - 같은 폴더의 임시 파일에 문자열을 먼저 쓴 뒤 대상 파일로 교체한다.
- `save_file_dialog(default_name: String, content: String, filters: Vec<DialogFilter>) -> Result<Option<String>, FileCommandError>`
  - Rust가 저장 경로를 직접 선택받아 저장하고, 성공한 경로만 승인 목록에 추가한다.
  - 필터 이름의 길이와 제어 문자를 제한하고, 확장자는 `supported-text-formats.json`에 등록된 값만 허용한다.

새 파일 입출력 기능을 추가할 때는 사용자가 대화상자로 선택했거나 운영체제가 파일 열기·드롭 의도로 넘긴 경로만 다루고, 실패를 `Result`로 반환한다.
`FileCommandError`는 `code`와 `message`를 가진다. `code`는 오류 종류를 번역 테이블에 매핑하기 위한 짧은 코드이고, `message`는 운영체제나 파일 시스템에서 받은 상세 원문이다. 프론트엔드는 알려진 코드를 현재 표시 언어로 번역하고, 알 수 없는 오류에만 상세 원문을 fallback으로 사용한다.
파일 원문은 UTF-8 기준 최대 16 MiB, 250,000줄까지만 열고 저장한다. 메타데이터 확인 뒤에도 제한보다 한 바이트만 더 읽어 파일 증가 경쟁에서 무제한 할당이 일어나지 않게 한다.
열기 대화상자의 확장자, 저장 필터에 허용할 확장자, 설치 연결은 중앙 목록을 기준으로 한다. 형식을 추가할 때 Rust 상수를 따로 수정하지 않으며, 중복·누락은 `npm run validate:formats`에서 실패해야 한다.
저장은 원본 파일 손상 가능성을 줄이기 위해 직접 덮어쓰지 않고 임시 파일 기록, 디스크 동기화, 파일 교체 순서로 처리한다. Windows에서 기존 파일을 교체할 때는 `ReplaceFileW`를 사용해 원본의 DACL, 암호화 상태, 대체 데이터 스트림 같은 보안 메타데이터를 보존한다.

## 창과 권한

접근 제어 목록(ACL)은 프론트엔드가 호출할 수 있는 Tauri 명령을 제한하는 보안 설정이다.
콘텐츠 보안 정책(CSP)은 WebView가 불러오거나 실행할 수 있는 리소스 출처를 제한하는 보안 설정이다. 이 앱은 로컬 번들, Tauri IPC, 인라인 스타일만 허용한다.

- 설정창은 시작 성능을 위해 앱 실행 시 만들지 않는다.
- 메인 창은 빈 WebView가 먼저 보이지 않도록 `visible: false`로 시작하고, 편집기 `textarea`가 준비되면 프론트엔드가 `show()`와 `setFocus()`를 호출한다.
- 설정 버튼은 기존 `settings` 창을 찾고, 없으면 동적으로 만든 뒤 `show()`와 `setFocus()`를 호출한다.
- 설정창 닫기 요청은 창을 파괴하지 않고 `hide()`로 숨긴다.
- `src-tauri/capabilities/default.json`은 `main` 창만 대상으로 파일 명령, 업데이트, 재시작, URL 열기, 파일 메시지창, 창 생성과 제어 권한을 부여한다.
- 앱 전용 파일 명령은 `build.rs`의 애플리케이션 명세가 생성한 개별 허용 권한을 메인 창에만 연결한다.
- `src-tauri/capabilities/settings.json`은 `settings` 창에 이벤트 수신, 기본 창 조회, 숨기기 권한만 부여한다.
- 프론트엔드에는 파일 열기·저장 대화상자 권한을 주지 않으며, 일반 메시지 대화상자와 웹 URL 열기만 허용한다.

`tauri-plugin-window-state`는 메인 창만 복원해야 하므로 `settings` 창은 denylist에 둔다.

## 자체 업데이트

- `tauri-plugin-updater`는 GitHub Releases의 `latest.json`을 확인하고 공개키로 설치 파일 서명을 검증한다.
- `tauri-plugin-process`는 설치가 끝난 뒤 앱을 다시 시작한다.
- 프론트엔드에는 `updater:default`와 `process:allow-restart` 권한만 추가한다.
- 업데이터 요청은 Rust 플러그인이 수행하므로 WebView 콘텐츠 보안 정책에 GitHub 도메인을 추가하지 않는다.
- `createUpdaterArtifacts`는 일반 설치 파일과 함께 업데이트 번들 및 `.sig` 파일을 만든다.
- Windows 설치 방식은 사용자 입력을 최소화하는 `passive`를 사용한다.

Tauri 업데이트 서명 개인키는 저장소 밖에 두고 GitHub Actions 비밀 값으로 전달한다. 공개키만 `tauri.conf.json`에 포함한다.
개인키를 변경하면 이전 설치본이 새 업데이트를 검증하지 못하므로 키를 임의로 재생성하지 않는다.
세부 사용자 흐름과 릴리스 절차는 `docs/features/app-updates.md`를 따른다.

## Windows 설치 파일

NSIS는 Windows용 실행 설치 파일을 만드는 스크립트 기반 설치 도구다. `tauri.conf.json`의 파일 연결은 중앙 지원 목록의 모든 확장자를 `Editor` 역할로 등록한다. `src-tauri/installer.nsi`는 `RegisteredApplications`, `Capabilities\FileAssociations`, `Applications\text-pad.exe\SupportedTypes`, `OpenWithProgids`도 함께 등록하고 셸에 변경을 알린다. MSI는 `src-tauri/default-app-capabilities.wxs` 조각으로 같은 기본 앱 후보 정보를 등록한다.
Windows 8 이상에서는 설치 프로그램이 사용자의 기본 앱 선택을 강제로 바꾸지 않는다. 설치 뒤 `연결 프로그램`의 항상 사용 또는 Windows 기본 앱 설정에서 사용자가 `text-pad`를 선택하면 그 선택이 유지되어야 한다.
`src-tauri/installer.nsi`는 Tauri 2.11.2 기본 템플릿을 바탕으로 하며, 같은 버전이 이미 설치된 상태에서 사용자가 삭제를 선택하면 삭제 완료 후 설치 화면으로 돌아가지 않고 설치 프로그램을 종료한다.
업그레이드나 다운그레이드에서 "삭제 후 설치"를 선택한 경우에는 기존처럼 삭제 뒤 설치를 계속 진행한다.

## Windows 가로 휠 처리

Windows WebView2는 일부 마우스 가로 휠 입력을 브라우저 `wheel` 이벤트의 `deltaX = 0`으로 전달한다.
이를 보정하기 위해 백엔드는 `WM_MOUSEHWHEEL` 메시지를 받아 `native-horizontal-wheel` 이벤트로 프론트엔드에 전달한다.

이 코드를 수정할 때는 다음을 지킨다.

- Windows 전용 코드는 `#[cfg(target_os = "windows")]` 안에 둔다.
- 훅 설치 실패가 앱 종료로 이어지지 않게 하되, 실패한 설치 시도에서 만든 리소스는 회수한다.
- 메인 창에만 훅을 연결한다.

## Rust 기준

- 새 코드에서 `unwrap()`과 `expect()`를 사용하지 않는다.
- 기존 Tauri 실행 마지막의 `.expect("error while running tauri application")`는 생성 코드 경계에 남아 있다. 새 명령, 훅, 파일 처리 로직으로 같은 방식을 확장하지 않는다.
- 운영체제, 파일 시스템, 창 제어 실패는 `Result`나 조용한 무시 중 하나를 명확히 선택한다.
- 사용자 파일을 저장할 때는 원문 손상을 막는 방식으로 확장한다.
- 파일 명령을 늘릴 때는 사용자가 허용한 경로와 임의 경로를 구분할 수 있는 백엔드 경계를 함께 설계한다.

## 검증

- 백엔드 또는 Tauri 설정 변경 후: `.agents/skills/text-pad-signed-build/SKILL.md`에 따라 `npm run tauri:build:signed`
- 지원 형식 변경 후: `npm run validate:formats`
- 프론트엔드와 함께 바뀐 경우: `npm run check` 후 `npm run tauri:build:signed`
