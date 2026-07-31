# 앱 업데이트와 정보 창

이 문서는 GitHub Releases를 사용하는 `text-pad`의 자체 업데이트와 도움말 메뉴 계약을 정의한다.

## 사용자 흐름

- 메인 창을 표시하고 편집기에 초점을 준 뒤 1초 후 앱 시작 세션당 한 번 업데이트를 확인한다.
- 시작 확인에서 새 버전을 찾으면 현재 버전, 새 버전, 릴리스 내용을 보여주고 설치 여부를 묻는다.
- `도움말(H) > 업데이트 확인`은 사용자가 원할 때 같은 확인을 다시 실행한다.
- 수동 확인에서 새 버전이 없으면 하단 상태 표시줄에 현재 버전이 최신이라고 잠시 표시한다.
- 확인 또는 다운로드에 실패하면 수동 확인에서만 상태 표시줄에 오류를 표시한다. 시작 확인 실패로 편집을 방해하지 않는다.
- 업데이트 설치를 선택했을 때 저장하지 않은 탭이 있으면 기존 종료 흐름과 같은 저장 확인을 먼저 거친다.
- 저장 확인을 취소하면 업데이트 설치도 취소한다.
- 다운로드 진행률을 하단 상태 표시줄에 표시하고, 설치가 끝나면 앱을 다시 시작한다.
- 동시에 두 번 확인하거나 설치하지 않는다.

## 도움말 메뉴

- `업데이트 확인`: 확인 중이거나 설치 중이면 비활성화한다.
- `정보`: 앱 버전, 릴리스 날짜, 저작권, 프로젝트 MIT 라이선스, 핵심 오픈소스 구성요소와 출처를 표시한다.
- 정보 창의 `전체 오픈소스 고지 보기`는 `static/THIRD_PARTY_NOTICES.txt`를 필요할 때만 읽는다.
- 전체 고지는 `npm run licenses`로 현재 Windows 런타임 의존성을 기준으로 다시 만든다.

`Copyright © 2026 olivecrow. All rights reserved.`는 저작권 고지다. 프로젝트의 배포 라이선스는 계속 MIT이며, 이 문구로 독점 라이선스로 바꾸지 않는다.

## 업데이트 배포

업데이트 파일은 별도 유료 서버 없이 공개 GitHub Releases에서 제공한다.

- 앱은 `https://github.com/olivecrow/text-pad/releases/latest/download/latest.json`을 확인한다.
- Tauri 업데이터는 공개키로 설치 파일 서명을 검증한다.
- 공개키는 `src-tauri/tauri.conf.json`에 포함한다.
- 개인키는 저장소에 넣지 않고, 로컬의 암호화된 키 파일과 GitHub Actions의 `TAURI_SIGNING_PRIVATE_KEY` 비밀 값으로 관리한다.
- 개인키 암호는 로컬에서 Windows DPAPI로 보호하고, GitHub Actions에서는 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 비밀 값으로 관리한다.
- 개인키를 잃으면 기존 앱이 새 서명키로 만든 업데이트를 신뢰할 수 없으므로 안전한 별도 백업이 필요하다.
- Windows 코드 서명(AuthentiCode)은 업데이트 서명과 별개다. 현재 자체 업데이트의 무결성 검증에는 Tauri 서명을 사용하며, SmartScreen 평판용 코드 서명 인증서는 별도 범위다.

`.github/workflows/release.yml`은 다음 계약을 따른다.

1. `main`에 포함된 커밋에 `v*` 태그를 푸시한다.
2. 워크플로가 Windows NSIS와 MSI 설치 파일, 업데이트 번들, `.sig`, `latest.json`을 만든다.
3. NSIS 설치 파일을 Windows 자동 업데이트 대상으로 우선한다.
4. 릴리스 날짜는 빌드 시 UTC 날짜를 `PUBLIC_APP_RELEASE_DATE`로 넣는다.
5. 릴리스와 업데이트 파일을 같은 GitHub Release에 공개한다.
6. 외부 GitHub Actions는 검토한 커밋 SHA로 고정하고, 체크아웃 자격 증명을 작업 디렉터리에 남기지 않는다.
7. 서명과 게시 전에 프로덕션 의존성 감사, Svelte 검사, 잠금 파일 기준 Rust 테스트를 모두 통과해야 한다.

`v0.1.0`에는 자체 업데이트 코드와 서명된 업데이트 파일이 없다. 따라서 첫 업데이트 지원 버전인 `v0.2.0`은 사용자가 설치 파일을 한 번 직접 받아 설치해야 하며, 이후 버전부터 앱 안에서 업데이트할 수 있다.

## 버전 변경 기준

릴리스 전에는 다음 버전을 같은 값으로 맞춘다.

- `package.json`, `package-lock.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

로컬에서 서명된 릴리스 후보를 패키징할 때는 `npm run tauri:build:signed`를 실행한다. 이 명령은 현재 Windows 사용자에게 보호된 개인키 암호를 빌드 중에만 환경 변수로 전달한다.

최종 빌드 전에는 `.agents/skills/text-pad-signed-build/SKILL.md`를 따른다. `npm run tauri build` 직접 실행과 `npm run tauri build -- --no-bundle`은 서명된 릴리스 후보의 완료 근거가 아니다.

개인키, 암호, 환경 변수 값은 로그, 문서, 커밋에 남기지 않는다.
