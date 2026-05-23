# text-pad 백엔드 개발 가이드 (Rust / Tauri)

이 문서는 `text-pad` 프로젝트의 Rust 백엔드 및 Tauri 관련 설계 방향과 구현 규칙을 정의하는 AI 참조용 가이드라인입니다.

---

## 1. 백엔드 역할 및 핵심 원칙
Rust 백엔드는 운영체제(OS)와의 상호작용 및 보안 경계를 관리하는 안전한 실행 계층입니다.
1. **Zero Panics**: 프로덕션 빌드에서 백엔드는 절대 패닉(Panic) 상태로 강제 종료되지 않아야 합니다. `unwrap()`, `expect()` 사용을 철저히 금지하며, `?` 연산자와 `Result`/`Option` 타입을 이용해 우아하게 예외를 전파합니다.
2. **Strict Directory Sandbox**: 사용자가 명시적으로 열거나 저장하도록 요청한 경로 및 지정된 워크스페이스 외부의 경로에 대한 파일 읽기/쓰기는 사전 검증하여 접근을 차단합니다.
3. **Encoding & Line-ending Preservation**: 백엔드는 파일 입출력 시 텍스트 인코딩(UTF-8 기본, 필요 시 인코딩 감지)과 줄바꿈(LF / CRLF) 포맷을 파악하고 보존해야 합니다.

---

## 2. 모듈 구성 및 파일 역할 (src-tauri/src/)

```
src-tauri/src/
├── main.rs             # Tauri 빌더 초기화, 이벤트 루프, App 실행 진입점
├── menu.rs             # 시스템 메뉴바 및 단축키 바인딩 정의
├── commands/           # IPC 커맨드 핸들러
│   ├── mod.rs          # 커맨드 등록 및 export
│   ├── file_io.rs      # 파일 Open, Save, Safe-Write 기능
│   └── watch.rs        # 파일 변경 감지 (Notify 크레이트 연동)
└── security/           # 보안 관리 모듈
    ├── mod.rs
    └── sandbox.rs      # 경로 Canonicalization 및 화이트리스트 검증
```

---

## 3. IPC 커맨드 프로토콜 및 데이터 규격

모든 백엔드 IPC 커맨드는 프론트엔드가 명확히 해석할 수 있도록 규격화된 JSON 직렬화 응답을 반환합니다.

### 3.1 파일 읽기 (`open_file`)
- **요청 매개변수**: `{ file_path: String }`
- **반환 Payload (JSON)**:
  ```rust
  #[derive(serde::Serialize)]
  pub struct FilePayload {
      pub file_path: String,
      pub file_name: String,
      pub content: String,
      pub line_ending: String, // "LF" | "CRLF"
      pub is_readonly: bool,
  }
  ```

### 3.2 파일 저장 (`save_file`)
- **요청 매개변수**: `{ file_path: String, content: String, line_ending: String }`
- **보안 검증**: 대상 디렉토리에 쓰기 권한이 있는지, 파일명이 올바른지 검증한 후 임시 파일(`.tmp`)에 우선 쓴 다음, 쓰기가 성공하면 원본 파일과 원자적(Atomic)으로 교체하여 쓰기 오류 시 원본 파일 파손을 방지합니다.

### 3.3 파일 실시간 감지 (`watch_file` / `unwatch_file`)
- 외부 에디터가 파일을 변경했을 때 발생하는 경합을 해결하기 위해, `notify` 크레이트를 활용하여 지정 파일의 변경을 모니터링하고 프론트엔드에 Tauri Event(`file-changed`)를 발생시킵니다.

---

## 4. 백엔드 에러 핸들링 표준

백엔드에서 발생하는 모든 에러는 `Result<T, AppError>`의 형태를 지녀야 하며, `AppError`는 직렬화 가능한 에러 메시지와 에러 코드를 포함해야 합니다.

```rust
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("보안 검증 실패: 허용되지 않은 경로 {0}")]
    PathSecurityError(String),
    #[error("파일 읽기 실패: {0}")]
    IoError(#[from] std::io::Error),
    #[error("잘못된 인코딩 형식")]
    EncodingError,
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

---

## 5. Windows API 서브클래싱을 통한 마우스 가로 휠 후킹 (WM_MOUSEHWHEEL)

WebView2의 Windows 실행 환경 버그(가로 휠 스크롤 입력 시 `deltaX`를 0으로 강제 변환)를 극복하기 위해, OS 수준에서 마우스 가로 휠 메시지를 가로채 프론트엔드로 안전하게 전달하는 후킹 메커니즘을 적용합니다.

1. **윈도우 프로시저 서브클래싱 (`comctl32.dll`)**:
   - `SetWindowSubclass` API를 통해 현재 Tauri 메인 윈도우의 HWND 메시지 핸들러 체인에 커스텀 콜백 `window_subclass_proc`을 주입합니다.
   - 메시지 루프에서 가로 휠 메시지인 `WM_MOUSEHWHEEL` (메시지 ID `0x020E`)를 식별합니다.
2. **스크롤 델타 파싱 및 전송**:
   - `WPARAM`의 상위 16비트를 마스킹 및 비트 시프트하여 가로 휠 스크롤 회전 방향 및 속도인 `delta` 값을 물리 정수형태로 추출합니다.
   - Tauri 창 관리 API(`data.window.emit`)를 호출하여 프론트엔드로 `native-horizontal-wheel` 이벤트를 `delta` 데이터와 함께 직접 송출(emit)합니다.
3. **기본 동작 차단**:
   - WebView2 컨트롤러 단에서 가로 휠 메시지를 집어삼켜 무력화하는 오동작을 미연에 방지하기 위해, 메시지를 수동 처리한 뒤 더 이상의 전파 없이 `0`을 즉시 리턴하여 해당 OS 이벤트를 완결 처리합니다.
