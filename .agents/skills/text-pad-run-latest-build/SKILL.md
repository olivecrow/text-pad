---
name: text-pad-run-latest-build
description: text-pad의 현재 작업 트리에서 검증한 최신 Windows 릴리스 실행 파일을 절대 경로로 시작하고 실제 프로세스와 창이 그 파일에서 실행됐는지 확인한다. 실제 Tauri 앱 테스트, 파일 대화상자·창 제어·설치·패키징 검증, 최신 로컬 빌드 실행 요청, 설치된 옛 버전 대신 방금 만든 빌드를 사용해야 할 때 사용한다.
---

# text-pad 최신 로컬 빌드 실행

## 목적

현재 작업 트리에서 검증한 `src-tauri/target/release/text-pad.exe`만 실행한다. Windows에 등록된 설치본이 대신 열리지 않도록 실행 파일 경로, 프로세스 경로와 자동화 대상 창을 차례로 대조한다.

## 안전 경계

- 앱 이름, 시작 메뉴 항목, 설치된 앱 등록 정보나 `sky.launch_app`으로 text-pad를 실행하지 않는다. 이 경로는 `%LOCALAPPDATA%\text-pad\text-pad.exe`의 옛 설치본을 열 수 있다.
- 다른 `text-pad` 프로세스가 열려 있으면 저장되지 않은 문서를 보호하기 위해 자동 종료하지 않는다. 경로와 프로세스 ID를 보고하고 사용자가 저장·종료하도록 기다린다.
- 업데이트 버튼 유무나 창 제목을 최신 빌드의 근거로 사용하지 않는다. 실제 실행 파일 경로 일치가 필수 근거다.
- 실제 앱 테스트가 끝나도 사용자가 요청하지 않은 창 종료, 설치, 업데이트, 커밋이나 푸시를 하지 않는다.

## 실행 절차

1. `git status --short --branch`로 현재 변경 범위를 기록한다.
2. 최신 빌드 근거를 확정한다.
   - 현재 앱 변경 이후 이 작업에서 `npm run tauri:build:signed`가 성공했고 새 `text-pad.exe`가 빌드 시작 뒤 생성됐다면 그 산출물을 재사용한다.
   - 위 근거가 없거나 앱 코드·정적 자산·설정·권한·Rust·패키징이 뒤이어 바뀌었다면 먼저 `../text-pad-signed-build/SKILL.md`를 전부 읽고 서명 빌드와 산출물 검증을 다시 수행한다.
   - 단순 문서나 저장소 지침만 바뀌었고 이미 검증한 실행 파일을 테스트하는 경우에는 중복 빌드하지 않는다.
3. 저장소 루트에서 `scripts/start-latest-build.ps1`을 실행한다. 서명 빌드 시작 시각을 알고 있으면 `-BuiltAfter`로 전달한다. 이 명령은 사용자 데스크톱에 창을 띄우는 GUI 앱 실행이므로 `shell_command`의 `sandbox_permissions: "require_escalated"`로 사용자 데스크톱 세션에서 실행한다. 샌드박스 안에서 시작하면 사용자가 볼 수 없는 격리된 창이 생길 수 있다.

   ```powershell
   pwsh -NoProfile -File .agents/skills/text-pad-run-latest-build/scripts/start-latest-build.ps1 -BuiltAfter "<ISO 8601 build start>"
   ```

4. 스크립트 결과에서 다음 조건을 모두 확인한다.
   - `exactPathMatch`가 `true`다.
   - `actualPath`가 저장소의 `src-tauri/target/release/text-pad.exe` 절대 경로다.
   - `windowReady`가 `true`다.
   - `buildLastWriteTime`이 필요한 빌드 시작 시각보다 늦다.
5. 화면 자동화가 필요하면 `computer-use` 스킬을 읽고 Windows 창 목록을 새로 가져온다. 반환된 `app` 값이 정확히 `process:<actualPath>`인 창만 후보로 삼고 후보가 하나일 때만 `get_window`와 `activate_window`를 호출한다. 제목만으로 창을 고르거나 `sky.launch_app`으로 다시 실행하지 않는다.
6. 파일 대화상자, 창 제어와 같은 실제 Tauri 동작을 검증한다. 각 입력 뒤에는 새 창 상태를 관찰해 결과를 확인한다.
7. 완료 시 빌드 근거, 프로세스 ID, `targetPath`와 `actualPath`, 확인한 동작, 확인하지 못한 범위와 앱을 열어 두었는지를 보고한다.

## 실패 처리

- 실행 파일이 없거나 `-BuiltAfter`보다 오래됐으면 실행하지 말고 서명 빌드 단계로 돌아간다.
- 설치본이나 다른 경로의 `text-pad`가 열려 있으면 중단한다. 해당 프로세스를 강제로 닫거나 그 창으로 테스트를 계속하지 않는다.
- 시작한 프로세스의 실제 경로가 다르면 최신 빌드 검증 실패로 처리하고 UI 조작을 시작하지 않는다.
- Windows 자동화가 사용자에 의해 중단되면 즉시 입력을 멈추고 실제 앱 검증을 완료로 보고하지 않는다.

## 보조 스크립트

`scripts/start-latest-build.ps1`은 저장소 경로 확인, 다른 text-pad 프로세스 차단, 정확한 실행 파일 시작, 프로세스 경로와 창 준비 확인을 한 번에 수행하고 JSON 결과를 출력한다.
