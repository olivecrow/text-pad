<script lang="ts">
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";

  let filePath = $state<string | null>(null);
  let fileName = $state<string>("제목 없음");
  let fileContent = $state<string>("");
  let isDirty = $state<boolean>(false);
  let isLoading = $state<boolean>(false);
  let errorMsg = $state<string | null>(null);

  // 커서 상태 추적
  let cursorLine = $state<number>(1);
  let cursorCol = $state<number>(1);

  // 메뉴 및 설정 상태 추적
  let openDropdown = $state<'file' | 'edit' | null>(null);
  let showSettings = $state<boolean>(false);
  let fontSize = $state<number>(11); // 기본 폰트 크기 11pt

  let textareaEl = $state<HTMLTextAreaElement | null>(null);

  // 반응형 상태
  let lineCount = $derived(fileContent.split(/\r?\n/).length);
  let charCount = $derived(fileContent.length);

  // 창 제목 동기화 (Rune Effect)
  $effect(() => {
    const appWindow = getCurrentWindow();
    const title = `${isDirty ? "*" : ""}${fileName} - 메모장`;
    appWindow.setTitle(title).catch(() => {});
  });

  // 커서 위치 업데이트
  function updateCursorPosition() {
    if (!textareaEl) return;
    const pos = textareaEl.selectionStart;
    const textBeforeCursor = fileContent.substring(0, pos);
    const linesBefore = textBeforeCursor.split(/\r?\n/);
    cursorLine = linesBefore.length;
    cursorCol = linesBefore[linesBefore.length - 1].length + 1;
  }

  // 변경 감지
  function handleInput() {
    isDirty = true;
    errorMsg = null;
    updateCursorPosition();
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
    closeAllDropdown();
    
    // 스크롤 및 선택 영역 초기화
    setTimeout(() => {
      if (textareaEl) {
        textareaEl.focus();
        textareaEl.selectionStart = textareaEl.selectionEnd = 0;
        textareaEl.scrollTop = 0;
        textareaEl.scrollLeft = 0;
        updateCursorPosition();
      }
    }, 50);
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
      closeAllDropdown();
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
      // 스크롤 및 선택 영역 0,0 초기화
      setTimeout(() => {
        if (textareaEl) {
          textareaEl.focus();
          textareaEl.selectionStart = textareaEl.selectionEnd = 0;
          textareaEl.scrollTop = 0;
          textareaEl.scrollLeft = 0;
          updateCursorPosition();
        }
      }, 50);
    }
  }

  // 파일 저장
  async function handleSaveFile() {
    try {
      isLoading = true;
      errorMsg = null;
      closeAllDropdown();

      let targetPath = filePath;

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
          return;
        }
        targetPath = selected;
      }

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

  // 다른 이름으로 저장
  async function handleSaveAsFile() {
    try {
      isLoading = true;
      errorMsg = null;
      closeAllDropdown();

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
        return;
      }

      await invoke("write_file_content", { path: selected, content: fileContent });
      filePath = selected;
      const parts = selected.split(/[/\\]/);
      fileName = parts[parts.length - 1] || selected;
      isDirty = false;
    } catch (err: any) {
      errorMsg = typeof err === "string" ? err : err.message || String(err);
    } finally {
      isLoading = false;
    }
  }

  // 앱 종료
  function handleExit() {
    if (isDirty) {
      const confirmDiscard = confirm("저장되지 않은 변경 사항이 있습니다. 정말 종료하시겠습니까?");
      if (!confirmDiscard) return;
    }
    getCurrentWindow().close().catch(() => {});
  }

  // 메뉴 제어
  function toggleDropdown(menu: 'file' | 'edit', event: MouseEvent) {
    event.stopPropagation();
    if (openDropdown === menu) {
      openDropdown = null;
    } else {
      openDropdown = menu;
    }
  }

  function handleMouseEnter(menu: 'file' | 'edit') {
    if (openDropdown !== null) {
      openDropdown = menu;
    }
  }

  function closeAllDropdown() {
    openDropdown = null;
  }

  // 날짜/시간 삽입 (F5)
  function insertDateTime() {
    if (!textareaEl) return;
    const start = textareaEl.selectionStart;
    const end = textareaEl.selectionEnd;
    const now = new Date();
    
    const timeStr = now.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', hour12: true });
    const dateStr = now.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
      .replace(/\. /g, '-').replace(/\./g, '');
      
    const formatted = `${timeStr} ${dateStr}`;
    
    const before = fileContent.substring(0, start);
    const after = fileContent.substring(end);
    fileContent = before + formatted + after;
    isDirty = true;
    
    closeAllDropdown();
    
    setTimeout(() => {
      if (textareaEl) {
        textareaEl.focus();
        textareaEl.selectionStart = textareaEl.selectionEnd = start + formatted.length;
        updateCursorPosition();
      }
    }, 0);
  }

  // 편집 메뉴 액션들
  function handleUndo() {
    if (textareaEl) {
      textareaEl.focus();
      document.execCommand('undo');
    }
    closeAllDropdown();
  }

  // 다시 실행
  function handleRedo() {
    if (textareaEl) {
      textareaEl.focus();
      document.execCommand('redo');
    }
    closeAllDropdown();
  }

  async function handleCut() {
    if (!textareaEl) return;
    const start = textareaEl.selectionStart;
    const end = textareaEl.selectionEnd;
    if (start === end) return;
    
    const selectedText = fileContent.substring(start, end);
    await navigator.clipboard.writeText(selectedText);
    
    const before = fileContent.substring(0, start);
    const after = fileContent.substring(end);
    fileContent = before + after;
    isDirty = true;
    
    closeAllDropdown();
    setTimeout(() => {
      if (textareaEl) {
        textareaEl.focus();
        textareaEl.selectionStart = textareaEl.selectionEnd = start;
        updateCursorPosition();
      }
    }, 0);
  }

  async function handleCopy() {
    if (!textareaEl) return;
    const start = textareaEl.selectionStart;
    const end = textareaEl.selectionEnd;
    if (start === end) return;
    
    const selectedText = fileContent.substring(start, end);
    await navigator.clipboard.writeText(selectedText);
    closeAllDropdown();
  }

  async function handlePaste() {
    if (!textareaEl) return;
    try {
      const text = await navigator.clipboard.readText();
      const start = textareaEl.selectionStart;
      const end = textareaEl.selectionEnd;
      
      const before = fileContent.substring(0, start);
      const after = fileContent.substring(end);
      fileContent = before + text + after;
      isDirty = true;
      
      closeAllDropdown();
      setTimeout(() => {
        if (textareaEl) {
          textareaEl.focus();
          textareaEl.selectionStart = textareaEl.selectionEnd = start + text.length;
          updateCursorPosition();
        }
      }, 0);
    } catch (err) {
      console.error(err);
    }
  }

  function handleDelete() {
    if (!textareaEl) return;
    const start = textareaEl.selectionStart;
    const end = textareaEl.selectionEnd;
    let newCursorPos = start;

    if (start === end) {
      const before = fileContent.substring(0, start);
      const after = fileContent.substring(start + 1);
      fileContent = before + after;
    } else {
      const before = fileContent.substring(0, start);
      const after = fileContent.substring(end);
      fileContent = before + after;
    }
    isDirty = true;
    
    closeAllDropdown();
    setTimeout(() => {
      if (textareaEl) {
        textareaEl.focus();
        textareaEl.selectionStart = textareaEl.selectionEnd = newCursorPos;
        updateCursorPosition();
      }
    }, 0);
  }

  function handleSelectAll() {
    if (textareaEl) {
      textareaEl.focus();
      textareaEl.select();
      updateCursorPosition();
    }
    closeAllDropdown();
  }

  // 마우스 가로 휠 및 Shift + 마우스 세로 휠 가로 스크롤 지원
  function handleWheel(e: WheelEvent) {
    if (!textareaEl) return;
    
    // deltaX가 존재하면 가로 휠 입력이 있는 것임
    if (e.deltaX !== 0) {
      textareaEl.scrollLeft += e.deltaX;
      e.preventDefault();
    } 
    // Shift 키를 누르고 세로 휠을 돌릴 때 가로 스크롤 매핑
    else if (e.shiftKey && e.deltaY !== 0) {
      textareaEl.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }

  // 글로벌 키보드 단축키 감지
  function handleKeyDown(e: KeyboardEvent) {
    if (e.ctrlKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      handleNewFile();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      handleOpenFile();
    } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      handleSaveFile();
    } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      handleSaveAsFile();
    } else if (e.key === 'F5') {
      e.preventDefault();
      insertDateTime();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} onclick={closeAllDropdown} />

<div class="app-container">
  <!-- 메뉴바 영역 -->
  <nav class="menu-bar">
    <div class="menu-left">
      <div class="menu-item-container">
        <button 
          class="menu-trigger" 
          class:active={openDropdown === 'file'}
          onclick={(e) => toggleDropdown('file', e)}
          onmouseenter={() => handleMouseEnter('file')}
        >
          파일(F)
        </button>
        {#if openDropdown === 'file'}
          <div class="dropdown-menu" onclick={(e) => e.stopPropagation()}>
            <button class="dropdown-item" onclick={handleNewFile}>
              <span class="item-label">새 파일</span>
              <span class="shortcut-label">Ctrl+N</span>
            </button>
            <button class="dropdown-item" onclick={handleOpenFile}>
              <span class="item-label">열기...</span>
              <span class="shortcut-label">Ctrl+O</span>
            </button>
            <button class="dropdown-item" onclick={handleSaveFile}>
              <span class="item-label">저장</span>
              <span class="shortcut-label">Ctrl+S</span>
            </button>
            <button class="dropdown-item" onclick={handleSaveAsFile}>
              <span class="item-label">다른 이름으로 저장...</span>
              <span class="shortcut-label">Ctrl+Shift+S</span>
            </button>
            <div class="menu-divider"></div>
            <button class="dropdown-item" onclick={handleExit}>
              <span class="item-label">끝내기</span>
              <span class="shortcut-label">Alt+F4</span>
            </button>
          </div>
        {/if}
      </div>

      <div class="menu-item-container">
        <button 
          class="menu-trigger" 
          class:active={openDropdown === 'edit'}
          onclick={(e) => toggleDropdown('edit', e)}
          onmouseenter={() => handleMouseEnter('edit')}
        >
          편집(E)
        </button>
        {#if openDropdown === 'edit'}
          <div class="dropdown-menu" onclick={(e) => e.stopPropagation()}>
            <button class="dropdown-item" onclick={handleUndo}>
              <span class="item-label">실행 취소</span>
              <span class="shortcut-label">Ctrl+Z</span>
            </button>
            <button class="dropdown-item" onclick={handleRedo}>
              <span class="item-label">다시 실행</span>
              <span class="shortcut-label">Ctrl+Y</span>
            </button>
            <div class="menu-divider"></div>
            <button class="dropdown-item" onclick={handleCut} disabled={!fileContent}>
              <span class="item-label">잘라내기</span>
              <span class="shortcut-label">Ctrl+X</span>
            </button>
            <button class="dropdown-item" onclick={handleCopy} disabled={!fileContent}>
              <span class="item-label">복사</span>
              <span class="shortcut-label">Ctrl+C</span>
            </button>
            <button class="dropdown-item" onclick={handlePaste}>
              <span class="item-label">붙여넣기</span>
              <span class="shortcut-label">Ctrl+V</span>
            </button>
            <button class="dropdown-item" onclick={handleDelete} disabled={!fileContent}>
              <span class="item-label">삭제</span>
              <span class="shortcut-label">Del</span>
            </button>
            <div class="menu-divider"></div>
            <button class="dropdown-item" onclick={handleSelectAll}>
              <span class="item-label">모두 선택</span>
              <span class="shortcut-label">Ctrl+A</span>
            </button>
            <button class="dropdown-item" onclick={insertDateTime}>
              <span class="item-label">시간/날짜</span>
              <span class="shortcut-label">F5</span>
            </button>
          </div>
        {/if}
      </div>

      <!-- 에러 표시 간소화 -->
      {#if errorMsg}
        <div class="menu-error-indicator" title={errorMsg}>⚠️ {errorMsg}</div>
      {/if}
    </div>

    <!-- 우측 설정 톱니바퀴 버튼 -->
    <div class="menu-right">
      <button 
        class="settings-trigger" 
        class:active={showSettings}
        onclick={(e) => { e.stopPropagation(); showSettings = !showSettings; }} 
        title="설정"
      >
        ⚙️
      </button>
    </div>
  </nav>

  <!-- 편집 공간 -->
  <main class="editor-area">
    <textarea
      bind:this={textareaEl}
      class="editor-textarea"
      style="font-size: {fontSize}pt;"
      bind:value={fileContent}
      oninput={handleInput}
      onkeyup={updateCursorPosition}
      onclick={updateCursorPosition}
      onfocus={updateCursorPosition}
      onwheel={handleWheel}
      spellcheck="false"
    ></textarea>

    <!-- 설정 창 오버레이 (Fluent Style Modal) -->
    {#if showSettings}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="settings-overlay" onclick={() => showSettings = false}>
        <div class="settings-modal" onclick={(e) => e.stopPropagation()}>
          <div class="settings-header">
            <h3>설정</h3>
            <button class="settings-close" onclick={() => showSettings = false}>&times;</button>
          </div>
          <div class="settings-content">
            <div class="settings-row">
              <label for="font-size-input">글꼴 크기 (pt)</label>
              <div class="size-control">
                <input 
                  id="font-size-input"
                  type="number" 
                  min="6" 
                  max="72" 
                  bind:value={fontSize} 
                  class="font-size-num"
                />
                <button class="adjust-btn" onclick={() => fontSize = Math.max(6, fontSize - 1)}>-</button>
                <button class="adjust-btn" onclick={() => fontSize = Math.min(72, fontSize + 1)}>+</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    {/if}
  </main>

  <!-- 하단 상태 표시줄 -->
  <footer class="status-bar">
    <div class="status-left">
      {#if filePath}
        <span class="file-path" title={filePath}>{filePath}</span>
      {/if}
    </div>
    <div class="status-right">
      <span class="status-item">Ln {cursorLine}, Col {cursorCol}</span>
      <span class="status-item">100%</span>
      <span class="status-item">Windows (CRLF)</span>
      <span class="status-item">UTF-8</span>
    </div>
  </footer>
</div>

<style>
  :global(:root) {
    /* Windows 11 Fluent Notepad Light/Dark CSS variables */
    --font-notepad: "Consolas", "Courier New", "Malgun Gothic", monospace;
    --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic", sans-serif;
    
    /* 기본은 시스템 다크/라이트 자동 지원 */
    --bg-window: #f3f3f3;
    --bg-editor: #ffffff;
    --bg-menu-hover: #e5e5e5;
    --bg-menu-active: #eaeaea;
    --bg-dropdown: #ffffff;
    --border-color: #e5e5e5;
    --text-color: #1c1c1c;
    --text-muted: #5f5f5f;
    --accent-color: #0078d4;
    --shadow-menu: 0 4px 12px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04);
    
    --bg-modal: #ffffff;
    --bg-overlay: rgba(0, 0, 0, 0.2);
  }

  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --bg-window: #1e1e1e;
      --bg-editor: #1b1b1b;
      --bg-menu-hover: #2d2d2d;
      --bg-menu-active: #323232;
      --bg-dropdown: #2c2c2c;
      --border-color: #2c2c2c;
      --text-color: #e3e3e3;
      --text-muted: #9f9f9f;
      --accent-color: #0078d4;
      --shadow-menu: 0 4px 16px rgba(0, 0, 0, 0.25), 0 2px 4px rgba(0, 0, 0, 0.15);
      
      --bg-modal: #2c2c2c;
      --bg-overlay: rgba(0, 0, 0, 0.4);
    }
  }

  :global(body) {
    margin: 0;
    padding: 0;
    height: 100vh;
    background-color: var(--bg-window);
    overflow: hidden;
    font-family: var(--font-ui);
    color: var(--text-color);
  }

  .app-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    box-sizing: border-box;
  }

  /* 메뉴바 디자인 */
  .menu-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background-color: var(--bg-window);
    height: 32px;
    padding: 0 0.5rem;
    border-bottom: 1px solid var(--border-color);
    user-select: none;
    box-sizing: border-box;
    z-index: 10;
  }

  .menu-left {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    flex: 1;
  }

  .menu-right {
    display: flex;
    align-items: center;
  }

  .menu-item-container {
    position: relative;
  }

  .menu-trigger, .settings-trigger {
    background: transparent;
    border: none;
    color: var(--text-color);
    font-family: var(--font-ui);
    font-size: 0.8rem;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
    border-radius: 4px;
    transition: background-color 0.1s;
    outline: none;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .settings-trigger {
    font-size: 0.95rem;
    padding: 0.2rem 0.4rem;
    margin-right: 0.25rem;
  }

  .menu-trigger:hover, .menu-trigger.active,
  .settings-trigger:hover, .settings-trigger.active {
    background-color: var(--bg-menu-hover);
  }

  /* 드롭다운 메뉴 */
  .dropdown-menu {
    position: absolute;
    top: 100%;
    left: 0;
    background-color: var(--bg-dropdown);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    box-shadow: var(--shadow-menu);
    min-width: 240px;
    padding: 0.25rem;
    display: flex;
    flex-direction: column;
    z-index: 20;
    margin-top: 2px;
  }

  .dropdown-item {
    background: transparent;
    border: none;
    color: var(--text-color);
    font-family: var(--font-ui);
    font-size: 0.8rem;
    padding: 0.35rem 0.75rem;
    text-align: left;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    border-radius: 4px;
    outline: none;
    transition: background-color 0.08s;
  }

  .dropdown-item:hover:not(:disabled) {
    background-color: var(--bg-menu-hover);
  }

  .dropdown-item:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .item-label {
    flex: 1;
  }

  .shortcut-label {
    color: var(--text-muted);
    font-size: 0.75rem;
    margin-left: 1.5rem;
  }

  .menu-divider {
    height: 1px;
    background-color: var(--border-color);
    margin: 0.25rem 0.5rem;
  }

  .menu-error-indicator {
    margin-left: auto;
    font-size: 0.75rem;
    color: #ef4444;
    padding-right: 0.5rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 250px;
  }

  /* 메인 편집기 공간 */
  .editor-area {
    flex: 1;
    background-color: var(--bg-editor);
    overflow: hidden;
    position: relative;
  }

  .editor-textarea {
    width: 100%;
    height: 100%;
    background-color: var(--bg-editor);
    border: none;
    outline: none;
    resize: none;
    color: var(--text-color);
    font-family: var(--font-notepad);
    line-height: 1.5;
    padding: 8px 12px;
    box-sizing: border-box;
    overflow-y: scroll;
    white-space: pre;
    word-wrap: normal;
  }

  /* 설정 팝업 오버레이 */
  .settings-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: var(--bg-overlay);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 30;
  }

  .settings-modal {
    background-color: var(--bg-modal);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    box-shadow: var(--shadow-menu);
    width: 320px;
    padding: 1rem;
    box-sizing: border-box;
    animation: fadeIn 0.15s ease-out;
  }

  .settings-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 0.5rem;
  }

  .settings-header h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .settings-close {
    background: transparent;
    border: none;
    font-size: 1.25rem;
    color: var(--text-muted);
    cursor: pointer;
    outline: none;
  }

  .settings-close:hover {
    color: var(--text-color);
  }

  .settings-content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .settings-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.85rem;
  }

  .size-control {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .font-size-num {
    width: 50px;
    padding: 0.2rem 0.4rem;
    border: 1px solid var(--border-color);
    background-color: var(--bg-editor);
    color: var(--text-color);
    border-radius: 4px;
    font-family: var(--font-ui);
    font-size: 0.85rem;
    text-align: center;
    outline: none;
  }

  .adjust-btn {
    background-color: var(--bg-menu-hover);
    border: 1px solid var(--border-color);
    color: var(--text-color);
    border-radius: 4px;
    width: 26px;
    height: 26px;
    cursor: pointer;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
    outline: none;
  }

  .adjust-btn:hover {
    background-color: var(--bg-menu-active);
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  /* 하단 상태바 */
  .status-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background-color: var(--bg-window);
    height: 24px;
    border-top: 1px solid var(--border-color);
    font-size: 0.75rem;
    color: var(--text-muted);
    user-select: none;
    padding: 0 0.5rem;
    box-sizing: border-box;
  }

  .status-left {
    display: flex;
    align-items: center;
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-path {
    padding-left: 0.25rem;
  }

  .status-right {
    display: flex;
    align-items: center;
    height: 100%;
  }

  .status-item {
    padding: 0 12px;
    border-left: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    height: 100%;
    white-space: nowrap;
  }

  .status-item:first-child {
    border-left: none;
  }
</style>


