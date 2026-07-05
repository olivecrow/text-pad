# text-pad

`text-pad`는 Tauri 2와 SvelteKit으로 만든 Windows용 메모장형 텍스트 편집기다. 저장 기준은 항상 원문 텍스트이며, 렌더 모드는 원문을 바꾸지 않고 읽기 쉽게 표시하는 보조 화면이다.

Tauri는 Rust 백엔드와 웹 화면을 데스크톱 앱으로 묶는 프레임워크이고, SvelteKit은 화면 구현에 쓰는 프론트엔드 프레임워크다.

## 주요 기능

- 로컬 텍스트 파일 열기, 저장, 다른 이름으로 저장.
- 원문 모드 편집과 커서 행/열 표시.
- 렌더 모드 구문 강조, 들여쓰기 가이드, 줄 번호, 큰 파일용 가상화 표시.
- 독립 설정창을 통한 글자 크기, 탭 크기, 렌더 색상, 렌더 글꼴 설정.
- 라이트/다크/시스템 테마와 테마별 렌더 색상 저장.
- Windows WebView2 가로 휠 입력 보정.

## 실행

```bash
npm run tauri dev
```

## 빌드

```bash
npm run tauri build
```

빌드 결과는 `src-tauri/target/release/` 아래에 생성된다. 현재 실행 파일 이름은 `text-pad.exe`다.

## 개발 문서

- `AGENTS.md`: 작업 규칙.
- `docs/project-guide.md`: 프로젝트 전체 구조와 현재 범위.
- `docs/backend-guide.md`: Rust/Tauri 백엔드 계약.
- `docs/frontend-guide.md`: SvelteKit 프론트엔드 계약.
- `docs/features/`: 기능별 세부 기준.
- `docs/implementation-checklist.md`: 남은 기능과 완료 기준.
