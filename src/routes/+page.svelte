<script lang="ts">
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { listen } from "@tauri-apps/api/event";
  import { PhysicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";

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
  let activeSettingsTab = $state<'source' | 'render'>('render'); // 기본값은 렌더 모드
  
  // 폰트 크기 이원화
  let sourceFontSize = $state<number>(11);
  let renderFontSize = $state<number>(11);
  
  // 렌더 모드 상태
  let isRenderMode = $state<boolean>(true); // 기본값은 렌더 모드
  let currentFontSize = $derived(isRenderMode ? renderFontSize : sourceFontSize);
  let tabSize = $state<number>(4);          // 기본 들여쓰기 탭 4칸
  let scrollTop = $state<number>(0);
  let scrollLeft = $state<number>(0);
  let measuredLineHeight = $state<number>(22);
  let clientHeight = $state<number>(500);

  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let editorViewportEl = $state<HTMLDivElement | null>(null);

  // 렌더 모드 하이라이팅 커스텀 테마 색상 상태 변수
  let colorHlCodeBg = $state<string>('');
  let colorHlCodeText = $state<string>('');
  let colorHlString = $state<string>('');
  let colorHlNumber = $state<string>('');
  let colorHlComment = $state<string>('');
  let colorIndentGuide = $state<string>('');

  // 설정창 드래그 이동 상태 변수
  let settingsX = $state<number>(0);
  let settingsY = $state<number>(0);
  let isDraggingSettings = $state<boolean>(false);
  let isSettingsPositioned = $state<boolean>(false);
  let dragStartX = 0;
  let dragStartY = 0;
  let initialModalX = 0;
  let initialModalY = 0;

  const isBrowser = typeof window !== 'undefined';

  // 시스템 테마별 기본 강조 색상
  function getSystemDefaultColors(isDark: boolean) {
    return isDark ? {
      codeBg: '#26374a',
      codeText: '#4fc1ff',
      string: '#ce9178',
      number: '#b5cea8',
      comment: '#6a9955',
      guide: '#2c2c2c'
    } : {
      codeBg: '#e6f1fc',
      codeText: '#0078d4',
      string: '#a31515',
      number: '#098658',
      comment: '#008000',
      guide: '#e5e5e5'
    };
  }

  // 기본 색상 복원
  function resetColorsToDefault() {
    if (!isBrowser) return;
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const defaults = getSystemDefaultColors(isDark);
    colorHlCodeBg = defaults.codeBg;
    colorHlCodeText = defaults.codeText;
    colorHlString = defaults.string;
    colorHlNumber = defaults.number;
    colorHlComment = defaults.comment;
    colorIndentGuide = defaults.guide;
  }

  // 마운트 시 localStorage Preferences 로드
  $effect(() => {
    if (!isBrowser) return;

    const savedSourceFontSize = localStorage.getItem('pref_source_font_size');
    if (savedSourceFontSize) sourceFontSize = parseInt(savedSourceFontSize, 10);

    const savedRenderFontSize = localStorage.getItem('pref_render_font_size');
    if (savedRenderFontSize) renderFontSize = parseInt(savedRenderFontSize, 10);

    const savedTabSize = localStorage.getItem('pref_tab_size');
    if (savedTabSize) tabSize = parseInt(savedTabSize, 10);

    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const defaults = getSystemDefaultColors(isDark);

    colorHlCodeBg = localStorage.getItem('pref_color_hl_code_bg') || defaults.codeBg;
    colorHlCodeText = localStorage.getItem('pref_color_hl_code_text') || defaults.codeText;
    colorHlString = localStorage.getItem('pref_color_hl_string') || defaults.string;
    colorHlNumber = localStorage.getItem('pref_color_hl_number') || defaults.number;
    colorHlComment = localStorage.getItem('pref_color_hl_comment') || defaults.comment;
    colorIndentGuide = localStorage.getItem('pref_color_indent_guide') || defaults.guide;
  });

  // 상태 변경 감지 자동 로컬스토리지 동기화
  $effect(() => {
    if (isBrowser) localStorage.setItem('pref_source_font_size', sourceFontSize.toString());
  });
  $effect(() => {
    if (isBrowser) localStorage.setItem('pref_render_font_size', renderFontSize.toString());
  });
  $effect(() => {
    if (isBrowser) localStorage.setItem('pref_tab_size', tabSize.toString());
  });
  $effect(() => {
    if (isBrowser && colorHlCodeBg) localStorage.setItem('pref_color_hl_code_bg', colorHlCodeBg);
  });
  $effect(() => {
    if (isBrowser && colorHlCodeText) localStorage.setItem('pref_color_hl_code_text', colorHlCodeText);
  });
  $effect(() => {
    if (isBrowser && colorHlString) localStorage.setItem('pref_color_hl_string', colorHlString);
  });
  $effect(() => {
    if (isBrowser && colorHlNumber) localStorage.setItem('pref_color_hl_number', colorHlNumber);
  });
  $effect(() => {
    if (isBrowser && colorHlComment) localStorage.setItem('pref_color_hl_comment', colorHlComment);
  });
  $effect(() => {
    if (isBrowser && colorIndentGuide) localStorage.setItem('pref_color_indent_guide', colorIndentGuide);
  });

  // 앱 윈도우 크기 및 위치 복원/저장 $effect
  $effect(() => {
    if (!isBrowser) return;

    const restoreWindowState = async () => {
      const appWindow = getCurrentWindow();
      
      const savedWidth = localStorage.getItem('app_window_width');
      const savedHeight = localStorage.getItem('app_window_height');
      if (savedWidth && savedHeight) {
        const w = parseInt(savedWidth, 10);
        const h = parseInt(savedHeight, 10);
        if (w > 200 && h > 200) {
          await appWindow.setSize(new PhysicalSize(w, h)).catch(console.error);
        }
      }

      const savedX = localStorage.getItem('app_window_x');
      const savedY = localStorage.getItem('app_window_y');
      if (savedX && savedY) {
        const x = parseInt(savedX, 10);
        const y = parseInt(savedY, 10);
        if (y > -2000 && x > -5000) {
          await appWindow.setPosition(new PhysicalPosition(x, y)).catch(console.error);
        }
      }
    };

    restoreWindowState();

    const appWindow = getCurrentWindow();
    let resizeTimeout: any;
    let moveTimeout: any;

    let unlistenResized: (() => void) | null = null;
    let unlistenMoved: (() => void) | null = null;

    const subResized = appWindow.onResized(async () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(async () => {
        try {
          const size = await appWindow.innerSize();
          localStorage.setItem('app_window_width', size.width.toString());
          localStorage.setItem('app_window_height', size.height.toString());
        } catch (e) {
          console.error(e);
        }
      }, 300);
    }).then((unsub) => { unlistenResized = unsub; });

    const subMoved = appWindow.onMoved(async () => {
      clearTimeout(moveTimeout);
      moveTimeout = setTimeout(async () => {
        try {
          const pos = await appWindow.outerPosition();
          localStorage.setItem('app_window_x', pos.x.toString());
          localStorage.setItem('app_window_y', pos.y.toString());
        } catch (e) {
          console.error(e);
        }
      }, 300);
    }).then((unsub) => { unlistenMoved = unsub; });

    return () => {
      clearTimeout(resizeTimeout);
      clearTimeout(moveTimeout);
      subResized.then(() => { if (unlistenResized) unlistenResized(); });
      subMoved.then(() => { if (unlistenMoved) unlistenMoved(); });
    };
  });

  // 설정창이 열릴 때 초기 위치 지정 및 화면 클램핑
  $effect(() => {
    if (showSettings) {
      if (!isSettingsPositioned) {
        settingsX = Math.max(10, (window.innerWidth - 720) / 2);
        settingsY = Math.max(10, (window.innerHeight - 480) / 2);
        isSettingsPositioned = true;
      } else {
        if (settingsX < 0 || settingsX > window.innerWidth - 100 ||
            settingsY < 0 || settingsY > window.innerHeight - 100) {
          settingsX = Math.max(10, (window.innerWidth - 720) / 2);
          settingsY = Math.max(10, (window.innerHeight - 480) / 2);
        }
      }
    }
  });

  function handleSettingsDragStart(e: MouseEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.settings-close')) return;

    isDraggingSettings = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    initialModalX = settingsX;
    initialModalY = settingsY;

    window.addEventListener('mousemove', handleSettingsDragMove);
    window.addEventListener('mouseup', handleSettingsDragEnd);
    e.preventDefault();
  }

  function handleSettingsDragMove(e: MouseEvent) {
    if (!isDraggingSettings) return;
    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;
    
    settingsX = Math.max(10, Math.min(window.innerWidth - 120, initialModalX + deltaX));
    settingsY = Math.max(10, Math.min(window.innerHeight - 60, initialModalY + deltaY));
  }

  function handleSettingsDragEnd() {
    isDraggingSettings = false;
    window.removeEventListener('mousemove', handleSettingsDragMove);
    window.removeEventListener('mouseup', handleSettingsDragEnd);
  }

  // 반응형 상태
  let lineCount = $derived(fileContent.split(/\r?\n/).length);
  let charCount = $derived(fileContent.length);

  // 구문 분석 및 토큰화 유틸리티
  interface Token {
    type: 'text' | 'string' | 'code' | 'number' | 'comment';
    text: string;
  }

  function parseNumbers(text: string): Token[] {
    const tokens: Token[] = [];
    const numRegex = /\b\d+(?:\.\d+)?\b/g;
    let lastIndex = 0;
    let match;

    while ((match = numRegex.exec(text)) !== null) {
      const matchIndex = match.index;
      const matchText = match[0];

      if (matchIndex > lastIndex) {
        tokens.push({ type: 'text', text: text.substring(lastIndex, matchIndex) });
      }

      tokens.push({ type: 'number', text: matchText });
      lastIndex = numRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      tokens.push({ type: 'text', text: text.substring(lastIndex) });
    }

    return tokens;
  }

  function tokenizeLine(line: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    const len = line.length;
    let currentText = "";
    let state: string = 'DEFAULT';

    while (i < len) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (state === 'COMMENT') {
        currentText += char;
        i++;
        continue;
      }

      if (state === 'DEFAULT') {
        if ((char === '/' && nextChar === '/') || char === '#') {
          if (currentText) {
            tokens.push(...parseNumbers(currentText));
            currentText = "";
          }
          state = 'COMMENT';
          currentText += line.substring(i);
          break;
        }
      }

      if (state === 'DEFAULT') {
        if (char === '"') {
          if (currentText) {
            tokens.push(...parseNumbers(currentText));
            currentText = "";
          }
          state = 'STRING_DOUBLE';
          currentText += char;
        } else if (char === "'") {
          if (currentText) {
            tokens.push(...parseNumbers(currentText));
            currentText = "";
          }
          state = 'STRING_SINGLE';
          currentText += char;
        } else if (char === '`') {
          if (currentText) {
            tokens.push(...parseNumbers(currentText));
            currentText = "";
          }
          state = 'BACKTICK';
          currentText += char;
        } else {
          currentText += char;
        }
        i++;
      } else if (state === 'STRING_DOUBLE') {
        currentText += char;
        if (char === '\\') {
          if (i + 1 < len) {
            currentText += line[i + 1];
            i++;
          }
        } else if (char === '"') {
          tokens.push({ type: 'string', text: currentText });
          currentText = "";
          state = 'DEFAULT';
        }
        i++;
      } else if (state === 'STRING_SINGLE') {
        currentText += char;
        if (char === '\\') {
          if (i + 1 < len) {
            currentText += line[i + 1];
            i++;
          }
        } else if (char === "'") {
          tokens.push({ type: 'string', text: currentText });
          currentText = "";
          state = 'DEFAULT';
        }
        i++;
      } else if (state === 'BACKTICK') {
        currentText += char;
        if (char === '`') {
          tokens.push({ type: 'code', text: currentText });
          currentText = "";
          state = 'DEFAULT';
        }
        i++;
      }
    }

    if (currentText) {
      if (state === 'DEFAULT') {
        tokens.push(...parseNumbers(currentText));
      } else if (state === 'STRING_DOUBLE' || state === 'STRING_SINGLE') {
        tokens.push({ type: 'string', text: currentText });
      } else if (state === 'BACKTICK') {
        tokens.push({ type: 'code', text: currentText });
      } else if (state === 'COMMENT') {
        tokens.push({ type: 'comment', text: currentText });
      }
    }

    return tokens;
  }

  interface ParsedLine {
    id: number;
    indentLevel: number;
    extraIndentSpaces: number;
    tokens: Token[];
  }

  function parseLine(lineText: string, id: number, tabSize: number): ParsedLine {
    const match = lineText.match(/^([ \t]*)/);
    const indentStr = match ? match[0] : "";
    
    let totalSpaces = 0;
    for (let j = 0; j < indentStr.length; j++) {
      if (indentStr[j] === '\t') {
        totalSpaces += tabSize;
      } else {
        totalSpaces += 1;
      }
    }

    const indentLevel = Math.floor(totalSpaces / tabSize);
    const extraIndentSpaces = totalSpaces % tabSize;

    return {
      id,
      indentLevel,
      extraIndentSpaces,
      tokens: tokenizeLine(lineText)
    };
  }

  // 렌더 모드 텍스트 및 가상화 파싱 라인 생성
  let rawLines = $derived(fileContent.split(/\r?\n/));
  let parsedLines = $derived(rawLines.map((lineText, idx) => parseLine(lineText, idx, tabSize)));

  // 가상화 범위 계산
  let startLine = $derived(Math.max(0, Math.floor(scrollTop / measuredLineHeight) - 8));
  let endLine = $derived(Math.min(rawLines.length - 1, Math.floor((scrollTop + clientHeight) / measuredLineHeight) + 8));

  // 줄 높이 실측 로직
  function measureLineHeight() {
    const testEl = document.createElement('div');
    testEl.style.fontFamily = 'var(--font-notepad)';
    testEl.style.fontSize = `${currentFontSize}pt`;
    testEl.style.lineHeight = '1.5';
    testEl.style.position = 'absolute';
    testEl.style.visibility = 'hidden';
    testEl.style.whiteSpace = 'pre';
    testEl.innerText = 'A';
    document.body.appendChild(testEl);
    const rect = testEl.getBoundingClientRect();
    measuredLineHeight = rect.height || testEl.clientHeight || 22;
    document.body.removeChild(testEl);
  }

  // 폰트 변경 반응성
  $effect(() => {
    measureLineHeight();
  });

  // 뷰포트 크기 변경 관찰
  $effect(() => {
    if (!editorViewportEl) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        clientHeight = entry.contentRect.height;
      }
    });
    observer.observe(editorViewportEl);
    return () => observer.disconnect();
  });

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
    scrollTop = 0;
    scrollLeft = 0;
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
      scrollTop = 0;
      scrollLeft = 0;
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

  let wheelDebug = $state<string>("N/A");

  // 마우스 가로 휠 및 Shift + 마우스 세로 휠 가로 스크롤 지원
  function handleWheel(e: WheelEvent) {
    if (!textareaEl) return;
    
    wheelDebug = `dX:${e.deltaX.toFixed(0)}, dY:${e.deltaY.toFixed(0)}, shift:${e.shiftKey}`;
    
    // deltaX가 존재하면 가로 휠 입력이 있는 것임 (macOS 및 일반 브라우저 환경 등)
    if (e.deltaX !== 0) {
      // 일반 브라우저 환경에서 가로 휠 동작 시 스크롤 속도를 보정하기 위해 배율(x3) 적용
      textareaEl.scrollLeft += e.deltaX * 3;
      e.preventDefault();
    } 
    // Shift 키를 누르고 세로 휠을 돌릴 때 가로 스크롤 매핑
    else if (e.shiftKey && e.deltaY !== 0) {
      textareaEl.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }

  // 스크롤 갱신 핸들러
  function handleScroll(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    scrollTop = target.scrollTop;
    scrollLeft = target.scrollLeft;
  }

  // passive: false 리스너로 등록하여 preventDefault() 오동작 차단 및 Rust 네이티브 가로 휠 이벤트 통합
  $effect(() => {
    if (!textareaEl) return;
    
    const onWheelNative = (e: WheelEvent) => {
      handleWheel(e);
    };

    textareaEl.addEventListener('wheel', onWheelNative, { passive: false });
    
    // Windows WebView2에서는 가로 휠 조작 시 브라우저 내 wheel 이벤트의 deltaX가 아예 0이 되는 버그가 있습니다.
    // 이를 우회하기 위해 Rust 백엔드에서 WM_MOUSEHWHEEL 메시지를 후킹하여 가로 휠 델타를 직접 수신받습니다.
    const unlistenPromise = listen<number>("native-horizontal-wheel", (event) => {
      if (!textareaEl) return;
      const delta = event.payload;
      // OS의 delta 값(보통 120 또는 -120)을 받아 가로 스크롤에 직접 반영
      // 윈도우 OS의 가로 스크롤 한 틱 단위가 대개 120이므로, 120px 만큼 스크롤됩니다.
      textareaEl.scrollLeft += delta;
      scrollTop = textareaEl.scrollTop;
      scrollLeft = textareaEl.scrollLeft;
      
      // 디버그 텍스트 갱신
      wheelDebug = `Native dX: ${delta}`;
    });
    
    return () => {
      if (textareaEl) {
        textareaEl.removeEventListener('wheel', onWheelNative);
      }
      unlistenPromise.then((unlisten) => unlisten());
    };
  });

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

<div class="app-container" style="
  --color-hl-code-bg: {colorHlCodeBg};
  --color-hl-code-text: {colorHlCodeText};
  --color-hl-string: {colorHlString};
  --color-hl-number: {colorHlNumber};
  --color-hl-comment: {colorHlComment};
  --color-indent-guide: {colorIndentGuide};
">
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

    <!-- 우측 설정 톱니바퀴 및 렌더 모드 토글 버튼 -->
    <div class="menu-right">
      <button 
        class="render-mode-toggle"
        class:active={isRenderMode}
        onclick={() => isRenderMode = !isRenderMode}
        title={isRenderMode ? "원본 모드로 전환" : "렌더 모드로 전환"}
      >
        {isRenderMode ? "🎨" : "📝"}
      </button>
      
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
  <main class="editor-area" class:render-mode={isRenderMode}>
    <div class="editor-container">
      <!-- 라인 번호 Gutter -->
      {#if isRenderMode}
        <div class="editor-gutter" style="background-color: var(--bg-gutter);">
          <div class="gutter-scroll-container" style="transform: translate3d(0, -{scrollTop}px, 0);">
            {#each Array(endLine - startLine + 1) as _, idx}
              {@const lineIdx = startLine + idx}
              <div 
                class="gutter-line-number" 
                style="position: absolute; top: {lineIdx * measuredLineHeight + 8}px; height: {measuredLineHeight}px; line-height: {measuredLineHeight}px; font-size: {currentFontSize}pt;"
              >
                {lineIdx + 1}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- 에디터 영역 뷰포트 -->
      <div 
        class="editor-viewport" 
        bind:this={editorViewportEl}
      >
        <!-- 렌더 모드 Backdrop -->
        {#if isRenderMode}
          <div class="editor-backdrop">
            <div class="backdrop-scroll-container" style="transform: translate3d(-{scrollLeft}px, -{scrollTop}px, 0);">
              {#each Array(endLine - startLine + 1) as _, idx}
                {@const lineIdx = startLine + idx}
                {@const line = parsedLines[lineIdx]}
                {#if line}
                  <div class="backdrop-line" style="position: absolute; top: {lineIdx * measuredLineHeight + 8}px; left: 0; height: {measuredLineHeight}px; line-height: {measuredLineHeight}px; font-size: {currentFontSize}pt; tab-size: {tabSize}; -moz-tab-size: {tabSize};">{#each Array(line.indentLevel) as _, i}<span class="guide-line" style="left: calc({i * tabSize}ch + 12px);"></span>{/each}<span class="line-content">{#each line.tokens as token}<span class="hl-{token.type}">{token.text}</span>{/each}</span></div>
                {/if}
              {/each}
            </div>
          </div>
        {/if}

        <textarea
          bind:this={textareaEl}
          class="editor-textarea"
          style="font-size: {currentFontSize}pt; line-height: {measuredLineHeight}px; tab-size: {tabSize}; -moz-tab-size: {tabSize};"
          bind:value={fileContent}
          oninput={handleInput}
          onscroll={handleScroll}
          onkeyup={updateCursorPosition}
          onclick={updateCursorPosition}
          onfocus={updateCursorPosition}
          spellcheck="false"
        ></textarea>
      </div>
    </div>

    <!-- 설정 창 오버레이 (Fluent Style Modal) -->
    {#if showSettings}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="settings-overlay" onclick={(e) => { if (e.target === e.currentTarget) showSettings = false; }}>
        <div 
          class="settings-modal" 
          onclick={(e) => e.stopPropagation()}
          style="position: absolute; left: {settingsX}px; top: {settingsY}px; margin: 0;"
        >
          <div class="settings-header" onmousedown={handleSettingsDragStart}>
            <h3>설정</h3>
            <button class="settings-close" onclick={() => showSettings = false}>&times;</button>
          </div>
          
          <div class="settings-body">
            <!-- 좌측 네비게이션 메뉴 -->
            <aside class="settings-sidebar">
              <button 
                class="sidebar-item" 
                class:active={activeSettingsTab === 'source'} 
                onclick={() => activeSettingsTab = 'source'}
              >
                📝 원본 모드
              </button>
              <button 
                class="sidebar-item" 
                class:active={activeSettingsTab === 'render'} 
                onclick={() => activeSettingsTab = 'render'}
              >
                🎨 렌더 모드
              </button>
            </aside>
            
            <!-- 우측 메인 콘텐츠 영역 -->
            <div class="settings-main">
              {#if activeSettingsTab === 'source'}
                <div class="settings-section">
                  <h4 class="section-title">글꼴 설정</h4>
                  <div class="settings-row">
                    <label for="source-font-size-input">글꼴 크기 (pt)</label>
                    <div class="size-control">
                      <input 
                        id="source-font-size-input"
                        type="number" 
                        min="6" 
                        max="72" 
                        bind:value={sourceFontSize} 
                        class="font-size-num"
                      />
                      <button class="adjust-btn" onclick={() => sourceFontSize = Math.max(6, sourceFontSize - 1)}>-</button>
                      <button class="adjust-btn" onclick={() => sourceFontSize = Math.min(72, sourceFontSize + 1)}>+</button>
                    </div>
                  </div>
                </div>
              {:else if activeSettingsTab === 'render'}
                <div class="settings-section">
                  <h4 class="section-title">화면 및 글꼴</h4>
                  <div class="settings-row">
                    <label for="render-font-size-input">글꼴 크기 (pt)</label>
                    <div class="size-control">
                      <input 
                        id="render-font-size-input"
                        type="number" 
                        min="6" 
                        max="72" 
                        bind:value={renderFontSize} 
                        class="font-size-num"
                      />
                      <button class="adjust-btn" onclick={() => renderFontSize = Math.max(6, renderFontSize - 1)}>-</button>
                      <button class="adjust-btn" onclick={() => renderFontSize = Math.min(72, renderFontSize + 1)}>+</button>
                    </div>
                  </div>
                  
                  <div class="settings-row">
                    <label for="tab-size-select">들여쓰기 너비 (공백 개수)</label>
                    <select id="tab-size-select" bind:value={tabSize} class="tab-size-select">
                      <option value={2}>2</option>
                      <option value={4}>4 (기본값)</option>
                      <option value={8}>8</option>
                    </select>
                  </div>
                </div>
                
                <div class="settings-section">
                  <h4 class="section-title">시각적 테마 색상 설정</h4>
                  
                  <div class="settings-row color-row">
                    <label for="color-hl-code-bg">코드 백그라운드 색상</label>
                    <div class="color-picker-wrapper">
                      <input id="color-hl-code-bg" type="color" bind:value={colorHlCodeBg} />
                      <input type="text" class="color-text-input" bind:value={colorHlCodeBg} placeholder="#000000" />
                    </div>
                  </div>
                  
                  <div class="settings-row color-row">
                    <label for="color-hl-code-text">코드 글자 색상</label>
                    <div class="color-picker-wrapper">
                      <input id="color-hl-code-text" type="color" bind:value={colorHlCodeText} />
                      <input type="text" class="color-text-input" bind:value={colorHlCodeText} placeholder="#000000" />
                    </div>
                  </div>
                  
                  <div class="settings-row color-row">
                    <label for="color-hl-string">문자열 색상 ('...', "...")</label>
                    <div class="color-picker-wrapper">
                      <input id="color-hl-string" type="color" bind:value={colorHlString} />
                      <input type="text" class="color-text-input" bind:value={colorHlString} placeholder="#000000" />
                    </div>
                  </div>
                  
                  <div class="settings-row color-row">
                    <label for="color-hl-number">숫자 색상 (0-9)</label>
                    <div class="color-picker-wrapper">
                      <input id="color-hl-number" type="color" bind:value={colorHlNumber} />
                      <input type="text" class="color-text-input" bind:value={colorHlNumber} placeholder="#000000" />
                    </div>
                  </div>
                  
                  <div class="settings-row color-row">
                    <label for="color-hl-comment">주석 색상 (//, #)</label>
                    <div class="color-picker-wrapper">
                      <input id="color-hl-comment" type="color" bind:value={colorHlComment} />
                      <input type="text" class="color-text-input" bind:value={colorHlComment} placeholder="#000000" />
                    </div>
                  </div>
                  
                  <div class="settings-row color-row">
                    <label for="color-indent-guide">들여쓰기 가이드라인 색상</label>
                    <div class="color-picker-wrapper">
                      <input id="color-indent-guide" type="color" bind:value={colorIndentGuide} />
                      <input type="text" class="color-text-input" bind:value={colorIndentGuide} placeholder="#000000" />
                    </div>
                  </div>
                  
                  <div class="settings-action-row">
                    <button class="reset-colors-btn" onclick={resetColorsToDefault}>
                      기본 색상으로 복원
                    </button>
                  </div>
                </div>
              {/if}
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
      <span class="status-item">Wheel: {wheelDebug}</span>
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

    /* 렌더 모드 하이라이팅 색상 */
    --color-hl-code-bg: rgba(0, 120, 212, 0.08);
    --color-hl-code-text: #0078d4;
    --color-hl-string: #a31515;
    --color-hl-number: #098658;
    --color-hl-comment: #008000;
    --color-indent-guide: rgba(0, 0, 0, 0.08);
    --color-gutter-text: #8d8d8d;
    --bg-gutter: #f9f9f9;
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

      /* 다크모드 하이라이팅 색상 */
      --color-hl-code-bg: rgba(86, 156, 214, 0.15);
      --color-hl-code-text: #4fc1ff;
      --color-hl-string: #ce9178;
      --color-hl-number: #b5cea8;
      --color-hl-comment: #6a9955;
      --color-indent-guide: rgba(255, 255, 255, 0.08);
      --color-gutter-text: #858585;
      --bg-gutter: #1b1b1b;
    }
  }

  /* 렌더 모드 토큰 색상 스타일 */
  .hl-code {
    background-color: var(--color-hl-code-bg);
    color: var(--color-hl-code-text);
    border-radius: 2px;
  }
  .hl-string {
    color: var(--color-hl-string);
  }
  .hl-number {
    color: var(--color-hl-number);
  }
  .hl-comment {
    color: var(--color-hl-comment);
  }
  .hl-text {
    color: var(--text-color);
  }

  .render-mode-toggle {
    background: transparent;
    border: none;
    color: var(--text-color);
    font-size: 0.95rem;
    padding: 0.2rem 0.4rem;
    margin-right: 0.25rem;
    cursor: pointer;
    border-radius: 4px;
    transition: background-color 0.1s;
    outline: none;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .render-mode-toggle:hover, .render-mode-toggle.active {
    background-color: var(--bg-menu-hover);
  }

  .tab-size-select {
    padding: 0.2rem 0.4rem;
    border: 1px solid var(--border-color);
    background-color: var(--bg-editor);
    color: var(--text-color);
    border-radius: 4px;
    font-family: var(--font-ui);
    font-size: 0.85rem;
    outline: none;
    width: 100px;
    text-align: center;
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

  .editor-container {
    display: flex;
    width: 100%;
    height: 100%;
    overflow: hidden;
    position: relative;
  }

  .editor-gutter {
    width: 48px;
    height: 100%;
    overflow: hidden;
    position: relative;
    border-right: 1px solid var(--border-color);
    user-select: none;
    flex-shrink: 0;
  }

  .gutter-scroll-container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  .gutter-line-number {
    width: 100%;
    text-align: right;
    padding-right: 10px;
    box-sizing: border-box;
    color: var(--color-gutter-text);
    font-family: var(--font-notepad);
  }

  .editor-viewport {
    flex: 1;
    height: 100%;
    position: relative;
    overflow: hidden;
  }

  .editor-backdrop {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    pointer-events: none;
    z-index: 1;
  }

  .backdrop-scroll-container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  .backdrop-line {
    min-width: 100%;
    width: max-content;
    white-space: pre;
    font-family: var(--font-notepad);
    padding: 0 12px;
    box-sizing: border-box;
    letter-spacing: normal;
    word-spacing: normal;
    font-variant-ligatures: none;
    font-feature-settings: "liga" 0;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeSpeed;
  }

  .guide-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background-color: var(--color-indent-guide);
  }

  .line-content {
    display: inline-block;
    vertical-align: top;
    color: var(--text-color);
  }

  .editor-textarea {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: var(--bg-editor);
    border: 0;
    margin: 0;
    outline: none;
    resize: none;
    color: var(--text-color);
    font-family: var(--font-notepad);
    padding: 8px 12px;
    box-sizing: border-box;
    overflow: auto;
    white-space: pre;
    word-wrap: normal;
    z-index: 2;
    letter-spacing: normal;
    word-spacing: normal;
    font-variant-ligatures: none;
    font-feature-settings: "liga" 0;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeSpeed;
  }

  /* 렌더 모드 활성화 시 스타일 */
  .render-mode .editor-textarea {
    background-color: transparent;
    color: transparent;
    caret-color: var(--text-color);
  }

  /* 설정 팝업 오버레이 */
  .settings-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: var(--bg-overlay);
    z-index: 30;
  }

  .settings-modal {
    background-color: var(--bg-modal);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    box-shadow: var(--shadow-menu);
    width: 720px;
    height: 480px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: fadeIn 0.15s ease-out;
  }

  .settings-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border-color);
    background-color: var(--bg-window);
    cursor: move;
    user-select: none;
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

  .settings-body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .settings-sidebar {
    width: 180px;
    background-color: var(--bg-window);
    border-right: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    padding: 0.5rem 0;
    gap: 2px;
    user-select: none;
    flex-shrink: 0;
  }

  .sidebar-item {
    background: transparent;
    border: none;
    color: var(--text-color);
    font-family: var(--font-ui);
    font-size: 0.85rem;
    padding: 0.6rem 1rem;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.1s, color 0.1s;
    outline: none;
    border-left: 3px solid transparent;
  }

  .sidebar-item:hover {
    background-color: var(--bg-menu-hover);
  }

  .sidebar-item.active {
    background-color: var(--bg-menu-active);
    font-weight: 600;
    border-left-color: var(--accent-color);
  }

  .settings-main {
    flex: 1;
    padding: 1rem 1.25rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    background-color: var(--bg-editor);
  }

  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 1rem;
  }

  .settings-section:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }

  .section-title {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--accent-color);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .settings-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.85rem;
    min-height: 28px;
  }

  .color-picker-wrapper {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .color-picker-wrapper input[type="color"] {
    border: 1px solid var(--border-color);
    padding: 0;
    width: 28px;
    height: 28px;
    cursor: pointer;
    border-radius: 4px;
    background: none;
  }

  .color-text-input {
    width: 80px;
    padding: 0.25rem 0.4rem;
    border: 1px solid var(--border-color);
    background-color: var(--bg-editor);
    color: var(--text-color);
    border-radius: 4px;
    font-family: Consolas, monospace;
    font-size: 0.8rem;
    outline: none;
    text-transform: uppercase;
  }

  .color-text-input:focus {
    border-color: var(--accent-color);
  }

  .settings-action-row {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.5rem;
  }

  .reset-colors-btn {
    background-color: var(--bg-window);
    border: 1px solid var(--border-color);
    color: var(--text-color);
    border-radius: 4px;
    padding: 0.4rem 0.8rem;
    font-family: var(--font-ui);
    font-size: 0.8rem;
    cursor: pointer;
    transition: background-color 0.1s;
    outline: none;
  }

  .reset-colors-btn:hover {
    background-color: var(--bg-menu-hover);
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


