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
