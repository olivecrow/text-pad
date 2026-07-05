# text-pad 백엔드 가이드

백엔드는 Rust와 Tauri 2로 구성되며, 로컬 파일 입출력과 운영체제 창 동작을 담당한다.

## 현재 진입점

- `src-tauri/src/main.rs`: 애플리케이션 실행 진입점.
- `src-tauri/src/lib.rs`: Tauri 빌더, 명령 등록, 플러그인 설정.
- `src-tauri/src/file_commands.rs`: 파일 읽기/쓰기 명령과 파일 오류 응답.
- `src-tauri/src/windows_wheel.rs`: Windows 가로 휠 처리.
- `src-tauri/capabilities/default.json`: 프론트엔드 명령 권한.
- `src-tauri/tauri.conf.json`: 창 설정과 빌드 설정.
- `src-tauri/installer.nsi`: NSIS 실행 설치 파일 템플릿.
- `src-tauri/Cargo.toml`: Rust 의존성과 Tauri 플러그인 의존성.

## Tauri 명령

- `read_file_content(path: String) -> Result<String, FileCommandError>`
  - 지정한 파일을 UTF-8 문자열로 읽는다.
  - 실패하면 파일 명령 오류인 `FileCommandError`를 반환한다.
- `get_startup_file_paths() -> Vec<String>`
  - 운영체제가 앱 실행 인자로 넘긴 값 중 실제 파일인 경로만 반환한다.
  - 파일 직접 열기나 기본 앱 연결로 실행된 경우 프론트엔드가 이 목록을 읽어 시작 탭으로 연다.
- `write_file_content(path: String, content: String) -> Result<(), FileCommandError>`
  - 지정한 파일과 같은 폴더의 임시 파일에 문자열을 먼저 쓴 뒤 대상 파일로 교체한다.
  - 실패하면 파일 명령 오류인 `FileCommandError`를 반환한다.

새 파일 입출력 기능을 추가할 때는 사용자가 대화상자로 선택했거나 운영체제가 파일 열기 의도로 넘긴 경로만 다루고, 실패를 `Result`로 반환한다.
`FileCommandError`는 `code`와 `message`를 가진다. `code`는 오류 종류를 분기하기 위한 짧은 코드이고, `message`는 사용자에게 보여줄 수 있는 설명이다.
저장은 원본 파일 손상 가능성을 줄이기 위해 직접 덮어쓰지 않고 임시 파일 기록, 디스크 동기화, 파일 교체 순서로 처리한다.

## 창과 권한

접근 제어 목록(ACL)은 프론트엔드가 호출할 수 있는 Tauri 명령을 제한하는 보안 설정이다.
콘텐츠 보안 정책(CSP)은 WebView가 불러오거나 실행할 수 있는 리소스 출처를 제한하는 보안 설정이다. 이 앱은 로컬 번들, Tauri IPC, 인라인 스타일만 허용한다.

- 설정창은 시작 성능을 위해 앱 실행 시 만들지 않는다.
- 메인 창은 빈 WebView가 먼저 보이지 않도록 `visible: false`로 시작하고, 편집기 `textarea`가 준비되면 프론트엔드가 `show()`와 `setFocus()`를 호출한다.
- 설정 버튼은 기존 `settings` 창을 찾고, 없으면 동적으로 만든 뒤 `show()`와 `setFocus()`를 호출한다.
- 설정창 닫기 요청은 창을 파괴하지 않고 `hide()`로 숨긴다.
- 따라서 `src-tauri/capabilities/default.json`에는 최소한 다음 권한이 필요하다.
  - `core:window:allow-show`
  - `core:window:allow-set-focus`
  - `core:window:allow-set-title`
  - `core:window:allow-hide`
  - `core:window:allow-destroy`
  - `core:window:allow-close`

`tauri-plugin-window-state`는 메인 창만 복원해야 하므로 `settings` 창은 denylist에 둔다.

## Windows 설치 파일

NSIS는 Windows용 실행 설치 파일을 만드는 스크립트 기반 설치 도구다.
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

- 백엔드 또는 Tauri 설정 변경 후: `npm run tauri build`
- 프론트엔드와 함께 바뀐 경우: `npm run check` 후 `npm run tauri build`
