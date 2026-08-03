# 텍스트 형식 지원 계약

text-pad는 사람이 직접 읽고 고치는 UTF-8과 BOM으로 판별 가능한 UTF-16 텍스트를 대상으로 한다. 제품 지원 형식은 단순히 파일을 열 수 있다는 뜻이 아니라, 중앙 판별 규칙, 원문 보존형 렌더 표시, 필요한 경우의 오류 위치, 설정창 항목, 대표 샘플, 열기·저장 필터와 Windows 연결 후보가 함께 검증된 형식을 뜻한다.

## 범위

- 프로그래밍 언어 소스 파일은 제품 지원 목록에서 제외한다.
- 바이너리 또는 바이너리일 수 있는 컨테이너 형식, 전용 시각 미리보기가 본질인 그래픽 형식, 생성된 Git 내부 데이터는 제외한다.
- 확장자가 없는 설정 파일은 관례적 파일명 또는 경로를 먼저 판별하고, 운영체제 대화상자에서는 `모든 파일` 필터로 선택할 수 있게 한다.
- 문법이 엄격한 형식은 실제 파서 또는 well-formedness 규칙으로 오류 행과 열을 표시한다. 구현마다 허용 범위가 다른 느슨한 형식은 확실한 구조 오류만 알린다.
- 렌더링은 토큰의 원문과 위치를 일대일로 유지한다. 표시를 위해 공백, 따옴표, 줄바꿈, 키 순서, 주석을 바꾸지 않는다.
- UTF-8, UTF-8 BOM, UTF-16 LE/BE BOM을 판별해 탭별로 보존한다. 새 REG 파일은 Windows Registry Editor의 일반적인 형식에 맞춰 UTF-16 LE로 저장하고, 그 밖의 새 파일은 UTF-8로 저장한다.

## 현재 형식군

| 형식군 | 제품 지원 형식 | 형식별 표시 |
| --- | --- | --- |
| 문서·번역 | 텍스트, Markdown, Gettext PO/POT, LOG | Markdown 구조, PO 원문·번역·문맥·플래그·미번역 상태, 로그 시간·심각도 |
| 구조화 데이터·설정 | JSON/JSONC/JSON Lines, XML, YAML, TOML, INI/CFG, CONF, Properties, ENV | 키·값·중첩 구조, XML 태그·속성·엔터티·CDATA, 섹션·주석과 오류 위치 |
| 운영체제 설정 | Windows REG, OpenSSH 설정, systemd 단위 파일, hosts | 레지스트리 경로·형식·16진수, SSH 호스트 패턴·지시어, systemd 섹션·지정자, IP·호스트 매핑 |
| 버전 관리·작업 공간 | Git ignore/attributes/config/message/mailmap/blame 목록, 일반 ignore 규칙, EditorConfig, npmrc, Docker ignore, CODEOWNERS | 패턴·반전 규칙·속성·담당자, 커밋 제목·트레일러, 신원·객체 ID, 섹션·키·값 |
| 표 | CSV, TSV | 셀 편집, 머리글·행 번호, 행·열 추가·제거·이동 |
| 자막·가사 | SRT, WebVTT, LRC | 큐·시간·메타데이터·대사와 시간 오류 |

정확한 34개 형식 식별자, 63개 확장자, 파일명·경로 패턴과 대표 샘플은 `supported-text-formats.json`이 유일한 목록이다.

## 전용 표시 기준

- XML은 요소 이름, 속성, 문자열, 엔터티, 처리 지시, 주석, CDATA를 구분하고 태그 중첩을 검사한다.
- PO/POT는 `msgid`와 `msgstr` 줄에 서로 다른 강조선을 사용한다. 실제로 비어 있는 번역은 주황색 상태로 표시하되, 헤더와 여러 줄 번역의 시작 `msgstr ""`은 미번역으로 오인하지 않는다.
- Git 커밋 메시지는 첫 유효 줄을 제목으로 강조하고 `Signed-off-by` 같은 트레일러와 Git 정리 주석을 구분한다. 제목 길이 권고는 문법 오류로 취급하지 않는다.
- REG는 가져오기 동작을 수행하지 않는다. 텍스트만 편집하며 헤더, 키 경로, 값 이름, 데이터 형식, 여러 줄 16진수 데이터를 구분한다.
- OpenSSH와 systemd는 알려진 지시어 목록을 고정해 새 지시어를 거부하지 않는다. 섹션·대입 구조, 값 누락, 닫히지 않은 따옴표와 연속 줄처럼 명백한 오류만 검사한다.
- hosts는 IPv4/IPv6 주소와 별칭을 구분한다. 주석과 간격은 그대로 보존한다.

## 아직 전용 지원하지 않는 텍스트 형식

아래 파일도 지원 인코딩이라면 `모든 파일` 필터로 원문 편집할 수 있다. 다만 중앙 등록, 전용 렌더 표시, 문법 진단, 저장 필터와 Windows 연결까지 갖춘 제품 지원 형식은 아니다.

| 범위 | 예 | 현재 경계 |
| --- | --- | --- |
| 추가 버전 관리·배포 규칙 | `.hgignore`, `.p4ignore`, `.cfignore`, `.slugignore` | 도구마다 패턴 지시어와 포함 규칙이 달라 일반 ignore 파서로 같은 형식인 것처럼 처리하지 않는다. |
| 확장자 없는 다중 문법 설정 | `.prettierrc`, `.eslintrc`, `.stylelintrc`, `.babelrc` | JSON 원문은 내용 판별로 JSON 렌더링할 수 있지만, 같은 파일명이 YAML 등도 허용하므로 파일명만으로 고정하지 않는다. |
| 운영체제·서버 설정 | `.htaccess`, `fstab`, `sudoers`, `crontab`, `.desktop` | 잘못된 자동 진단의 영향이 크므로 각 형식의 실제 문법과 안전 경계를 별도로 설계해야 한다. |
| 문서·교환 형식 | reStructuredText, AsciiDoc, Org, DIFF/PATCH, ICS/VCF, EML | 원문 편집은 가능하지만 형식별 구조 표시와 진단은 아직 없다. |
| 실행 가능한 선언형 파일 | Dockerfile, Makefile, Justfile, Procfile, Caddyfile | 명령 실행 의미가 있는 코드형 DSL이므로 이번 비프로그래밍 언어 지원 범위에서는 제외한다. |
| 추가 인코딩 | UTF-32, BOM 없는 UTF-16, ANSI·시스템 코드 페이지 | 추측 디코딩으로 원문을 손상시키지 않도록 자동 판별하지 않는다. |

## 의도적으로 제외한 형식

- C, C++, C#, JavaScript, TypeScript, Python, Rust, Java 같은 프로그래밍 언어 소스.
- DOCX, XLSX, PDF, 이미지, 압축 파일과 같은 바이너리·컨테이너 형식.
- 바이너리일 수 있는 Apple plist, Windows Registry hive, Git pack/index처럼 텍스트 여부를 확정할 수 없는 형식.
- SVG처럼 원문 편집과 시각 결과 미리보기를 함께 설계해야 형식 고유 지원이라고 할 수 있는 그래픽 형식.
- `.git/index`, `packed-refs`, reflog처럼 사용자가 일반적으로 직접 편집하지 않는 생성 데이터.

위 제외 범위의 파일도 지원 인코딩의 텍스트라면 `모든 파일` 필터로 원문을 열 수 있지만, 전용 형식으로 판별하거나 Windows 연결 후보에 등록하지 않는다.

## 검증

- `npm run validate:formats`: 중앙 목록, 샘플, Tauri 연결과 MSI 기본 앱 후보의 정확한 일치.
- `npm run test:formats`: 모든 샘플의 형식 판별, 원문 재구성, 필수 토큰, 유효 샘플의 invalid 토큰 부재, 대표 오류 위치와 파일명·경로 판별.
- `npm run check`: 위 검사와 Svelte/TypeScript 검사.
- 앱 내용이 바뀐 작업은 `npm run tauri:build:signed`로 실행 파일, MSI, NSIS와 두 서명을 새로 만든다.
