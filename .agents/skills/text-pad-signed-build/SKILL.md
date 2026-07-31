---
name: text-pad-signed-build
description: text-pad의 Windows 실행 파일, MSI/NSIS 설치 파일, Tauri 업데이터 서명 파일을 로컬의 DPAPI 보호 키로 빌드하고 검증한다. 사용자가 정식 빌드, 제대로 된 빌드, 서명 빌드, 설치 파일, 릴리스 후보, 업데이트 산출물 생성을 요청하거나 앱 코드·Tauri 설정·권한·Rust·패키징 변경의 최종 빌드 검증이 필요할 때 사용한다.
---

# text-pad 서명 빌드

## 목적

저장소 루트에서 기존 `scripts/build-signed-update.ps1`만 사용해 Windows 릴리스 산출물을 서명하고, 새로 생성된 파일까지 검증한다. 일반 Tauri 빌드를 서명 빌드 완료로 오인하지 않는다.

## 보안 경계

- `C:\Users\olive\.tauri\text-pad-updater.key`와 `text-pad-updater.password.dpapi`는 존재 여부만 확인한다.
- 개인키, 암호, 복호화 결과, `TAURI_SIGNING_PRIVATE_KEY*` 환경 변수 값을 읽어 출력하거나 로그·문서·커밋에 남기지 않는다.
- 기존 설치 앱의 공개키와 연결되어 있으므로 `tauri signer generate`를 실행하거나 `src-tauri/tauri.conf.json`의 `plugins.updater.pubkey`를 바꾸지 않는다. 키 회전은 사용자가 명시적으로 요청한 별도 작업으로 다룬다.
- `npm run tauri build`를 직접 실행하지 않는다. `createUpdaterArtifacts`가 켜져 있어 키를 주입하지 않으면 마지막 서명 단계에서 실패한다.
- `npm run tauri build -- --no-bundle`은 빠른 컴파일 진단에만 사용할 수 있으며 최종 빌드 근거로 인정하지 않는다.

## 빌드 절차

1. `git status --short --branch`로 현재 브랜치와 기존 변경을 기록하고 관련 없는 작업을 건드리지 않는다.
2. 변경 범위에 맞는 검사와 테스트를 먼저 끝낸다. 프론트엔드 변경은 최소 `npm run check`를 통과해야 한다.
3. 다음 두 파일의 존재 여부만 확인한다.

   ```powershell
   Test-Path -LiteralPath "$env:USERPROFILE\.tauri\text-pad-updater.key" -PathType Leaf
   Test-Path -LiteralPath "$env:USERPROFILE\.tauri\text-pad-updater.password.dpapi" -PathType Leaf
   ```

4. 빌드 시작 시각을 기록하고 저장소 루트에서 다음 명령을 한 번 실행한다.

   ```powershell
   npm run tauri:build:signed
   ```

5. 명령이 종료 코드 0으로 끝난 경우에만 성공으로 판정한다.
6. 현재 `src-tauri/tauri.conf.json` 버전에 해당하는 다음 파일이 빌드 시작 뒤 새로 생성됐는지 크기와 수정 시각으로 확인한다.

   - `src-tauri/target/release/text-pad.exe`
   - `src-tauri/target/release/bundle/msi/text-pad_<version>_x64_en-US.msi`
   - 위 MSI의 `.sig`
   - `src-tauri/target/release/bundle/nsis/text-pad_<version>_x64-setup.exe`
   - 위 NSIS 설치 파일의 `.sig`

7. `git status --short --branch`와 `git diff --check`를 다시 실행해 빌드가 추적 파일을 바꾸지 않았는지 확인한다.

## 실패 처리

- 키 또는 DPAPI 암호 파일이 없으면 정확히 누락된 파일만 보고하고 새 키를 만들지 않는다.
- DPAPI 복호화나 서명이 실패하면 실행 파일이나 설치 파일이 생겼더라도 성공으로 보고하지 않는다.
- 검사·테스트·패키징 실패를 우회하기 위해 `--no-bundle` 결과로 대체하지 않는다.
- 서명 빌드를 반복 실행하기 전에 원인을 확인하고 수정한다.

## 완료 보고

- 실행한 서명 명령과 종료 코드
- 새 실행 파일, MSI, NSIS, 각 `.sig`의 경로·크기·수정 시각
- 선행 검사와 테스트 결과
- 확인하지 못한 범위
- 커밋·푸시 여부
