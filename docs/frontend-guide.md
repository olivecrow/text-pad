# text-pad 프론트엔드 개발 가이드 (TypeScript / Svelte)

이 문서는 `text-pad` 프로젝트의 프론트엔드 설계 원칙, 컴포넌트 구조, 상태 관리 흐름을 정의하는 AI 참조용 가이드라인입니다.

---

## 1. 프론트엔드 역할 및 핵심 원칙
프론트엔드는 편집기 인스턴스를 관리하고, 원문 모드(Source Mode)와 렌더링 모드(Render Mode) 간의 끊김 없는 전환(Round-trip) 및 반응형 UI를 담당합니다.
1. **단방향 데이터 플로우**: 사용자의 입력은 원시 텍스트(`rawContent`)를 기준으로 갱신되며, 렌더링 모드에서의 편집 작업은 반드시 변환 파이프라인을 거쳐 원본 텍스트를 수정하도록 단방향 흐름을 유지합니다.
2. **동작 및 뷰 동형성 보존**: 모드를 전환하더라도 커서 위치, 스크롤 상태, 텍스트 선택 영역이 적절한 변환 로직을 통해 대상 뷰로 전파되어 화면상에서 동일한 위치를 유지(Sync)해야 합니다.
3. **가상 스크롤 필수 적용**: CSV 그리드 편집이나 대용량 Markdown 렌더링과 같이 DOM 요소가 과다해지는 경우, 스크롤 가상화(Virtualization) 모듈을 통과시켜 렌더링 성능 지연을 방지합니다.

---

## 2. 프로젝트 구조 및 파일 역할 (src/)

```
src/
├── lib/
│   ├── store/
│   │   ├── document.ts         # 열린 문서, 활성 탭 및 Dirty 상태 통합 관리
│   │   └── settings.ts         # 사용자 Preferences (테마, 폰트, 보기 모드)
│   ├── editor/
│   │   ├── CodeMirrorEditor.svelte  # CodeMirror 6 기반 원문 편집 컴포넌트
│   │   └── extensions.ts       # 자동 들여쓰기, 괄호 쌍 맞춤 등 CM6 확장 기능
│   ├── formats/
│   │   ├── txt/                # TXT 파일용 포맷 파서, 렌더러
│   │   ├── markdown/           # Markdown 파서 및 부분 WYSIWYG 렌더러
│   │   ├── json/               # JSON AST 파서 및 트리 뷰 컴포넌트
│   │   ├── csv/                # CSV/TSV 그리드 테이블 컴포넌트
│   │   └── yaml/               # YAML 파서 및 구조화 편집 컴포넌트
│   ├── components/             # 비즈니스 독립적 공통 UI (Tab, Button 등)
│   └── types/
│       └── index.ts            # 공통 인터페이스 선언
├── App.svelte                  # 앱 레이아웃 및 탭 스위칭 메인 엔트리
└── main.ts
```

---

## 3. 상태 관리 (DocumentStore) 설계 규격

문서 상태는 Svelte의 `writable` 스토어를 확장하여 단일 객체 집합으로 관리합니다.

```typescript
import { writable, derived } from 'svelte/store';
import type { DocumentModel } from '../types';

function createDocumentStore() {
  const { subscribe, set, update } = writable<{
    documents: Map<string, DocumentModel>;
    activeId: string | null;
  }>({
    documents: new Map(),
    activeId: null
  });

  return {
    subscribe,
    open: (doc: DocumentModel) => update(state => {
      state.documents.set(doc.id, doc);
      state.activeId = doc.id;
      return state;
    }),
    close: (id: string) => update(state => {
      state.documents.delete(id);
      if (state.activeId === id) {
        const remainingKeys = Array.from(state.documents.keys());
        state.activeId = remainingKeys.length > 0 ? remainingKeys[remainingKeys.length - 1] : null;
      }
      return state;
    }),
    updateContent: (id: string, newContent: string) => update(state => {
      const doc = state.documents.get(id);
      if (doc) {
        doc.rawContent = newContent;
        doc.isDirty = true;
      }
      return state;
    }),
    switchMode: (id: string, mode: 'source' | 'render') => update(state => {
      const doc = state.documents.get(id);
      if (doc) {
        doc.currentMode = mode;
      }
      return state;
    }),
    setActive: (id: string) => update(state => {
      state.activeId = id;
      return state;
    })
  };
}

export const documentStore = createDocumentStore();
export const activeDocument = derived(documentStore, $store => 
  $store.activeId ? $store.documents.get($store.activeId) : null
);
```

---

## 4. 포맷별 라운드트립(Round-trip) 구현 규격

새로운 파일 형식을 추가할 때 프론트엔드 포맷 개발자는 다음 네 가지 핵심 기능을 반드시 구현해야 합니다.

1. **Parser**: `string` -> `AST / 구조화 객체`
   - 오류 발생 시 파싱 과정에서 실패 메시지와 해당 라인 번호를 명확하게 리턴하며, 모드 전환을 막지 않고 오류 인터페이스를 띄웁니다.
2. **Renderer**: `AST` -> `Svelte UI`
   - 트리 뷰, 테이블, 마크다운 렌더링 요소를 동적으로 화면에 표시합니다.
3. **Editor Interface**: 사용자 상호작용 -> `AST 수정`
   - 렌더링 모드 내 요소 더블 클릭, 편집 입력 시 내부 AST 구조를 갱신합니다.
4. **Stringifier**: `AST` -> `string (원시 텍스트)`
   - 수정된 구조 데이터를 텍스트로 환원합니다. 이 단계에서 공백(들여쓰기 스타일), 사용하지 않은 원시 키의 순서, 주석 등이 깨지지 않도록 정교하게 재조합해야 합니다.

---

## 5. 렌더 모드 텍스트 렌더링 최적화 및 폰트 설계

렌더 모드에서 웹폰트가 거칠고 딱딱하게 렌더링되는 현상을 방지하기 위해 다음과 같은 설계 및 스타일 규칙을 적용합니다.

1. **텍스트 안티앨리어싱 및 ClearType 최적화**:
   - WebView2(Chromium) 렌더링 환경에서 코딩용 고정폭 폰트가 자글자글하거나 날카롭게 튀는 현상을 막기 위해 CSS `text-rendering` 속성을 `optimizeLegibility`로 설정합니다.
   - `-webkit-font-smoothing: antialiased`는 글자를 얇고 자글자글하게 만드는 Gray-scale 안티앨리어싱을 강제하므로, 이를 배제하고 **`-webkit-font-smoothing: subpixel-antialiased;`** 및 **`-moz-osx-font-smoothing: auto;`**를 지정하여 Windows OS의 ClearType 서브픽셀 가독성 기술이 완벽히 작동하도록 합니다.
2. **동적 줄 높이 측정 및 Gutter 정렬**:
   - 렌더 모드 폰트가 변경되면 줄 높이 실측 로직(`measureLineHeight()`)이 즉시 반응하여 줄 높이를 갱신합니다. 이를 통해 라인 번호 Gutter, 배경 들여쓰기 가이드라인, 실제 textarea의 캐럿 및 텍스트 선택(드래그) 영역의 Y축 좌표 정밀도를 100% 동기화합니다.
3. **가독성 폰트 두께 설정**:
   - 힌팅 격자가 깨져 자글자글해지는 정수 미만 굵기(`450` 등) 대신, 표준 굵기인 **`font-weight: normal;`** (400) 또는 **`500`**과 같이 힌팅 데이터가 내장된 정수 굵기를 일관되게 사용하여 부드럽고 가독성 높은 윤곽선을 유지합니다. 렌더 모드 텍스트와 textarea 텍스트 양쪽에 동일하게 적용하여 자간 너비의 완전 동치성을 확보합니다.
4. **글꼴 선택지 확장 및 웹폰트 내장**:
   - 구글 CDN을 통해 수신하는 `JetBrains Mono` (추천), `Fira Code`, `Roboto Mono` 외에 한글/영어 고정폭 매칭이 완벽한 네이버의 `D2Coding`을 공식 웹폰트 CDN으로 추가 로드하여 사용자의 로컬 환경에 구애받지 않고 언제나 깨끗하고 아름다운 코딩 글꼴을 선택할 수 있도록 지원합니다.

---

## 6. 독립 설정창 윈도우 동기화 및 404 라우팅 해결 규격

데스크톱 앱의 시용성 증대를 위해 설정 화면을 독립된 네이티브 윈도우로 분리하여 구동하며, 다음과 같은 웹뷰 경로 통제 및 동기화 기술 규격을 적용합니다.

1. **404 라우팅 방지 (Origin & Label 바인딩)**:
   - SvelteKit 정적 어댑터의 SPA 제약 및 Tauri 로컬 프로토콜의 경로 매핑 오류를 우회하기 위해, 설정창 생성 시 URL을 `window.location.origin + '/'`로 지정하여 항상 안전하게 메인 엔트리 포인트를 로드하게 유도합니다.
   - Svelte 마운트 런타임에 윈도우의 고유 라벨(`getCurrentWindow().label === 'settings'`)을 감지하여 쿼리 스트링이나 특정 상대 HTML 경로 없이도 즉각 설정 전용 컨테이너로 분기 렌더링을 처리합니다.
2. **다중 창 간 상태 동기화 (Storage Event)**:
   - 설정 윈도우에서 폰트 크기, 종류, 혹은 구문 강조 색상을 수정하면 `localStorage`에 즉시 반영됩니다.
   - 메인 편집기 윈도우는 브라우저 `storage` 이벤트를 실시간 리스닝하여 사용자의 Preferences를 즉각 동기화 적용하고, `$effect`를 통해 실측 높이를 재계산하여 화면 깨짐 현상을 차단합니다.
3. **사용자 환경 마이그레이션**:
   - 다크 모드 등 기본 구문 강조 색상 변경이 배포될 경우, 사용자가 커스텀해 둔 고유 설정은 해치지 않으면서도 로컬 스토리지에 남아있던 구버전 기본 색상만 감지하여 새 기본 강조색으로 자동 교체해주는 마이그레이션 코드를 적용합니다.

---

## 7. 3종 괄호 중첩 트리 파서 및 재귀 렌더러 설계

TXT 파일 형식의 가독성을 극대화하기 위해 소괄호 `()`, 대괄호 `[]`, 중괄호 `{}` 및 이에 감싸진 텍스트 전체를 안쪽에서 바깥쪽으로 계층 강조 렌더링하기 위한 파이프라인을 구축합니다.

1. **트리 토크나이저 (AST 구축)**:
   - 단순 정규식 분리 방식 대신 스택(Stack)을 기반으로 한 컨테이너 트리 노드 생성 알고리즘(`tokenizeLine()`)을 구현합니다.
   - 괄호가 시작되면 새 컨테이너를 스택에 `push`하고 내부 토큰을 자식으로 할당하며, 닫는 괄호를 만나면 스택 최상단에 근접한 일치하는 괄호 컨테이너까지 닫아 구조화된 AST 배열을 형성합니다.
   - 따옴표 내부에서도 이스케이프 문자(`\`)를 처리하며 괄호 및 다른 따옴표가 중첩되어 안전하게 파싱되도록 방어 조치합니다.
2. **Svelte 5 Snippet 재귀 렌더러**:
   - Svelte 5의 재귀적 코드 스니펫(`{#snippet renderToken(token)}`)을 정의하여, 자식 토큰 목록을 보유한 괄호 컨테이너를 깊이 제한 없이 DOM 상에 계층적으로 중첩 출력합니다.
3. **자간 및 드래그 선택 영역 동치 보존**:
   - `white-space: pre`가 할당된 코드 영역 내의 Svelte Snippet 재귀 루프 사이에서 줄바꿈이나 공백 문자가 불필요하게 브라우저 화면에 렌더링되면 텍스트 선택(드래그) 영역이 어긋나게 됩니다.
   - 이를 차단하기 위해 Snippet 선언부와 출력 마크업 내의 모든 HTML 개행을 제거한 극단적인 **단일 인라인 라인 형태**로 조밀하게 패키징 렌더링해야 합니다.
4. **텍스트 스타일 상속**:
   - 중첩 괄호 내의 일반 텍스트 노드는 CSS `color: inherit;`을 상속받아 부모 괄호의 강조색으로 전체 칠해지며, 그 안의 특수 패턴(숫자, 따옴표 등)은 하부의 고유 색상 클래스가 덮어씌워 렌더링되는 계층적 캐스케이딩을 유지합니다.
