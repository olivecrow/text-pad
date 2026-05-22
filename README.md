# 📄 text-pad (Tauri + SvelteKit Desktop Text Editor)

`text-pad`는 Tauri 2.0과 SvelteKit, TypeScript를 결합하여 개발한 **초경량 메모장형 데스크톱 텍스트 에디터**입니다.  
가볍고 빠른 시동 성능과 더불어, 130만 자(1.3MB+) 이상의 대형 파일도 버벅임 없이 실시간으로 편집 및 스크롤할 수 있도록 성능에 초점을 맞추어 설계되었습니다.

---

## ✨ 주요 기능 (Key Features)
* **메모장 스타일 GUI**: 불필요한 장식을 배제하고 `파일(F)` 및 `편집(E)`의 컴팩트 드롭다운 메뉴 배치.
* **초고속 대용량 텍스트 처리**: Chromium WebView2 및 HTML `<textarea>` 최적화를 통해 대형 파일 로드 및 타이핑 지연 시간 0ms 확보.
* **글꼴 설정 (⚙️)**: 상단 툴바 우측의 ⚙️ 아이콘 클릭 시, 에디터의 폰트 크기(기본값 11pt)를 자유롭게 변경 가능.
* **단축키 및 편의 기능**:
  * `Ctrl + N` (새 파일), `Ctrl + O` (열기), `Ctrl + S` (저장), `Ctrl + Shift + S` (다른 이름으로 저장)
  * `F5`: 커서 위치에 현재 날짜/시간 즉시 삽입
  * 파일 로드 시 스크롤바 원점(`scrollTop = 0, scrollLeft = 0`) 강제 초기화
* **실시간 상태 메타데이터**: 우측 하단 상태바에 실시간 커서 행/열 위치(`Ln X, Col Y`) 표시 및 인코딩/줄바꿈 포맷 정보 제공.

---

## 🚀 실행 및 빌드 방법 (How to Run)

### 로컬 개발 서버 실행
```bash
npm run tauri dev
```

### 프로덕션 패키지 빌드
```bash
npm run tauri build
```
*빌드가 완료되면 `src-tauri/target/release/` 폴더에 무설치 실행 파일(`tauri-app.exe`) 및 설치 파일(MSI, NSIS)이 생성됩니다.*

### 단독 실행 (바로가기)
프로젝트 루트 디렉토리에 위치한 **[text-pad.lnk](file:///c:/Users/olive/Desktop/Development/text-pad/text-pad.lnk)** 바로가기를 더블 클릭하면 백그라운드 개발 서버 및 디버그 콘솔창 없이 독립 실행형 패키지로 깔끔하게 기동됩니다.

---

## ⚠️ 미해결 문제 (Known / Unresolved Issues)

### 📌 Windows WebView2 가로 마우스 휠(Tilt Wheel) 스크롤 미작동 문제
* **버그 현상**: 일부 Windows 환경에서 마우스 가로 휠(Tilt Wheel) 또는 정밀 터치패드로 가로 스크롤 조작 시, 브라우저가 넘겨받는 `wheel` 이벤트의 `deltaX` 값이 아예 **`0`**으로 고정되어 물리적인 가로 스크롤이 작동하지 않는 WebView2 고유의 버그가 존재합니다.
* **현재까지의 우회 구현 내역**:
  1. Rust 백엔드 레벨에서 Windows API 서브클래싱(WndProc)을 활용해 OS 수준의 가로 마우스 휠 메시지(`WM_MOUSEHWHEEL: 0x020E`)를 직접 후킹 및 델타 값 추출 ([lib.rs](file:///c:/Users/olive/Desktop/Development/text-pad/src-tauri/src/lib.rs#L22-L104)).
  2. 추출된 델타 값을 Tauri Event(`native-horizontal-wheel`)를 통해 프론트엔드로 emit 처리.
  3. 프론트엔드 Svelte 단에서 이벤트를 리스닝하여 `textareaEl.scrollLeft += delta`로 가로 스크롤바 좌표를 강제로 수동 가산하도록 우회 조치 ([page.svelte](file:///c:/Users/olive/Desktop/Development/text-pad/src/routes/+page.svelte#L399-L415)).
  4. 마우스에 가로 휠이 없는 사용자를 위해 `Shift + 세로 휠(deltaY)` 조합을 가로 스크롤로 유도하는 대체 입력 조작 탑재.
* **미해결 상태 및 디버깅 필요 사유**: 
  위와 같이 OS 메시지를 후킹하여 가로채는 솔루션을 구현하였으나, **여전히 특정 마우스 하드웨어, 드라이버 유틸리티 또는 일부 노트북 터치패드 환경에서 가로 휠/가로 스크롤이 정상적으로 트리거되거나 반영되지 않는 현상이 해결되지 않은 채 남아 있습니다.** 추가적인 가로 휠 메시지 전파 경로 추적 및 드라이버 의존성 디버깅이 필요한 상태입니다.
