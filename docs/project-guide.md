# text-pad 통합 프로젝트 가이드

이 문서는 `text-pad` 프로젝트의 핵심 설계 철학, 프로젝트 전체 디렉토리 인덱스, 각 개발 서브 시스템 가이드를 안내하는 통합 설계 문서입니다.

---

## 1. 아키텍처 인덱스 및 상세 가이드
프로젝트가 복잡해짐에 따라 개발 영역이 백엔드와 프론트엔드로 나뉩니다. AI 에이전트(Antigravity 등)가 컨텍스트 윈도우 한계 내에서 빠르고 효율적으로 특정 영역의 설계를 이해할 수 있도록 관련 세부 가이드 문서를 분할하여 관리합니다.

*   [통합 프로젝트 가이드 (본 문서)](file:///c:/Users/olive/Desktop/Development/text-pad/docs/project-guide.md)
    *   **역할**: 전체 아키텍처 데이터 흐름도, 디렉토리 디바이드, 마일스톤 및 공통 코딩 표준 관리.
*   [백엔드 개발 가이드 (Rust / Tauri)](file:///c:/Users/olive/Desktop/Development/text-pad/docs/backend-guide.md)
    *   **역할**: 파일 시스템 I/O, 경로 보안 샌드박싱, Tauri IPC 커맨드 프로토콜 및 예외 처리 설계 관리.
*   [프론트엔드 개발 가이드 (Svelte / TypeScript)](file:///c:/Users/olive/Desktop/Development/text-pad/docs/frontend-guide.md)
    *   **역할**: Svelte 스토어(DocumentStore) 상태 모델, CodeMirror 6 에디터 통합 및 파일 포맷별 파서/라운드트립 규칙 관리.

---

## 2. 시스템 아키텍처 (데이터 흐름)

```mermaid
graph TD
    File[로컬 파일 시스템] <-->|Rust File I/O| Backend[Tauri Rust 백엔드]
    Backend <-->|IPC / Tauri Command| CommandBridge[IPC Command Bridge]
    
    subgraph Frontend [Svelte 프론트엔드]
        CommandBridge <--> DocumentStore[Document Store (상태 관리)]
        DocumentStore <--> SourceEditor[원문 모드: CodeMirror 6]
        DocumentStore <--> RenderEditor[렌더링 모드: Svelte Components]
        
        Parser[형식별 Parser] -->|AST / 구조화 데이터| RenderEditor
        RenderEditor -->|편집 이벤트| RoundTrip[Round-trip 동기화기]
        RoundTrip -->|텍스트 갱신| DocumentStore
    end
```

---

## 3. 디렉토리 구조 (Directory Structure)

프로젝트 루트는 다음과 같이 구성하며, 기능 추가 시 이 구조를 준수합니다.

```
text-pad/
├── .git/
├── docs/                       # 설계 및 개발 가이드 문서 영역
│   ├── implementation-checklist.md
│   ├── project-guide.md        # 본 문서 (통합 가이드)
│   ├── backend-guide.md        # Rust/Tauri 백엔드 가이드
│   └── frontend-guide.md       # Svelte/TS 프론트엔드 가이드
├── samples/                    # 수동 검증용 테스트 파일 (.txt, .md, .json, .csv, .yaml)
├── src-tauri/                  # Rust 백엔드 영역 (Tauri)
├── src/                        # 프론트엔드 영역 (TypeScript & Svelte)
├── tests/                      # 자동화 테스트 영역
└── package.json
```

---

## 4. 단계별 개발 현황 및 체크포인트 (AI 전용)

개발을 진행하면서 아래 표의 각 단계가 완료될 때마다 상태(`진행전`, `진행중`, `완료`)와 세부 설계 구현 사항을 채워 넣습니다.

| Phase | 단계 명칭 | 상태 | 핵심 구현 파일 및 패키지 | 비고 |
|---|---|---|---|---|
| Phase 0 | Project Foundation | 완료 | - | 기술 스택 및 구조 설계 단계 |
| Phase 1 | Desktop Shell & File Workflow | 완료 | `src-tauri/src/main.rs`<br>`src/routes/+page.svelte` | Tauri 2.0 + SvelteKit 기반 앱 셸, 메뉴바, 파일 I/O 및 대용량 파일 렉 방지 완료 |
| Phase 2 | Source Mode Editor | 진행전 | - | CodeMirror 6 연동 및 편집 편의 기능 |
| Phase 3 | Mode Switching | 진행전 | - | 원문/렌더링 상태 동기화 및 뷰포트 연결 |
| Phase 4 | Render Mode Core | 진행전 | - | 렌더링 뷰 레이아웃 및 부분 편집 인프라 |
| Phase 5 | Theme & Preferences | 진행전 | - | 설정 UI(⚙️) 통한 폰트 크기 변경 및 테마 동기화 완료 |
| Phase 6 | TXT Support | 진행전 | - | TXT 렌더러 및 문단 편집 기능 |
| Phase 7 | Markdown Support | 진행전 | - | MD 파서, 렌더링, 부분 WYSIWYG 편집 |
| Phase 8 | JSON Support | 진행전 | - | JSON AST 파서, 트리 보기, 키/값 편집 |
| Phase 9 | CSV / TSV Support | 진행전 | - | CSV 파서, 그리드 표 렌더러, 셀/행 편집 |
| Phase 10| YAML Support | 진행전 | - | YAML 파서, 주석 보존형 트리 편집 |
| Phase 11| Settings Screen | 진행전 | - | 설정 UI 구성 및 로컬 저장소 연결 |
| Phase 12| Performance Tuning | 완료 | `src/routes/+page.svelte` | 130만 자(1.3MB) 대형 파일에서 렉이 없도록 Tauri HTML textarea 스택 유지 및 가로 휠 스크롤 패치 |
| Phase 13| Verification & Test | 진행전 | - | 단위 테스트 및 수동 검증 매뉴얼 작성 |
| Phase 14| Packaging & Release | 완료 | - | `npm run tauri build`를 통한 독립 실행형 패키지 릴리스 빌드 인프라 구축 완료 |

---

## 5. 공통 코드 스타일 및 룰북 (Coding Rules)

- **TypeScript / Svelte**:
  - 함수와 클래스에는 JSDoc 형태의 설명을 반드시 추가합니다.
  - 타입 안정성을 최우선으로 하며, 가능한 한 `any` 타입 사용을 배제합니다.
  - 컴포넌트 단위로 분리할 때는 프레젠테이션 컴포넌트(UI 전용)와 컨테이너 컴포넌트(데이터/이벤트 처리)를 명확히 구분합니다.
- **Rust**:
  - 모든 `unwrap()` 사용을 금지하며, `Result`와 `Option`을 활용한 안전한 에러 핸들링을 구현합니다.
  - 공통 로직은 모듈화(`mod`)하여 구조화합니다.
- **Naming Conventions**:
  - 파일 및 폴더명: 소문자 중심의 kebab-case (예: `file-system.ts`, `source-mode/`)
  - 클래스 및 인터페이스: PascalCase
  - 변수 및 함수: camelCase
  - Rust 함수/변수: snake_case
