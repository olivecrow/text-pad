<script lang="ts">
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { invoke } from "@tauri-apps/api/core";

  let filePath = $state<string | null>(null);
  let fileName = $state<string>("제목 없음");
  let fileContent = $state<string>("");
  let isDirty = $state<boolean>(false);
  let isLoading = $state<boolean>(false);
  let errorMsg = $state<string | null>(null);

  // 스크롤 동기화를 위한 DOM 바인딩
  let gutterEl = $state<HTMLElement | null>(null);
  let textareaEl = $state<HTMLTextAreaElement | null>(null);

  // 반응형 파생 상태 (Rune)
  let lines = $derived(fileContent.split(/\r?\n/));
  let lineCount = $derived(lines.length === 0 ? 1 : lines.length);
  let charCount = $derived(fileContent.length);

  function syncScroll() {
    if (gutterEl && textareaEl) {
      gutterEl.scrollTop = textareaEl.scrollTop;
    }
  }

  // 변경 감지
  function handleInput() {
    isDirty = true;
    errorMsg = null;
    // 입력 시 비동기로 스크롤 높이가 변경될 수 있으므로 동기화 시도
    setTimeout(syncScroll, 0);
  }

  // 새 파일 생성
  function handleNewFile() {
    if (isDirty) {
      const confirmDiscard = confirm("저장되지 않은 변경 사항이 있습니다. 무시하고 새 파일을 만드시겠습니까?");
      if (!confirmDiscard) return;
    }
    filePath = null;
    fileName = "제목 없음";
    fileContent = "";
    isDirty = false;
    errorMsg = null;
  }

  // 파일 열기
  async function handleOpenFile() {
    if (isDirty) {
      const confirmDiscard = confirm("저장되지 않은 변경 사항이 있습니다. 무시하고 다른 파일을 여시겠습니까?");
      if (!confirmDiscard) return;
    }

    try {
      isLoading = true;
      errorMsg = null;
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "Text Files",
            extensions: ["txt", "md", "json", "csv", "tsv", "yaml", "yml", "ini", "cfg", "log", "js", "ts", "rs", "html", "css"]
          }
        ]
      });

      if (selected && typeof selected === "string") {
        filePath = selected;
        const parts = selected.split(/[/\\]/);
        fileName = parts[parts.length - 1] || selected;

        const content = await invoke<string>("read_file_content", { path: selected });
        fileContent = content;
        isDirty = false;
      }
    } catch (err: any) {
      errorMsg = typeof err === "string" ? err : err.message || String(err);
    } finally {
      isLoading = false;
      setTimeout(syncScroll, 50);
    }
  }

  // 파일 저장
  async function handleSaveFile() {
    try {
      isLoading = true;
      errorMsg = null;

      let targetPath = filePath;

      // 경로가 없으면 '새 이름으로 저장' 다이얼로그 호출
      if (!targetPath) {
        const selected = await save({
          filters: [
            {
              name: "Text Files",
              extensions: ["txt"]
            }
          ]
        });
        if (!selected) {
          isLoading = false;
          return; // 취소됨
        }
        targetPath = selected;
      }

      // Rust 백엔드 저장 커맨드 호출
      await invoke("write_file_content", { path: targetPath, content: fileContent });
      
      filePath = targetPath;
      const parts = targetPath.split(/[/\\]/);
      fileName = parts[parts.length - 1] || targetPath;
      isDirty = false;
    } catch (err: any) {
      errorMsg = typeof err === "string" ? err : err.message || String(err);
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="app-container">
  <!-- 컴팩트 데스크톱 네이티브 스타일 툴바 -->
  <header class="toolbar">
    <div class="toolbar-section left">
      <span class="app-title">text-pad</span>
      <div class="divider"></div>
      <!-- 파일 메뉴 액션 버튼군 -->
      <div class="menu-bar">
        <button class="menu-btn" onclick={handleNewFile} title="새 파일 생성">
          <span class="btn-icon">📄</span> 새 파일
        </button>
        <button class="menu-btn" onclick={handleOpenFile} disabled={isLoading} title="파일 열기">
          <span class="btn-icon">📂</span> 열기
        </button>
        <button class="menu-btn" onclick={handleSaveFile} disabled={isLoading} title="파일 저장">
          <span class="btn-icon">💾</span> 저장
        </button>
      </div>
    </div>

    <!-- 파일 정보 및 저장 상태 -->
    <div class="toolbar-section center">
      <span class="file-name" class:dirty={isDirty}>
        {fileName}{isDirty ? " *" : ""}
      </span>
    </div>

    <div class="toolbar-section right">
      {#if isLoading}
        <span class="status-indicator loading">처리 중...</span>
      {:else if errorMsg}
        <span class="status-indicator error" title={errorMsg}>⚠️ 에러 발생</span>
      {:else}
        <span class="status-indicator text-success">정상</span>
      {/if}
    </div>
  </header>

  <!-- 메인 편집 에어리어 -->
  <main class="editor-area">
    <div class="editor-layout">
      <!-- 줄 번호 Gutter -->
      <div class="editor-gutter" bind:this={gutterEl}>
        {#each lines as _, i}
          <div class="gutter-number">{i + 1}</div>
        {/each}
      </div>

      <!-- 편집 Textarea -->
      <textarea
        bind:this={textareaEl}
        class="editor-textarea"
        bind:value={fileContent}
        oninput={handleInput}
        onscroll={syncScroll}
        placeholder="여기에 텍스트를 입력하거나 파일을 열어주세요..."
        spellcheck="false"
      ></textarea>
    </div>
  </main>

  <!-- 하단 상태 메타 표시 바 -->
  <footer class="status-bar">
    <div class="status-left">
      {#if filePath}
        <span class="file-path-text" title={filePath}>{filePath}</span>
      {:else}
        <span class="file-path-text italic">저장되지 않은 파일 (로컬 임시 상태)</span>
      {/if}
    </div>
    <div class="status-right">
      <span class="status-meta">UTF-8</span>
      <span class="status-meta">Line {lineCount.toLocaleString()}</span>
      <span class="status-meta">Char {charCount.toLocaleString()}</span>
    </div>
  </footer>
</div>

<style>
  /* 네이티브 앱 느낌의 극초경량 컴팩트 CSS 스타일링 */
  :global(:root) {
    --bg-base: #18181c;            /* 더 부드러운 네이티브 그레이 */
    --bg-toolbar: #1e1e24;         /* 툴바 배경 */
    --bg-gutter: #16161a;          /* 거터 배경 */
    --bg-textarea: #1a1a1f;        /* 입력 공간 배경 */
    --border-color: #2a2a32;        /* 얇고 심플한 경계선 */

    --primary: #3b82f6;
    --primary-hover: #4f4f56;      /* 툴바 버튼용 컴팩트 호버 */
    --text-main: #e3e3e7;          /* 선명한 텍스트 */
    --text-muted: #8e8e93;          /* 어두운 텍스트 */
    --text-success: #10b981;
    --text-error: #ef4444;

    --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --font-mono: "Fira Code", "Courier New", Courier, monospace;

    background-color: var(--bg-base);
    color: var(--text-main);
    font-family: var(--font-ui);
    margin: 0;
    padding: 0;
    overflow: hidden;
    height: 100vh;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    height: 100vh;
    background-color: var(--bg-base);
  }

  .app-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    box-sizing: border-box;
  }

  /* 네이티브 툴바 */
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background-color: var(--bg-toolbar);
    border-bottom: 1px solid var(--border-color);
    height: 38px;                 /* 네이티브 툴바의 컴팩트한 높이 */
    padding: 0 0.75rem;
    box-sizing: border-box;
    user-select: none;
  }

  .toolbar-section {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .toolbar-section.left {
    min-width: 30%;
  }

  .toolbar-section.center {
    justify-content: center;
    max-width: 40%;
  }

  .toolbar-section.right {
    justify-content: flex-end;
    min-width: 30%;
    font-size: 0.8rem;
  }

  .app-title {
    font-size: 0.85rem;
    font-weight: 700;
    color: #60a5fa;
    letter-spacing: -0.01em;
  }

  .divider {
    width: 1px;
    height: 14px;
    background-color: var(--border-color);
    margin: 0 0.25rem;
  }

  .menu-bar {
    display: flex;
    gap: 0.15rem;
  }

  /* 컴팩트 메뉴형 버튼 */
  .menu-btn {
    background: transparent;
    border: none;
    color: var(--text-main);
    font-family: var(--font-ui);
    font-size: 0.8rem;
    font-weight: 500;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    transition: background-color 0.15s;
  }

  .menu-btn:hover {
    background-color: var(--primary-hover);
  }

  .menu-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-icon {
    font-size: 0.85rem;
  }

  /* 파일 이름 표시 */
  .file-name {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-muted);
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    background-color: rgba(0, 0, 0, 0.15);
    border: 1px solid var(--border-color);
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
  }

  .file-name.dirty {
    color: #f59e0b;
    border-color: rgba(245, 158, 11, 0.3);
  }

  /* 상태 표시 */
  .status-indicator {
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    font-size: 0.75rem;
  }

  .status-indicator.loading {
    color: #60a5fa;
  }

  .status-indicator.error {
    color: var(--text-error);
    background-color: rgba(239, 68, 68, 0.1);
  }

  .status-indicator.text-success {
    color: var(--text-success);
  }

  /* 메인 편집 영역 */
  .editor-area {
    flex: 1;
    overflow: hidden;
    position: relative;
    background-color: var(--bg-textarea);
  }

  .editor-layout {
    display: flex;
    width: 100%;
    height: 100%;
    position: relative;
  }

  /* 거터 (줄 번호) */
  .editor-gutter {
    width: 45px;
    padding: 0.75rem 0.25rem 0.75rem 0;
    background-color: var(--bg-gutter);
    border-right: 1px solid var(--border-color);
    color: #4b5563;
    font-family: var(--font-mono);
    font-size: 0.85rem;
    line-height: 1.45;
    text-align: right;
    user-select: none;
    overflow-y: hidden;          /* textarea 스크롤 이벤트에 의해 강제 동기화 */
    box-sizing: border-box;
  }

  .gutter-number {
    height: 1.45rem;             /* textarea 라인 높이와 매칭 */
    padding-right: 0.5rem;
  }

  /* 입력 영역 */
  .editor-textarea {
    flex: 1;
    height: 100%;
    background-color: var(--bg-textarea);
    border: none;
    outline: none;
    resize: none;
    color: #f3f4f6;
    font-family: var(--font-mono);
    font-size: 0.85rem;
    line-height: 1.45;
    padding: 0.75rem 1rem;
    box-sizing: border-box;
    overflow-y: auto;            /* 스크롤바 허용 */
    white-space: pre;            /* 줄바꿈 보존 */
    word-wrap: normal;
  }

  .editor-textarea::placeholder {
    color: #4b5563;
    font-style: italic;
  }

  /* 하단 상태 표시줄 */
  .status-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background-color: var(--bg-toolbar);
    border-top: 1px solid var(--border-color);
    height: 22px;
    padding: 0 0.75rem;
    font-size: 0.75rem;
    color: var(--text-muted);
    user-select: none;
    box-sizing: border-box;
  }

  .status-left {
    display: flex;
    align-items: center;
    max-width: 60%;
  }

  .file-path-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-path-text.italic {
    font-style: italic;
    color: #52525b;
  }

  .status-right {
    display: flex;
    gap: 1rem;
  }

  .status-meta {
    border-left: 1px solid var(--border-color);
    padding-left: 1rem;
  }

  .status-meta:first-child {
    border-left: none;
  }
</style>
