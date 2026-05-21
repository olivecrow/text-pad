# AGENTS.md - 에이전트 전용 개발 컨텍스트 및 히스토리

이 문서는 `text-pad` 프로젝트를 수행하는 AI 에이전트(Antigravity 등)가 개발을 진행하며 작업 내역, 컨텍스트 정보, 아키텍처적 결정 사항을 기록하고 동기화하기 위한 문서입니다. 

> [!IMPORTANT]
> **에이전트 준수 사항:**
> 모든 에이전트는 개발 단계가 완료되거나 중요 설계 변경이 발생할 때마다 **본 문서의 [개발 이력 및 컨텍스트 레코드] 섹션에 내용을 즉시 업데이트**해야 합니다. 이를 통해 컨텍스트 윈도우가 리셋되거나 다른 서브에이전트가 투입되더라도 이전 작업 상태를 완벽히 인계받을 수 있도록 합니다.

---

## 1. 현재 에이전트 상태 및 우선순위 (Current Status & Priorities)

- **활성 에이전트**: Antigravity (Senior Developer Persona)
- **현재 초점**: Phase 2 (CodeMirror 6 기반 소스 에디터 통합 준비)
- **최우선 태스크**: 원시 텍스트 뷰어(Phase 1 마일스톤) 검증 완료 후, 본격적인 원문 편집 모드 구축 준비

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

