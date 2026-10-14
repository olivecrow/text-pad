# Code signing policy (코드 서명 정책)

이 문서는 `text-pad`의 Windows 제작자 서명 범위와 승인 기준을 정의한다.

## 현재 서명 상태

제작자의 신원을 인증하는 Windows 코드 서명(Authenticode)과 업데이트 파일의 무결성을 검증하는 Tauri 서명은 서로 다른 서명이다. 현재 배포는 Tauri 업데이트 서명을 사용한다. SignPath Foundation 지원과 Windows 제작자 서명은 신청 단계이며, 재단 승인이나 실제 서명 완료를 뜻하지 않는다.

무료 오픈소스 서명을 지원하는 [SignPath Foundation](https://signpath.org/)은 승인된 프로젝트에 재단 명의의 서명을 제공한다. 승인 뒤 실제 서명을 적용한 배포에는 다음 출처 문구를 사용한다.

> Free code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

## 프로젝트와 파일 범위

- 공개 소스 저장소는 [olivecrow/text-pad](https://github.com/olivecrow/text-pad)이며 프로젝트 라이선스는 MIT다.
- 서명 대상은 이 저장소의 검증된 소스에서 빌드한 Windows 실행 파일, MSI 설치 파일과 NSIS 실행 설치 파일이다.
- 같은 프로젝트의 새 버전도 동일한 승인 정책을 따른다. 다른 프로그램이나 다른 유지보수자의 파일에는 이 프로젝트의 서명 권한을 사용하지 않는다.
- 의존성의 원래 라이선스와 제작자 서명은 보존한다. 재단의 허용 범위를 확인하지 않고 타사 실행 파일에 재단 서명을 붙이지 않는다.
- 공개 다운로드 경로는 [GitHub Releases](https://github.com/olivecrow/text-pad/releases)다. 서명된 릴리스의 설명에도 이 정책과 서명 출처를 연결한다.

## 담당자와 승인

현재 담당자는 저장소 소유자인 [olivecrow](https://github.com/olivecrow)다.

| 역할 | 책임 | 담당자 |
| --- | --- | --- |
| 코드 작성과 통합 | 소스와 빌드 구성을 유지한다. | olivecrow |
| 코드 검토 | 외부 기여와 서명에 영향을 주는 변경을 검토한다. | olivecrow |
| 서명 승인 | 빌드 출처와 검증 결과를 확인한 뒤 릴리스 서명을 수동 승인한다. | olivecrow |

SignPath 지원을 사용하기 전에 담당자는 GitHub와 SignPath 계정에서 2단계 인증을 사용해야 한다. 인증 활성화 여부를 확인하기 전에는 충족됐다고 표시하지 않는다. 담당자를 추가할 때도 같은 기준을 적용한다.

## 빌드와 배포 기준

- 기능 개발과 통합은 `develop`을 기준으로 하며, 공개 릴리스 태그는 검증을 마친 `main`의 커밋에 연결한다.
- 재단 서명을 요청하는 파일은 GitHub가 제공하는 Windows 실행 환경에서 소스로부터 빌드하고, 해당 실행의 보관 파일로 업로드해 출처를 검증할 수 있어야 한다.
- 실행 파일을 먼저 서명한 뒤 그 파일을 설치 파일에 포함한다. 설치 파일의 외부 서명만으로 설치되는 실행 파일까지 서명됐다고 판단하지 않는다.
- 최종 설치 파일의 제작자 서명과 시간 인증을 검증한 뒤 Tauri 업데이트 서명을 만든다. 이후 설치 파일을 수정하면 업데이트 서명도 다시 생성한다.
- 제작자 서명 검증, 설치되는 실행 파일 검증, 업데이트 무결성 검증이 모두 통과한 산출물만 서명된 릴리스로 공개한다.
- 개인키는 재단의 서명 서비스에 보관하며 저장소나 로그에 넣지 않는다. 자동 빌드용 접근 토큰도 GitHub의 비밀 값으로 관리한다.

현재 활성 배포 작업은 `.github/workflows/release.yml`이다. SignPath 연결은 [신청 및 연결 준비](../signpath-setup.md)에 따라 승인 뒤 별도로 완료한다.

## 개인정보와 외부 통신

실제 동작은 [개인정보 처리 및 외부 통신 안내](privacy.md)에 공개한다. 자동 업데이트 확인과 문서에 포함된 외부 이미지 요청이 있으므로 외부 통신이 없다고 선언하지 않는다.

## 공식 기준

- [SignPath Foundation 지원 조건](https://signpath.org/terms.html)
- [SignPath의 GitHub 빌드 출처 검증](https://docs.signpath.io/trusted-build-systems/github)
- [Microsoft의 SmartScreen 평판 안내](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
