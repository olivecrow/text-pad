# 테마와 설정 저장 계약

사용자 설정은 브라우저 로컬 저장소인 `localStorage`에 저장한다. 설정창과 메인 창은 같은 저장소를 공유하고, 브라우저 저장소 변경 알림인 `storage` 이벤트로 주요 변경을 반영한다.

CSV/TSV 표의 첫 행 강조, 행 번호 표시, 행·열 이동 애니메이션 사용 여부와 이동 시간도 같은 저장소에 보관하며, 이 설정들은 원문 파일 내용에 포함하지 않는다.

## JSON 내보내기와 가져오기

설정 파일은 사용자가 읽을 수 있는 JSON이며 최상위에 다음 정보를 둔다.

- `format`: 다른 JSON 문서와 구분하는 고정 식별자 `text-pad-settings`.
- `schemaVersion`: 설정 파일 구조 버전. 현재 버전은 `1`이다.
- `appVersion`, `exportedAt`: 내보낸 앱 버전과 UTC 시각을 나타내는 참고 메타데이터.
- `settings`: 일반, 원문 모드, 렌더 모드와 형식별 설정을 담는 실제 설정 객체.

가져오기는 현재 설정을 기준으로 파일에 있는 알려진 항목만 덮어쓴다. 이전 버전 파일에 새 설정이 없으면 현재 값을 유지하고, 더 새로운 버전에만 있는 낯선 항목은 건너뛴다. 값은 적용 전에 종류와 허용 범위를 검사하며, 잘못된 값 하나 때문에 전체 가져오기가 중단되거나 앱이 크래시해서는 안 된다.

버전이 없는 초기 형태는 `languagePreference`, `themeMode`, `sourceFontSize` 같은 기존 상태 이름을 가진 평면 객체로 간주해 현재 구조로 옮긴다. 새 설정을 추가할 때는 `src/lib/settings-transfer.ts`의 스냅샷 형식, 내보내기 값, 가져오기 정규화와 호환성 검증을 같은 변경에서 함께 확장한다.

설정 파일은 JSON 파싱 전에 UTF-8 기준 1 MiB로 제한한다. 제품 식별자가 다르거나 JSON·설정 구조가 올바르지 않으면 아무 설정도 바꾸지 않고 오류를 표시한다.


## 표시 언어

`languagePreference`는 사용자가 고른 표시 언어 상태다. `system`이면 `navigator.languages`에서 찾은 지원 언어를 사용하고, 지원 언어가 없으면 영어를 사용한다. 특정 언어 코드를 저장한 경우에는 시스템 언어보다 해당 선택을 우선한다.

언어 변경은 메인 창과 설정창의 UI, 창 제목, 파일 대화상자 필터와 날짜·시간 삽입 형식에 즉시 반영한다. 아랍어는 앱 UI를 오른쪽에서 왼쪽으로 표시한다.

## 테마 모드

`themeMode`는 사용자가 고른 테마 모드 상태다.

- `system`: 운영체제 테마를 따른다.
- `light`: 라이트 테마를 고정한다.
- `dark`: 다크 테마를 고정한다.

실제 표시 테마는 `currentTheme`으로 계산한다. `system`일 때는 운영체제 다크 모드 여부를 기준으로 `light` 또는 `dark`가 된다.

## 저장되는 주요 값

- `pref_language`: `system` 또는 사용자가 명시적으로 고른 지원 언어 코드.
- `pref_theme_mode`: 테마 모드.
- `pref_source_font_size`: 원문 모드 글자 크기.
- `pref_render_font_size`: 렌더 모드 글자 크기.
- `pref_tab_size`: 탭 표시 폭.
- `pref_delimited_table_highlight_header`: CSV/TSV 첫 행 강조 여부.
- `pref_delimited_table_show_row_indices`: CSV/TSV 왼쪽 행 번호 표시 여부.
- `pref_delimited_table_animate_reorder`: CSV/TSV 행·열 드래그 이동 애니메이션 사용 여부.
- `pref_delimited_table_reorder_duration_ms`: CSV/TSV 행·열 이동 시간. 50~2,000밀리초 범위에서 50밀리초 단위로 저장한다.
- `pref_render_font_family`: 렌더 모드 글꼴 선택.
- `pref_render_auto_pair_editing`: 렌더 모드 쌍 문자 자동 입력과 삭제 사용 여부.
- `pref_render_auto_pair_allowed_following_strings`: 렌더 모드에서 캐럿 오른쪽에 있어도 새 자동 쌍 입력을 허용하는 사용자 편집 문자열 목록의 JSON 배열. 공백은 이 값과 무관하게 항상 허용한다.
- `pref_render_auto_symbol_substitution`: 렌더 모드 화살표 기호 자동 변환 사용 여부.
- `pref_render_preserve_indent_on_enter`: 렌더 모드 줄바꿈 시 들여쓰기 유지 사용 여부.
- `pref_document_format_features`: 파일 형식별 렌더 표시와 렌더 편집 사용 여부. JSON 문자열 형태로 저장하며, 각 형식 식별자 아래에 `render`와 `edit` 값을 둔다.
- `pref_markdown_render_settings`: 모든 Markdown 문서에 공통인 제목 표식 숨김, 1·2단계 구분선, 제목 1~6단계별 크기 비율과 굵기. 잘못된 크기는 80~145% 범위로 제한하고 굵기는 지원하는 400~800 값으로 정규화한다.
- `pref_light_*`: 라이트 테마 렌더 색상과 굵기.
- `pref_dark_*`: 다크 테마 렌더 색상과 굵기.

이전 단일 색상 키인 `pref_color_*` 값은 다크 테마 초기값을 만들 때만 보조로 읽는다.

## 렌더 색상

테마별로 다음 값을 저장한다.

- 코드 배경과 코드 글자색.
- 데이터 키 1단계, 2단계, 3단계 색.
- 문자열, 숫자, 글머리 기호, 주석 색.
- 들여쓰기 가이드 색.
- 렌더 배경색과 기본 글자색.
- 렌더 글자 굵기.
- 소괄호, 대괄호, 중괄호 색.

색상은 최상위 컨테이너의 CSS 변수로 주입한다. 렌더 모드 내부 요소는 이 CSS 변수를 사용한다.

## 글꼴

렌더 모드는 사용자가 선택한 글꼴 별칭을 실제 CSS 글꼴 목록으로 바꿔 적용한다. 시작 성능을 위해 `src/app.html`에서는 원격 웹폰트를 로드하지 않는다.

글꼴을 바꿀 때는 줄 높이를 다시 측정해야 한다. 줄 높이가 맞지 않으면 배경 레이어와 실제 `textarea` 선택 영역이 어긋난다.
