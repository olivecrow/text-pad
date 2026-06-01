# text-pad 백엔드 가이드

백엔드는 Rust와 Tauri 2로 구성되며, 로컬 파일 입출력과 운영체제 창 동작을 담당한다.

## 현재 진입점

- `src-tauri/src/main.rs`: 애플리케이션 실행 진입점.
- `src-tauri/src/lib.rs`: Tauri 빌더, 명령 등록, 플러그인 설정, Windows 가로 휠 처리.
- `src-tauri/capabilities/default.json`: 프론트엔드 명령 권한.
- `src-tauri/tauri.conf.json`: 창 설정과 빌드 설정.

## Tauri 명령

- `read_file_content(path: String) -> Result<String, String>`
  - 지정한 파일을 UTF-8 문자열로 읽는다.
  - 실패하면 에러 문자열을 반환한다.
- `write_file_content(path: String, content: String) -> Result<(), String>`
  - 지정한 파일에 문자열을 저장한다.
  - 실패하면 에러 문자열을 반환한다.

새 파일 입출력 기능을 추가할 때는 사용자가 선택한 경로만 다루고, 실패를 `Result`로 반환한다.

## 창과 권한

접근 제어 목록(ACL)은 프론트엔드가 호출할 수 있는 Tauri 명령을 제한하는 보안 설정이다.

- 설정창은 `tauri.conf.json`에서 `label: "settings"`와 `visible: false`로 사전 생성한다.
- 설정 버튼은 기존 `settings` 창을 찾아 `show()`와 `setFocus()`를 호출한다.
- 설정창 닫기 요청은 창을 파괴하지 않고 `hide()`로 숨긴다.
- 따라서 `src-tauri/capabilities/default.json`에는 최소한 다음 권한이 필요하다.
  - `core:window:allow-show`
  - `core:window:allow-set-focus`
  - `core:window:allow-hide`
  - `core:window:allow-destroy`
  - `core:window:allow-close`

`tauri-plugin-window-state`는 메인 창만 복원해야 하므로 `settings` 창은 denylist에 둔다.

## Windows 가로 휠 처리

Windows WebView2는 일부 마우스 가로 휠 입력을 브라우저 `wheel` 이벤트의 `deltaX = 0`으로 전달한다.
이를 보정하기 위해 백엔드는 `WM_MOUSEHWHEEL` 메시지를 받아 `native-horizontal-wheel` 이벤트로 프론트엔드에 전달한다.

이 코드를 수정할 때는 다음을 지킨다.

- Windows 전용 코드는 `#[cfg(target_os = "windows")]` 안에 둔다.
- 메시지 처리 실패가 앱 종료로 이어지지 않게 한다.
- 메인 창에만 훅을 연결한다.

## Rust 기준

- 새 코드에서 `unwrap()`과 `expect()`를 사용하지 않는다.
- 운영체제, 파일 시스템, 창 제어 실패는 `Result`나 조용한 무시 중 하나를 명확히 선택한다.
- 사용자 파일을 저장할 때는 원문 손상을 막는 방식으로 확장한다.

## 검증

- 백엔드 또는 Tauri 설정 변경 후: `npm run tauri build`
- 프론트엔드와 함께 바뀐 경우: `npm run check` 후 `npm run tauri build`
