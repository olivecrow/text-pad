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
