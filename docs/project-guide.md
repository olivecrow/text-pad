# text-pad 프로젝트 가이드

`text-pad`는 로컬 텍스트 파일을 원문 기준으로 보존하면서 읽기 좋은 렌더 모드를 제공하는 Tauri 데스크톱 편집기다.

Tauri는 Rust 백엔드와 웹 프론트엔드를 데스크톱 앱으로 묶는 프레임워크이고, SvelteKit은 화면을 구성하는 프론트엔드 프레임워크다.

## 현재 구조

```mermaid
graph TD
    File["로컬 파일"] <-->|"읽기/쓰기"| Backend["Rust + Tauri 백엔드"]
    Backend <-->|"명령 호출"| Frontend["SvelteKit 프론트엔드"]
    Frontend --> Source["원문 모드 textarea"]
    Frontend --> Render["렌더 모드 배경 레이어"]
    Frontend --> Settings["독립 설정창"]
```

## 주요 경로

- `src/routes/+page.svelte`: 메인 화면, 원문 모드, 렌더 모드, 설정창 UI.
- `src/lib/i18n/`: 영어 기준표, 9개 추가 언어 번역표와 언어 선택·대체 처리.
- `src-tauri/src/lib.rs`: 파일 읽기/쓰기 명령, Windows 가로 휠 처리, Tauri 플러그인 설정.
- `src-tauri/capabilities/default.json`, `src-tauri/capabilities/settings.json`: 창별로 분리한 Tauri 명령 권한.
- `src-tauri/tauri.conf.json`: 메인 창과 빌드 설정. 설정창은 실행 중 동적으로 만든다.
- `src-tauri/installer.nsi`: NSIS 설치 파일 템플릿. NSIS는 Windows용 실행 설치 파일을 만드는 스크립트 기반 설치 도구다.
- `package.json`: SvelteKit, Tauri, Lucide 아이콘 의존성과 실행 명령.
- `docs/backend-guide.md`: 백엔드 계약.
- `docs/frontend-guide.md`: 프론트엔드 계약.
- `docs/features/file-workflow.md`: 파일 열기와 저장 흐름.
- `docs/features/render-mode.md`: 렌더 모드 표시 계약.
- `docs/features/natural-text-editing.md`, `docs/features/natural-text-editing.en.md`: 글머리, 자동 쌍 문자, 들여쓰기, 캐럿, 실행 취소를 아우르는 자연스러운 텍스트 편집 지침 한국어판과 영어판.
- `docs/features/delimited-table.md`: CSV/TSV 표 표시와 편집 계약.
- `docs/features/editor-undo.md`: 편집기 실행 취소 계약.
- `docs/features/settings-window.md`: 독립 설정창 계약.
- `docs/features/theme-preferences.md`: 테마와 사용자 설정 저장 계약.
- `docs/features/localization.md`: 지원 언어, 선택 우선순위와 번역표 관리 계약.
- `docs/features/app-updates.md`: 시작 확인, 도움말 메뉴, 서명된 GitHub Release 업데이트와 라이선스 고지 계약.
- `docs/implementation-checklist.md`: 남은 기능과 완료 기준.

## 현재 기능 범위

- 현재 제품 지원 형식인 `.txt`, `.json`, `.csv`, `.tsv`, `.yaml`, `.yml` 파일 열기와 저장.
- 원문 모드 편집.
- 렌더 모드 구문 강조, 들여쓰기 가이드, 줄 번호, 가상화된 화면 렌더링.
- 라이트/다크 테마, 렌더 색상, 글꼴, 글자 크기, 탭 크기 설정.
- 시스템 언어 우선 선택, 영어 대체와 설정창 언어 변경을 지원하는 10개 언어 UI.
- 메인 창을 편집기 준비 뒤 표시해 첫 화면이 곧바로 입력 가능한 상태가 되게 하는 시작 흐름.
- 설정 버튼을 처음 눌렀을 때 독립 설정창을 동적으로 생성하고 표시.
- 설정창에서 파일 형식별 렌더 표시와 렌더 편집 모듈 켜기/끄기.
- CSV/TSV 렌더 모드에서 셀 편집, 행·열 추가·제거·이동, 열 너비 조절, 첫 행 강조와 행 번호 표시.
- Windows 앱 표시 이름과 번들 실행 파일 이름을 `text-pad`로 생성.
- 현재 제품 지원 확장자를 Windows 파일 연결 정보로 등록해 `연결 프로그램`에서 선택 가능하게 함.
- NSIS 설치 파일에서 같은 버전 삭제를 선택하면 삭제 후 설치를 재개하지 않고 종료.
- Windows WebView2 가로 휠 입력 보정.
- Windows 릴리스 빌드 생성.
- 앱 시작 시 한 번 수행하는 업데이트 확인과 `도움말` 메뉴의 수동 확인.
- 버전, 릴리스 날짜, 프로젝트 라이선스와 오픈소스 출처를 표시하는 정보 창.
- GitHub Releases의 서명된 설치 파일과 `latest.json`을 사용하는 자체 업데이트.

## 아직 제품 범위로 남은 기능

- 검색, 바꾸기, 특정 줄 이동의 완성도 개선.
- Markdown 렌더링과 제한적 편집.
- JSON 트리 보기와 값 편집.
- YAML 구조 보기와 주석 보존형 편집.
- 파일 인코딩과 줄바꿈 보존 강화.

## 주요 명령

- `npm run validate:i18n`: 번역표 키와 치환 변수 검사.
- `npm run check`: Svelte와 TypeScript 검사.
- `npm run build`: 프론트엔드 정적 빌드.
- `npm run tauri dev`: Tauri 개발 실행.
- `npm run tauri:build:signed`: Windows 실행 파일, MSI/NSIS 설치 파일, 업데이터 서명 생성. 최종 빌드는 이 명령만 사용한다.
- `npm run tauri build -- --no-bundle`: 빠른 컴파일 진단 전용. 최종 빌드 완료로 간주하지 않는다.

## 공통 기준

- 저장 기준은 항상 원문 텍스트다.
- 렌더 모드는 원문을 보기 좋게 표현하되 사용자의 공백, 들여쓰기, 줄바꿈, 구분자를 임의로 바꾸지 않는다.
- 큰 파일에서 입력과 스크롤이 느려지지 않아야 한다.
- 보안 위험이 있는 렌더링 기능은 기본 차단한다.
- 업데이트를 설치하기 전 저장하지 않은 탭의 저장 여부를 확인한다.
- 업데이트 개인 서명키는 저장소와 로그에 절대 포함하지 않는다.
