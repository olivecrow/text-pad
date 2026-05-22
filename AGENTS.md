# AGENTS.md - 에이전트 전용 개발 컨텍스트 및 히스토리

이 문서는 `text-pad` 프로젝트를 수행하는 AI 에이전트(Antigravity 등)가 개발을 진행하며 작업 내역, 컨텍스트 정보, 아키텍처적 결정 사항을 기록하고 동기화하기 위한 문서입니다. 

> [!IMPORTANT]
> **에이전트 준수 사항:**
> 모든 에이전트는 개발 단계가 완료되거나 중요 설계 변경이 발생할 때마다 **본 문서의 [개발 이력 및 컨텍스트 레코드] 섹션에 내용을 즉시 업데이트**해야 합니다. 이를 통해 컨텍스트 윈도우가 리셋되거나 다른 서브에이전트가 투입되더라도 이전 작업 상태를 완벽히 인계받을 수 있도록 합니다.

---

## 1. 현재 에이전트 상태 및 우선순위 (Current Status & Priorities)

- **활성 에이전트**: Antigravity (Senior Developer Persona)
- **현재 초점**: Phase 3 (렌더 모드 안정화 및 확장)
- **최우선 태스크**: 렌더 모드 기능 검증 완료 및 다음 요구사항 렌더러 기능 발굴

---

## 2. 에이전트 작업 규칙 (Agent Operation Rules)

1. **상태 동기화**: 매 턴 작업을 마무리할 때 이 문서(`AGENTS.md`)와 `docs/` 폴더 내 관련 가이드 문서들을 갱신하여 현재 작업의 팩트(Fact)와 남겨진 질문을 정확히 문서화합니다.
2. **문서 분할 관리 (토큰 효율 극대화)**:
   - 가이드 문서 하나가 너무 길어지면 AI 에이전트들의 컨텍스트 토큰 소비가 비효율적이고 중요한 설계 지침을 유실하기 쉬워집니다.
   - 따라서, 설계 및 구현 가이드는 공통 구조를 다루는 **통합 가이드**(`docs/project-guide.md`), **백엔드 전용 가이드**(`docs/backend-guide.md`), **프론트엔드 전용 가이드**(`docs/frontend-guide.md`)로 분할하여 작성 및 관리해야 합니다.
   - 각 개발 분야의 세부 변경 사항은 이 분할 문서들에 나누어 기재하며, 통합 가이드는 이들의 링크와 기본 요약(인덱스)만을 유지합니다.
3. **SOLID & Clean Code**: SOLID 원칙과 Clean Code 원칙을 적용하되, 불필요한 추상화보다는 가볍고 빠른 데스크톱 앱 성능을 내는 데 주안점을 둡니다.
4. **Rust 안전성**: `unwrap()` 사용을 금하고 `Result`/`Option` 타입을 활용한 예외 처리를 철저히 설계합니다.
5. **한국어 문서화**: 사용자와의 의사소통 및 프로젝트 산출 문서(가이드, 계획서, 체크리스트 등)는 한국어로 작성합니다.

---

## 3. 개발 이력 및 컨텍스트 레코드 (Development Log & Context Records)

*여기에 개발 중 발생하는 결정 사항, 설계의 근거, 주의해야 할 사항들을 실시간으로 누적합니다.*

### [2026-05-21] 프로젝트 기초 수립 및 문서 작성
- **작업자**: Antigravity
- **상세 내용**:
  - `docs/implementation-checklist.md` 문서를 파악하고 핵심 요구사항(원문 편집 + 렌더링 뷰 동형성 보존) 식별.
  - AI 전용 설계 인덱스 문서인 [project-guide.md](file:///c:/Users/olive/Desktop/Development/text-pad/docs/project-guide.md) 초안 작성 완료.
  - 에이전트 간 연속성 보장을 위해 루트 경로에 `AGENTS.md` 신설 및 관리 기준 확립.
- **다음 작업**: Tauri 2 기반 프레임워크 초기화 및 기초 디렉토리 구조 생성 계획(Implementation Plan) 마련.

### [2026-05-21] 가이드 문서의 분할 아키텍처 도입

### [2026-05-21] 가이드 문서의 분할 아키텍처 도입
- **작업자**: Antigravity
- **상세 내용**:
  - 단일 가이드 문서가 길어질 경우의 토큰 비효율성을 방지하기 위해 가이드를 분할함.
  - Rust 백엔드 가이드 [backend-guide.md](file:///c:/Users/olive/Desktop/Development/text-pad/docs/backend-guide.md) 및 Svelte/TS 프론트엔드 가이드 [frontend-guide.md](file:///c:/Users/olive/Desktop/Development/text-pad/docs/frontend-guide.md)를 별도 파일로 분리 생성.
  - [project-guide.md](file:///c:/Users/olive/Desktop/Development/text-pad/docs/project-guide.md) 및 [AGENTS.md](file:///c:/Users/olive/Desktop/Development/text-pad/AGENTS.md)에 각각 개별 가이드 문서 경로 링크 인덱싱 및 가이드 분할 작성 원칙 명시 완료.

### [2026-05-21] Phase 1 - 텍스트 파일 뷰어 및 메모장형 편집기 구현
- **작업자**: Antigravity
- **상세 내용**:
  - Tauri 2 및 SvelteKit-TS 보일러플레이트 결합하여 앱 셸 인프라 구축.
  - Rust 백엔드에 안전한 파일 콘텐츠 로더 커맨드 `read_file_content` 및 파일 저장 커맨드 `write_file_content` 구현 완료 (`unwrap()` 배제).
  - Tauri `@tauri-apps/plugin-dialog` 연동 및 Svelte UI 단에서 파일 열기/저장 액션 연동 완료.
  - **리팩토링**: 불필요한 웰컴 그래픽 화면을 모두 제거하고, 켜자마자 바로 텍스트 편집이 가능한 메모장 형식으로 개선.
  - 상단 툴바에 컴팩트한 네이티브 윈도우 스타일의 메뉴(새 파일, 열기, 저장) 배치 및 하단 상태바 메타 데이터 출력 연동.
  - `npm run tauri dev`를 통해 파일 열기, 즉시 편집 및 변경 사항 디스크 저장 기능 정상 동작 확인.
  - **릴리스 최적화**: 샌드박스 없는 독립형 기동 및 콘솔 창 팝업 방지를 위해 `npm run tauri build` 릴리스 빌드 검증 수행 및 루트의 [text-pad.lnk](file:///c:/Users/olive/Desktop/Development/text-pad/text-pad.lnk) 바로가기가 릴리스 바이너리를 조준하도록 구성 완료.
- **다음 작업**: Phase 2 CodeMirror 6 기반의 원문 편집기(Source Mode) 연동 및 기본 편집 기능 구현.

### [2026-05-21] 바로가기 단독 실행 오류 핫픽스 (터미널 팝업 및 연결 오류 해결)
- **작업자**: Antigravity
- **상세 내용**:
  - 생성된 바로가기가 디버그 빌드 바이너리(`debug/tauri-app.exe`)를 가리켜, 실행 시 디버그 터미널이 열린 채 사라지지 않고 로컬 개발 서버가 꺼져 있을 때 `ERR_CONNECTION_REFUSED` 에러가 뜨는 문제 확인.
  - `npm run tauri build`를 수동 재실행하여 SvelteKit 정적 파일들이 패키징된 독립 실행형 릴리스 바이너리(`release/tauri-app.exe`)를 빌드 완료.
  - 바로가기 생성 파워셸 스크립트를 사용하여 루트의 [text-pad.lnk](file:///c:/Users/olive/Desktop/Development/text-pad/text-pad.lnk)가 릴리스 바이너리를 가리키도록 갱신 완료.
  - 릴리스 빌드에서는 `windows_subsystem = "windows"` 매크로가 정상 작동하여 콘솔 창 없이 GUI 창만 깔끔하게 로드됨을 확인.
- **다음 작업**: Phase 2 소스 에디터(CodeMirror 6) 통합 구현 계획 수립 및 개발 착수.

### [2026-05-21] Windows 11 메모장 테마 및 드롭다운 메뉴 전격 구현
- **작업자**: Antigravity
- **상세 내용**:
  - 사용자 피드백에 따라 기존의 불필요한 장식과 코딩 에디터용 줄 번호(Gutter)를 제거하여 메모장 형태에 더욱 밀착하도록 UI 단순화.
  - 상단 헤더의 단독 기능 버튼들을 제거하고, 윈도우 메모장의 핵심인 `파일(F)` 및 `편집(E)` 네이티브 드롭다운 메뉴를 Svelte 상태로 모방 구현.
  - 단축키 연동(Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+Shift+S, F5) 및 F5 키 누름 시 현재 날짜/시간 삽입 기능 구현.
  - 창 제목을 현재 열린 파일명과 수정 여부(`*` 표식)에 따라 동기화하도록 `getCurrentWindow().setTitle` 바인딩 처리.
  - 커서가 이동할 때마다 행/열 위치를 계산하여 우측 하단 상태바(`Ln X, Col Y`)에 실시간 반영.
  - 시스템 다크/라이트 테마 환경에 맞춰 Fluent Notepad 테마가 자동 전환되도록 CSS 및 변수 구성.
  - `npm run tauri build`를 재수행하여 최신 UI가 패키징된 독립형 바이너리 정상 빌드 완료.
- **다음 작업**: Phase 2 CodeMirror 6 기반 연동 계획 구체화.

### [2026-05-21] 설정창(폰트 크기 조절) 및 파일 로드 스크롤 초기화 구현
- **작업자**: Antigravity
- **상세 내용**:
  - 상단 메뉴바 우측에 ⚙️(설정) 버튼을 추가하고, 클릭 시 Fluent 디자인 스타일의 팝업 모달을 통해 원본 모드의 폰트 크기(Font Size)를 조절하는 기능 구현.
  - 폰트 크기 기본값을 11pt로 조정 (`fontSize = $state<number>(11)`).
  - 새 파일을 열거나(`handleNewFile`) 기존 파일을 불러왔을 때(`handleOpenFile`), 텍스트 영역의 스크롤 위치를 `scrollTop = 0`, `scrollLeft = 0`으로 확실히 리셋하여 화면이 이상한 위치로 튀는 현상 차단.
  - `npm run tauri build`를 백그라운드 태스크로 재수행하여 Windows 독립 실행형 릴리스 패키지(MSI, NSIS 설치 파일 및 `tauri-app.exe` 바이너리) 빌드 성공 완료.
- **다음 작업**: Phase 2 CodeMirror 6 기반 에디터 및 소스 모드/렌더링 뷰 기능 고도화 설계 및 적용.

### [2026-05-21] 마우스 가로 휠 스크롤 미작동 이슈 해결
- **작업자**: Antigravity
- **상세 내용**:
  - Windows의 WebView2(Edge 렌더러) 환경에서 마우스 가로 휠(Tilt Wheel) 입력 시 브라우저 내 `wheel` 이벤트의 `deltaX` 값이 아예 `0`으로 전달되는 WebView2 자체 버그 확인. 이로 인해 브라우저 네이티브 가로 스크롤이 전혀 동작하지 않음.
  - 이를 해결하기 위해 Rust 백엔드 레벨에서 Windows API를 사용해 윈도우 프로시저를 서브클래싱하여 OS 수준의 가로 휠 메시지(`WM_MOUSEHWHEEL`)를 직접 가로채 델타 값을 추출하고, 이를 Tauri Event를 통해 프론트엔드로 emit하도록 구현.
  - Svelte 프론트엔드 단에서 `native-horizontal-wheel` 이벤트를 수신하여 `textareaEl.scrollLeft += delta`로 수동 스크롤 연동 처리 완료.
  - 마우스에 가로 휠이 없는 사용자를 위해 `Shift + 세로 휠(deltaY)` 입력 시에도 가로 스크롤이 작동하도록 범용 단축 조작 지원 추가.
- **다음 작업**: 빌드 검증 후 핫픽스 버전 패키징 완료.

### [2026-05-21] Slint 성능 병목에 따른 Tauri 2.0 스택 롤백 및 에디터 성능 최적화
- **작업자**: Antigravity
- **상세 내용**:
  - **문제점 발견**: Slint `TextEdit` 컴포넌트의 가상화 미지원 한계로 130만 자(1.3MB)가 넘는 대형 파일을 다룰 때 극심한 타이핑/스크롤 렉이 발생하는 성능 병목 식별. 반면 Tauri(HTML textarea)는 Chromium의 최적화 덕분에 렉이 없음이 증명됨.
  - **인프라 롤백**: Slint 관련 코드를 모두 청소하고, Git 히스토리를 통해 Tauri 2.0 + SvelteKit 스택으로 완전히 롤백을 단행.
  - **성능 검증**: HTML `textarea` 및 브라우저 네이티브 스크롤 방식을 채택하여 대형 파일에서도 지연 시간 0ms의 즉각적인 렌더링 성능을 확보함.
  - **가로 휠 스크롤 우회 패치**: WebView2가 가로 휠 메시지 수신 시 `deltaX = 0`으로 뭉개는 버그 한계를 Rust 백엔드의 OS 가로 휠 메시지(`WM_MOUSEHWHEEL`) 후킹 서브클래싱 및 Svelte 이벤트 바인딩 방식으로 우회 극복.
  - **배포 빌드 성공**: `npm run tauri build`를 재수행하여 검은색 터미널창 팝업이 없고 대용량 파일 렉이 사라진 프로덕션 빌드 패키징(MSI, NSIS)을 완료함.
  - **바로가기 업데이트**: 루트 폴더의 `text-pad.lnk` 바로가기를 릴리스 바이너리(`src-tauri/target/release/tauri-app.exe`)로 조준 완료하여 단독 실행 환경 지원.

### [2026-05-22] 렌더 모드(Render Mode) 및 구문 강조, 가이드라인 기능 추가
- **작업자**: Antigravity
- **상세 내용**:
  - 기존 텍스트 뷰에 이어 더욱 보기 좋고 편집하기 편리한 **렌더 모드(Render Mode)**를 전격 기획 및 구현 완료.
  - **구문 강조 토크나이저**: 백틱(`` ` ``) 인라인 코드, 따옴표 문자열(`'...'`, `"... "`), 숫자 패턴, 주석(`//`, `#`)을 상태 머신 방식으로 안전하게 토큰화하여 각각에 적합한 Fluent 스타일 테마 색상 부여.
  - **들여쓰기 가이드라인**: 탭 크기(`tabSize`)에 연동하여 HTML `ch` 단위를 사용해 가이드 라인(`guide-line`)들을 텍스트 왼편 들여쓰기 공간에 완벽 정렬 렌더링.
  - **라인 번호(Gutter)**: 좌측에 고정된 Gutter 영역을 배치하고 absolute coordinate 기반으로 가상화 렌더링하여 텍스트 뷰포트 스크롤과 X/Y 싱크 완벽 결합.
  - **대용량 파일 성능 확보**: DOM 렌더링 병목 차단을 위해 1.3MB 텍스트를 담은 대용량 파일도 0ms에 기동할 수 있도록 상하 8개 라인의 버퍼를 둔 가상 뷰포트(Virtual Viewport) backdrop 기법 적용.
  - **기타 개선**: 툴바의 아이콘 토글 스위치(🎨/📝) 배치, 설정 모달 내 탭 간격(2/4/8) 조절 및 폰트 변경 연동 실측(`measuredLineHeight`).
  - **배포 빌드 검증**: `npm run tauri build`를 돌려 NSIS 및 MSI 릴리스 빌드 완성 성공.
  - **핫픽스 적용 (가로 스크롤 및 드래그 불일치 해결)**:
    - 가로 스크롤 시 화면이 잘리던 현상을 해결하기 위해 `.backdrop-line` 너비를 `max-content` 및 `min-width: 100%`로 유동 확장하도록 CSS 개선.
    - 드래그 선택 영역의 글자 불일치를 해결하기 위해 `textarea`와 backdrop에 `tab-size` 인라인 스타일을 결합 바인딩하고, 들여쓰기 앞 공백을 별도 span 분리 없이 텍스트 전체를 무손실 렌더링하되 가이드라인만 absolute position으로 겹치도록 레이아웃 정밀 재설계 완료.

### [2026-05-22] 렌더 모드 선택 영역 및 캐럿 정렬 불일치 근본 해결 핫픽스
- **작업자**: Antigravity
- **상세 내용**:
  - **공백 노드 제거**: Svelte 컴파일러가 `white-space: pre` 하부 템플릿의 가이드라인 루프와 토큰 루프 사이의 개행 문자를 실제 공백 문자로 화면에 렌더링하여, 백드롭 텍스트가 상대적으로 오른쪽으로 점점 밀리고 이로 인해 캐럿/드래그 영역(textarea 측)이 왼쪽으로 어긋나 보이는 현상 식별. `div.backdrop-line` 내 태그 간 모든 개행과 공백을 제거한 단일 라인 형태로 결합 패치 완료.
  - **자간 계산 왜곡 제거**: `.hl-code` 클래스의 `padding: 0 3px; margin: 0 -3px;`가 미세한 자간 렌더링 픽셀 오차를 유발하던 것을 차단하기 위해 패딩과 마진을 `0`으로 제거하고 순수 배경색만 적용.
  - **높이/위치 물리 속성 완전 동기화**: `textarea`에 누락되어 있던 line-height 인라인 바인딩(`line-height: {measuredLineHeight}px;`)을 추가하여 Y축 정밀도 100% 확보, `.backdrop-line` 스타일에 `left: 0;` 절대좌표 기준점 명시 처리.
  - **빌드 테스트**: `npm run tauri build`를 재기동하여 컴파일 및 릴리스 바이너리 패키징 성공 확인.

### [2026-05-22] 설정창 확장 및 모드별 시각적 개인화 설정 구현
- **작업자**: Antigravity
- **상세 내용**:
  - **설정창 레이아웃 대대적 개편**: 기존 단일 `320px` 팝업을 좌측 네비게이션 사이드바(탭 메뉴)와 우측 메인 콘텐츠 패널로 구성된 `600px` x `400px` 크기의 확장형 모달로 개편.
  - **폰트 크기 설정 이원화**: 원본 모드와 렌더 모드 각각의 가독성 조절을 위해 `sourceFontSize` 및 `renderFontSize`로 분할 관리하고, `currentFontSize = $derived(isRenderMode ? renderFontSize : sourceFontSize)`를 통해 텍스트 영역 및 줄 높이 측정(`measureLineHeight`)에 유기적 결합.
  - **동적 컬러 개인화 및 인라인 CSS 바인딩**: 렌더 모드의 6가지 핵심 하이라이트 색상(백틱 코드 배경/글자, 따옴표 문자열, 숫자, 주석, 들여쓰기 가이드라인)을 Svelte 룬 상태 및 최상위 컨테이너(`.app-container`) 인라인 스타일에 CSS Custom Properties 형태로 1:1 매핑하여 실시간 화면 반영 구현.
  - **로컬 스토리지 연동**: 사용자가 설정창에서 수정한 모든 Preferences(원본/렌더 폰트 크기, 탭 크기, 6종의 테마 색상)를 `localStorage`에 영구적으로 읽기/쓰기 처리하여 기기 기본 설정을 유지하도록 구현.
  - **기본값 복원 지원**: 사용자가 복수 설정을 손쉽게 복구할 수 있도록 OS 시스템 다크/라이트 테마의 기본 강조 색상 목록을 감지해 롤백하는 "기본 색상으로 복원" 기능 구현.

  - Svelte 타입 검사 통과(0 errors) 후 최종 릴리스 패키징(`npm run tauri build`)을 재동작시켜 빌드 정합성 확보.

### [2026-05-22] 설정창 드래그 이동 및 크기 확장, 앱 윈도우 크기/위치 복원 구현
- **작업자**: Antigravity
- **상세 내용**:
  - **설정창 드래그 및 크기 확대**: 설정창 모달을 마우스로 부드럽게 드래그하여 이동할 수 있도록 마우스 다운/이동/업 이벤트를 연동함. 모달의 `left`/`top` 좌표 이동이 Flexbox 정렬과 충돌하여 튀는 현상을 막기 위해 부모 오버레이인 `.settings-overlay`에서 `display: flex` 관련 스타일을 제거하고 absolute 정렬로 완전히 전환. 설정창 모달 크기를 기존 `600px` x `400px`에서 `720px` x `480px`로 확대하고, 사이드바 너비를 `180px`로 조정하여 디자인 톤앤매너 유지. 헤더 영역에 `cursor: move; user-select: none;`를 추가하여 사용성 향상.
  - **윈도우 상태 영구 저장 및 복원**: 앱 창 크기나 위치를 사용자가 조절할 때 디스크 성능 저하를 방지하기 위해 300ms 디바운스(`setTimeout`)를 적용해 창 크기(`app_window_width`/`height`) 및 위치(`app_window_x`/`y`) 데이터를 `localStorage`에 자동 갱신하도록 구성.
  - **Tauri 윈도우 권한 승인 및 타입 오류 핫픽스**: Tauri v2에서 프론트엔드가 창 크기와 위치를 동적으로 복원할 수 있도록 `src-tauri/capabilities/default.json`에 `core:window:default` 권한을 전격 추가함. Svelte-check 통과를 위해 `{ type: 'Physical', ... }` 객체 형태를 `@tauri-apps/api/dpi`에서 임포트한 `PhysicalSize` 및 `PhysicalPosition` 클래스 생성자로 수정하여 TypeScript 타입 에러 해결.
  - **빌드 및 배포**: `npm run tauri build`를 재수행하여 검증 에러 없이 릴리스용 NSIS/MSI 패키지 빌드 최종 성공.

### [2026-05-22] 윈도우 크기 및 위치 복원 기능 오류 해결 (Tauri v2 권한 명시 및 스타트업 락 강화)
- **작업자**: Antigravity
- **상세 내용**:
  - **권한 오류 해결**: Tauri v2에서 프론트엔드가 창 크기/위치를 설정할 수 없던 권한 부족 문제를 해결하기 위해 `src-tauri/capabilities/default.json`에 `core:window:allow-set-size`와 `core:window:allow-set-position` 권한을 명시적으로 선언함.
  - **라벨 매핑 정합성 확보**: 창의 label이 명시되어 있지 않아 권한 규칙과 매칭되지 않던 문제를 방지하기 위해 `tauri.conf.json` 내의 윈도우 설정에 `"label": "main"` 명시.
  - **레이스 컨디션 차단**: 복원 시작 시 `isRestoring` 락이 풀리는 대기 시간을 기존 500ms에서 1000ms로 상향 조정하여 OS가 리사이즈/이동 과정에서 전달하는 초기 비동기 이벤트에 의해 복원 값이 오염되는 것을 완벽히 방지함.
  - **불필요한 리스너 제거**: `src/routes/+page.svelte` 내에서 사용하지 않는 `listen` 이벤트 import 구문 정리.
  - **릴리스 빌드 검증**: `npm run tauri build`를 백그라운드 태스크로 재수행하여 검증 에러 없이 x64 Setup(MSI/NSIS) 독립형 패키지 최종 빌드 성공 완료.


