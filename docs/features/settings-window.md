# 설정창 계약

설정창은 메인 편집기 안의 모달이 아니라 별도 Tauri 창이다.

## 창 구성

- `tauri.conf.json`에는 시작 성능을 위해 `main` 창만 정의하며, 메인 창은 편집기 준비 뒤 표시되도록 처음에는 숨김 상태로 둔다.
- `settings` 창은 앱 시작 때 만들지 않고, 설정 버튼을 처음 눌렀을 때 동적으로 만든다.
- 프론트엔드는 현재 창의 라벨이 `settings`인지 확인해 설정창 전용 화면을 렌더링한다.
- 창 상태 복원 플러그인은 메인 창만 대상으로 하며, `settings` 창은 복원 대상에서 제외한다.
- 좌측 설정 메뉴는 트리 구조를 사용한다. 렌더 모드 설정은 표시 색상과 글꼴 같은 `모양` 항목과 입력 보조 같은 `편집` 항목으로 나눈다.

## 열기와 닫기

설정 버튼 흐름은 다음 기준을 따른다.

1. `WebviewWindow.getByLabel("settings")`로 기존 설정창을 찾는다.
2. 앱 실행 후 첫 표시라면 메인 창의 현재 위치와 크기를 기준으로 설정창을 중앙에 둔다.
3. 있으면 `show()`로 표시하고 `setFocus()`로 초점을 옮긴다.
4. 없으면 라벨이 `settings`인 새 창을 만든다.
5. 설정창 닫기 요청은 창을 파괴하지 않고 `hide()`로 숨긴다.
6. 메인 창 종료 시에는 설정창을 `destroy()`로 정리한다.

사용자가 설정창을 직접 이동한 뒤에는 같은 앱 실행 세션에서 다시 열 때 위치를 강제로 되돌리지 않는다.

## 필요한 권한

접근 제어 목록은 프론트엔드가 호출할 수 있는 Tauri 기능을 제한하는 설정이다. 설정창 기능에는 최소한 다음 권한이 필요하다.

- `core:window:allow-show`
- `core:window:allow-set-focus`
- `core:window:allow-set-title`
- `core:window:allow-hide`
- `core:window:allow-set-position`
- `core:window:allow-destroy`
- `core:window:allow-close`
- `core:webview:allow-create-webview-window`
- `core:window:allow-create`

권한이 빠지면 설정 버튼을 눌렀을 때 `Command plugin:window|show not allowed by ACL` 같은 오류가 난다.
