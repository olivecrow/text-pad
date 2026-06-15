<script lang="ts">
  import { message, open, save } from "@tauri-apps/plugin-dialog";
  import { invoke } from "@tauri-apps/api/core";
  import { PhysicalPosition } from "@tauri-apps/api/dpi";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { listen, type Event as TauriEvent, type UnlistenFn } from "@tauri-apps/api/event";
  import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
  import { ChevronDown, Copy, FileCode2, Minus, PaintRoller, PenLine, Settings, Square, Sun, Moon, Plus, X } from "@lucide/svelte";
  import {
    getCommentSyntaxForPath,
    tokenizeLineWithState,
    type CommentSyntax,
    type Token,
    type TokenizeState
  } from "$lib/render-tokenizer";
  import { untrack } from "svelte";

  interface EditorTab {
    id: string;
    filePath: string | null;
    fileName: string;
    fileContent: string;
    isDirty: boolean;
    scrollTop: number;
    scrollLeft: number;
    selectionStart: number;
    selectionEnd: number;
    cursorLine: number;
    cursorCol: number;
    caretOffset: number;
  }

  let nextTabId = 1;
  let nextUntitledNumber = 1;
  const untitledFileName = "제목 없음";
  const invalidFileNameCharsPattern = /[<>:"/\\|?*\x00-\x1F]/g;
  const isBrowser = typeof window !== 'undefined';

  function hasTauriRuntime(): boolean {
    if (!isBrowser) return false;
    const runtimeWindow = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
    return '__TAURI_INTERNALS__' in runtimeWindow || '__TAURI__' in runtimeWindow;
  }

  function getInitialIsSettingsWindow(): boolean {
    if (!hasTauriRuntime()) return false;

    try {
      return getCurrentWindow().label === 'settings';
    } catch {
      return false;
    }
  }

  function getFileNameFromPath(path: string): string {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || path;
  }

  function getNextUntitledFileName(): string {
    const name = nextUntitledNumber === 1 ? untitledFileName : `${untitledFileName} ${nextUntitledNumber}`;
    nextUntitledNumber += 1;
    return name;
  }

  function getFirstLineTitle(content: string): string {
    const firstLine = content.split(/\r?\n/, 1)[0]?.trim() ?? "";
    return firstLine || untitledFileName;
  }

  function getDisplayFileName(tab: Pick<EditorTab, 'filePath' | 'fileName' | 'fileContent'>): string {
    return tab.filePath ? tab.fileName : getFirstLineTitle(tab.fileContent);
  }

  function getUnsavedFileNameFromContent(content: string): string {
    const fileNameBase = getFirstLineTitle(content)
      .replace(invalidFileNameCharsPattern, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "") || untitledFileName;

    return /\.[^./\\]+$/.test(fileNameBase) ? fileNameBase : `${fileNameBase}.txt`;
  }

  function getSuggestedSaveFileName(tab: EditorTab): string {
    return tab.filePath ? tab.fileName : getUnsavedFileNameFromContent(tab.fileContent);
  }

  function createEditorTab(options: Partial<Pick<EditorTab, 'filePath' | 'fileName' | 'fileContent' | 'isDirty'>> = {}): EditorTab {
    const nextFileContent = options.fileContent ?? "";
    const nextFilePath = options.filePath ?? null;
    return {
      id: `tab-${nextTabId++}`,
      filePath: nextFilePath,
      fileName: options.fileName ?? (nextFilePath ? getFileNameFromPath(nextFilePath) : getNextUntitledFileName()),
      fileContent: nextFileContent,
      isDirty: options.isDirty ?? false,
      scrollTop: 0,
      scrollLeft: 0,
      selectionStart: 0,
      selectionEnd: 0,
      cursorLine: 1,
      cursorCol: 1,
      caretOffset: 0
    };
  }

  const initialTab = createEditorTab();
  let tabs = $state<EditorTab[]>([initialTab]);
  let activeTabId = $state<string>(initialTab.id);

  let filePath = $state<string | null>(initialTab.filePath);
  let fileName = $state<string>(initialTab.fileName);
  let fileContent = $state<string>(initialTab.fileContent);
  let isDirty = $state<boolean>(initialTab.isDirty);
  let isLoading = $state<boolean>(false);
  let errorMsg = $state<string | null>(null);
  let isHandlingCloseRequest = false;
  let hasFocusedEditorOnStartup = false;
  let hasShownMainWindowOnStartup = false;
  let isWindowMaximized = $state<boolean>(false);

  // 커서 상태 추적
  let cursorLine = $state<number>(1);
  let cursorCol = $state<number>(1);
  let caretOffset = $state<number>(0);
  let editorCaretColor = $state<string>('var(--color-render-text, var(--text-color))');
  let editorCursorStyle = $state<string>('text');

  // 메뉴 및 설정 상태 추적
  let openDropdown = $state<'file' | 'edit' | null>(null);
  type SettingsView = 'sourceAppearance' | 'renderAppearance' | 'renderEditing';
  let activeSettingsView = $state<SettingsView>('renderAppearance');
  let isSourceSettingsExpanded = $state<boolean>(true);
  let isRenderSettingsExpanded = $state<boolean>(true);
  let hasCenteredSettingsWindowThisSession = false;

  // 폰트 크기 이원화
  let sourceFontSize = $state<number>(11);
  let renderFontSize = $state<number>(11);

  // 렌더 모드 상태
  let isRenderMode = $state<boolean>(true); // 기본값은 렌더 모드
  let renderAutoPairEditing = $state<boolean>(true);
  let renderAutoSymbolSubstitution = $state<boolean>(true);
  let currentFontSize = $derived(isRenderMode ? renderFontSize : sourceFontSize);
  let tabSize = $state<number>(4);          // 기본 들여쓰기 탭 4칸
  let scrollTop = $state<number>(0);
  let scrollLeft = $state<number>(0);
  let measuredLineHeight = $state<number>(22);
  let clientHeight = $state<number>(500);

  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let editorViewportEl = $state<HTMLDivElement | null>(null);

  // 테마 모드: 'system' | 'light' | 'dark'
  let themeMode = $state<'system' | 'light' | 'dark'>('system');

  // 현재 시스템 테마 추적
  let systemIsDark = $state<boolean>(false);
  let currentTheme = $derived(themeMode === 'system' ? (systemIsDark ? 'dark' : 'light') : themeMode);

  // 설정창에서 편집 중인 테마
  let editingTheme = $state<'light' | 'dark'>('light');

  interface ThemeColors {
    codeBg: string;
    codeText: string;
    string: string;
    number: string;
    comment: string;
    guide: string;
    renderBg: string;
    renderText: string;
    renderFontWeight: string;
    paren: string;
    bracket: string;
    brace: string;
  }

  type ColorField = Exclude<keyof ThemeColors, 'renderFontWeight'>;
  const hexColorRegex = /^#[0-9a-fA-F]{6}$/;

  // 시스템 테마별 기본 강조 색상
  function getSystemDefaultColors(isDark: boolean): ThemeColors {
    return isDark ? {
      renderBg: '#0a0a0b',
      renderText: '#d6eaf0',
      renderFontWeight: '400',
      codeBg: '#1e293b',
      codeText: '#38bdf8',
      string: '#F3AF82',
      number: '#dffe8b',
      comment: '#64748b',
      guide: '#334155',
      paren: '#ECA7BC',
      bracket: '#C87EBA',
      brace: '#CD81E9'
    } : {
      renderBg: '#f8fafc',
      renderText: '#0f172a',
      renderFontWeight: '500',
      codeBg: '#f1f5f9',
      codeText: '#0284c7',
      string: '#b91c1c',
      number: '#d97706',
      comment: '#475569',
      guide: '#cbd5e1',
      paren: '#a57800',
      bracket: '#b31c62',
      brace: '#097a70'
    };
  }

  let lightColors = $state<ThemeColors>(getSystemDefaultColors(false));
  let darkColors = $state<ThemeColors>(getSystemDefaultColors(true));

  // 현재 적용되는 테마 색상
  let activeColors = $derived(currentTheme === 'dark' ? darkColors : lightColors);

  // 설정창이 독립 윈도우로 떴는지 감지하는 상태
  let isSettingsWindow = $state<boolean>(getInitialIsSettingsWindow());

  let renderFontFamily = $state<string>('nanum-gothic');
  let currentRenderFontFamilyCSS = $derived(
    renderFontFamily === 'nanum-gothic' ? "'Nanum Gothic', 'NanumGothic', 'Malgun Gothic', sans-serif" :
    renderFontFamily === 'jetbrains-mono' ? "'JetBrains Mono', 'D2Coding', 'Nanum Gothic Coding', 'Fira Code', monospace" :
    renderFontFamily === 'fira-code' ? "'Fira Code', 'D2Coding', 'Nanum Gothic Coding', 'JetBrains Mono', monospace" :
    renderFontFamily === 'roboto-mono' ? "'Roboto Mono', 'D2Coding', 'Nanum Gothic Coding', monospace" :
    renderFontFamily === 'd2coding' ? "'D2Coding', 'D2coding', 'Nanum Gothic Coding', monospace" :
    renderFontFamily === 'nanum-gothic-coding' ? "'Nanum Gothic Coding', 'D2Coding', monospace" :
    renderFontFamily === 'cascadia-mono' ? "'Cascadia Mono', 'Cascadia Code', 'D2Coding', 'Nanum Gothic Coding', monospace" :
    renderFontFamily === 'consolas' ? "'Consolas', 'D2Coding', 'Nanum Gothic Coding', monospace" :
    renderFontFamily === 'notepad' ? "var(--font-notepad)" :
    "'Nanum Gothic', 'NanumGothic', 'Malgun Gothic', sans-serif"
  );

  let canPersistPreferences = $state<boolean>(false);
  const textSaveFilters = [
    {
      name: "Text Files",
      extensions: ["txt"]
    }
  ];
  const closeSaveButtons = {
    yes: "저장",
    no: "저장 안 함",
    cancel: "취소"
  };
  const renderAutoClosingPairs: Record<string, string> = {
    '(': ')',
    '[': ']',
    '{': '}',
    '"': '"',
    "'": "'",
    '`': '`'
  };
  const renderAutoSubstitutions: Record<string, string> = {
    '-->': '→',
    '<--': '←',
    '<->': '↔',
    '==>': '⇒',
    '<==': '⇐',
    '<=>': '⇔'
  };
  const renderAutoSubstitutionTriggers = Object.keys(renderAutoSubstitutions).sort((a, b) => b.length - a.length);
  const editorIndentUnit = '    ';

  function getActiveTabIndex(): number {
    return tabs.findIndex((tab) => tab.id === activeTabId);
  }

  function getActiveTab(): EditorTab | null {
    const activeIndex = getActiveTabIndex();
    return activeIndex === -1 ? null : tabs[activeIndex];
  }

  function updateTabById(tabId: string, updates: Partial<EditorTab>) {
    tabs = tabs.map((tab) => tab.id === tabId ? { ...tab, ...updates } : tab);
  }

  function syncActiveTabState() {
    const activeTab = getActiveTab();
    if (!activeTab) return;

    const nextFileName = filePath ? fileName : getFirstLineTitle(fileContent);
    fileName = nextFileName;

    updateTabById(activeTab.id, {
      filePath,
      fileName: nextFileName,
      fileContent,
      isDirty,
      scrollTop,
      scrollLeft,
      selectionStart: textareaEl?.selectionStart ?? activeTab.selectionStart,
      selectionEnd: textareaEl?.selectionEnd ?? activeTab.selectionEnd,
      cursorLine,
      cursorCol,
      caretOffset
    });
  }

  function restoreEditorView(tab: EditorTab) {
    scrollTop = tab.scrollTop;
    scrollLeft = tab.scrollLeft;
    cursorLine = tab.cursorLine;
    cursorCol = tab.cursorCol;
    caretOffset = tab.caretOffset;
    editorCursorStyle = 'text';
    clearInlineColorPickerState();

    requestAnimationFrame(() => {
      if (!textareaEl) return;
      const selectionStart = Math.min(tab.selectionStart, fileContent.length);
      const selectionEnd = Math.min(tab.selectionEnd, fileContent.length);

      textareaEl.focus({ preventScroll: true });
      textareaEl.selectionStart = selectionStart;
      textareaEl.selectionEnd = selectionEnd;
      textareaEl.scrollTop = tab.scrollTop;
      textareaEl.scrollLeft = tab.scrollLeft;
      updateCursorPosition();
    });
  }

  function loadTabIntoEditor(tab: EditorTab) {
    activeTabId = tab.id;
    filePath = tab.filePath;
    fileName = getDisplayFileName(tab);
    fileContent = tab.fileContent;
    isDirty = tab.isDirty;
    errorMsg = null;
    restoreEditorView(tab);
  }

  function activateTab(tabId: string) {
    if (tabId === activeTabId) return;
    syncActiveTabState();
    const nextTab = tabs.find((tab) => tab.id === tabId);
    if (!nextTab) return;
    closeAllDropdown();
    loadTabIntoEditor(nextTab);
  }

  function addTab(tab: EditorTab) {
    syncActiveTabState();
    tabs = [...tabs, tab];
    closeAllDropdown();
    loadTabIntoEditor(tab);
  }

  function handleAddTab() {
    addTab(createEditorTab());
  }

  function isCleanUntitledTab(tab: EditorTab): boolean {
    return !tab.filePath && !tab.isDirty && tab.fileContent.length === 0;
  }

  function replaceActiveTabWith(tab: EditorTab) {
    syncActiveTabState();
    const activeIndex = getActiveTabIndex();
    if (activeIndex === -1) {
      addTab(tab);
      return;
    }

    const activeId = tabs[activeIndex].id;
    const nextTab = { ...tab, id: activeId };
    tabs = tabs.map((item) => item.id === activeId ? nextTab : item);
    loadTabIntoEditor(nextTab);
  }

  function closeTabWithoutPrompt(tabId: string) {
    const closingIndex = tabs.findIndex((tab) => tab.id === tabId);
    if (closingIndex === -1) return;

    if (tabs.length === 1) {
      const blankTab = createEditorTab();
      tabs = [blankTab];
      loadTabIntoEditor(blankTab);
      return;
    }

    const nextTabs = tabs.filter((tab) => tab.id !== tabId);
    tabs = nextTabs;

    if (activeTabId === tabId) {
      const nextIndex = Math.min(closingIndex, nextTabs.length - 1);
      loadTabIntoEditor(nextTabs[nextIndex]);
    }
  }

  async function handleCloseTab(tabId: string, event?: MouseEvent) {
    event?.stopPropagation();
    const canClose = await confirmCloseTab(tabId);
    if (!canClose) return;
    closeTabWithoutPrompt(tabId);
  }

  // 시스템 테마 변경 감지
  $effect(() => {
    if (!isBrowser) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    systemIsDark = mediaQuery.matches;
    const listener = (e: MediaQueryListEvent) => systemIsDark = e.matches;
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  });

  // body 클래스 업데이트
  $effect(() => {
    if (isBrowser) {
      if (currentTheme === 'dark') {
        document.body.classList.add('theme-dark');
        document.body.classList.remove('theme-light');
      } else {
        document.body.classList.add('theme-light');
        document.body.classList.remove('theme-dark');
      }
    }
  });

  // 기본 색상 복원
  function resetColorsToDefault() {
    if (!isBrowser) return;
    if (editingTheme === 'dark') {
      darkColors = getSystemDefaultColors(true);
    } else {
      lightColors = getSystemDefaultColors(false);
    }
  }

  // 마운트 시 localStorage Preferences 로드
  $effect(() => {
    if (!isBrowser) return;

    const savedThemeMode = localStorage.getItem('pref_theme_mode');
    if (savedThemeMode === 'system' || savedThemeMode === 'light' || savedThemeMode === 'dark') {
      themeMode = savedThemeMode;
    }

    const savedSourceFontSize = localStorage.getItem('pref_source_font_size');
    if (savedSourceFontSize) sourceFontSize = parseInt(savedSourceFontSize, 10);

    const savedRenderFontSize = localStorage.getItem('pref_render_font_size');
    if (savedRenderFontSize) renderFontSize = parseInt(savedRenderFontSize, 10);

    const savedTabSize = localStorage.getItem('pref_tab_size');
    if (savedTabSize) tabSize = parseInt(savedTabSize, 10);

    renderAutoPairEditing = localStorage.getItem('pref_render_auto_pair_editing') !== 'false';
    renderAutoSymbolSubstitution = localStorage.getItem('pref_render_auto_symbol_substitution') !== 'false';

    renderFontFamily = localStorage.getItem('pref_render_font_family') || 'nanum-gothic';

    const loadColors = (isDark: boolean): ThemeColors => {
      const prefix = isDark ? 'pref_dark_' : 'pref_light_';
      const defaults = getSystemDefaultColors(isDark);

      // Migration from old keys (if new key doesn't exist but old key does, use old key once, or just fallback to default)
      return {
        codeBg: localStorage.getItem(`${prefix}codeBg`) || (isDark && systemIsDark ? localStorage.getItem('pref_color_hl_code_bg') : null) || defaults.codeBg,
        codeText: localStorage.getItem(`${prefix}codeText`) || (isDark && systemIsDark ? localStorage.getItem('pref_color_hl_code_text') : null) || defaults.codeText,
        string: localStorage.getItem(`${prefix}string`) || (isDark && systemIsDark ? localStorage.getItem('pref_color_hl_string') : null) || defaults.string,
        number: localStorage.getItem(`${prefix}number`) || (isDark && systemIsDark ? localStorage.getItem('pref_color_hl_number') : null) || defaults.number,
        comment: localStorage.getItem(`${prefix}comment`) || (isDark && systemIsDark ? localStorage.getItem('pref_color_hl_comment') : null) || defaults.comment,
        guide: localStorage.getItem(`${prefix}guide`) || (isDark && systemIsDark ? localStorage.getItem('pref_color_indent_guide') : null) || defaults.guide,
        renderBg: localStorage.getItem(`${prefix}renderBg`) || (isDark && systemIsDark ? localStorage.getItem('pref_color_render_bg') : null) || defaults.renderBg,
        renderText: localStorage.getItem(`${prefix}renderText`) || (isDark && systemIsDark ? localStorage.getItem('pref_color_render_text') : null) || defaults.renderText,
        renderFontWeight: localStorage.getItem(`${prefix}renderFontWeight`) || defaults.renderFontWeight,
        paren: localStorage.getItem(`${prefix}paren`) || (isDark && systemIsDark ? localStorage.getItem('pref_color_hl_paren') : null) || defaults.paren,
        bracket: localStorage.getItem(`${prefix}bracket`) || (isDark && systemIsDark ? localStorage.getItem('pref_color_hl_bracket') : null) || defaults.bracket,
        brace: localStorage.getItem(`${prefix}brace`) || (isDark && systemIsDark ? localStorage.getItem('pref_color_hl_brace') : null) || defaults.brace,
      };
    };

    lightColors = loadColors(false);
    darkColors = loadColors(true);

    requestAnimationFrame(() => {
      setTimeout(() => {
        canPersistPreferences = true;
      }, 0);
    });
  });

  // 상태 변경 감지 자동 로컬스토리지 동기화
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem('pref_theme_mode', themeMode); });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem('pref_source_font_size', sourceFontSize.toString()); });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem('pref_render_font_size', renderFontSize.toString()); });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem('pref_tab_size', tabSize.toString()); });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem('pref_render_auto_pair_editing', renderAutoPairEditing ? 'true' : 'false'); });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem('pref_render_auto_symbol_substitution', renderAutoSymbolSubstitution ? 'true' : 'false'); });
  $effect(() => { if (isBrowser && canPersistPreferences && renderFontFamily) localStorage.setItem('pref_render_font_family', renderFontFamily); });

  $effect(() => {
    if (!isBrowser || !canPersistPreferences) return;
    Object.entries(lightColors).forEach(([key, value]) => localStorage.setItem(`pref_light_${key}`, value));
  });

  $effect(() => {
    if (!isBrowser || !canPersistPreferences) return;
    Object.entries(darkColors).forEach(([key, value]) => localStorage.setItem(`pref_dark_${key}`, value));
  });

  // 마운트 시 독립 설정창 감지 및 메인 창 종료 시퀀스
  $effect(() => {
    if (!isBrowser || !hasTauriRuntime()) return;
    const label = getCurrentWindow().label;
    isSettingsWindow = label === 'settings';
    if (isSettingsWindow) {
      activeSettingsView = 'renderAppearance';
      getCurrentWindow().onCloseRequested((event) => {
        event.preventDefault();
        getCurrentWindow().hide();
      });
    } else if (label === 'main') {
      let unlistenClose: (() => void) | undefined;
      getCurrentWindow().onCloseRequested(async (event) => {
        event.preventDefault();

        if (isHandlingCloseRequest) return;
        isHandlingCloseRequest = true;
        try {
          const canClose = await shouldCloseMainWindow();
          if (!canClose) return;

          try {
            const settingsWin = await WebviewWindow.getByLabel('settings');
            if (settingsWin) {
              await settingsWin.destroy();
            }
          } catch {}

          await getCurrentWindow().destroy();
        } finally {
          isHandlingCloseRequest = false;
        }
      }).then(unlisten => {
        unlistenClose = unlisten;
      });
      return () => {
        if (unlistenClose) unlistenClose();
      };
    }
  });

  async function shouldCloseMainWindow(): Promise<boolean> {
    syncActiveTabState();
    const dirtyTabs = untrack(() => tabs.filter((tab) => tab.isDirty));
    if (dirtyTabs.length === 0) return true;

    for (const tab of dirtyTabs) {
      const canCloseTab = await confirmCloseTab(tab.id);
      if (!canCloseTab) return false;
    }

    return true;
  }

  async function refreshWindowMaximizedState() {
    if (!hasTauriRuntime()) return;

    try {
      isWindowMaximized = await getCurrentWindow().isMaximized();
    } catch {}
  }

  $effect(() => {
    if (!isBrowser || !hasTauriRuntime() || isSettingsWindow) return;

    let unlistenResized: UnlistenFn | undefined;
    void refreshWindowMaximizedState();
    getCurrentWindow().onResized(() => {
      void refreshWindowMaximizedState();
    }).then((unlisten) => {
      unlistenResized = unlisten;
    });

    return () => {
      if (unlistenResized) unlistenResized();
    };
  });

  async function confirmCloseTab(tabId: string): Promise<boolean> {
    syncActiveTabState();
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab || !tab.isDirty) return true;

    if (activeTabId !== tabId) {
      activateTab(tabId);
    }
    closeAllDropdown();

    let result: string;
    try {
      result = await message(`'${getDisplayFileName(tab)}'의 변경 내용을 저장하시겠습니까?`, {
        title: "저장 확인",
        kind: "warning",
        buttons: closeSaveButtons
      });
    } catch (err: any) {
      errorMsg = typeof err === "string" ? err : err.message || String(err);
      return false;
    }

    if (result === closeSaveButtons.yes || result === "Yes") {
      return runSaveOperation(() => saveTabFile(tabId));
    }

    if (result === closeSaveButtons.no || result === "No") {
      return true;
    }

    return false;
  }

  async function runSaveOperation(saveOperation: () => Promise<boolean>): Promise<boolean> {
    try {
      isLoading = true;
      errorMsg = null;
      closeAllDropdown();
      return await saveOperation();
    } catch (err: any) {
      errorMsg = typeof err === "string" ? err : err.message || String(err);
      return false;
    } finally {
      isLoading = false;
    }
  }

  function applySavedPath(tabId: string, targetPath: string) {
    const nextFileName = getFileNameFromPath(targetPath);
    updateTabById(tabId, {
      filePath: targetPath,
      fileName: nextFileName,
      isDirty: false
    });

    if (tabId === activeTabId) {
      filePath = targetPath;
      fileName = nextFileName;
      isDirty = false;
    }
  }

  async function writeTabContent(tabId: string, targetPath: string) {
    syncActiveTabState();
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) return;

    await invoke("write_file_content", { path: targetPath, content: tab.fileContent });
    applySavedPath(tabId, targetPath);
  }

  async function saveTabFile(tabId: string): Promise<boolean> {
    syncActiveTabState();
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) return false;

    let targetPath = tab.filePath;

    if (!targetPath) {
      const selected = await save({
        defaultPath: getSuggestedSaveFileName(tab),
        filters: textSaveFilters
      });
      if (!selected) {
        return false;
      }
      targetPath = selected;
    }

    await writeTabContent(tabId, targetPath);
    return true;
  }

  async function saveCurrentFile(): Promise<boolean> {
    return saveTabFile(activeTabId);
  }

  async function saveCurrentFileAs(): Promise<boolean> {
    syncActiveTabState();
    const tab = getActiveTab();
    if (!tab) return false;

    const selected = await save({
      defaultPath: getSuggestedSaveFileName(tab),
      filters: textSaveFilters
    });
    if (!selected) {
      return false;
    }

    await writeTabContent(activeTabId, selected);
    return true;
  }

  // storage 변경 감지 핸들러 (창 간 실시간 동기화)
  function handleStorageChange(e: StorageEvent) {
    if (!e.key) return;
    if (e.key === 'pref_theme_mode' && e.newValue && (e.newValue === 'system' || e.newValue === 'light' || e.newValue === 'dark')) themeMode = e.newValue;
    if (e.key === 'pref_source_font_size' && e.newValue) sourceFontSize = parseInt(e.newValue, 10);
    if (e.key === 'pref_render_font_size' && e.newValue) renderFontSize = parseInt(e.newValue, 10);
    if (e.key === 'pref_tab_size' && e.newValue) tabSize = parseInt(e.newValue, 10);
    if (e.key === 'pref_render_auto_pair_editing' && e.newValue) renderAutoPairEditing = e.newValue !== 'false';
    if (e.key === 'pref_render_auto_symbol_substitution' && e.newValue) renderAutoSymbolSubstitution = e.newValue !== 'false';
    if (e.key === 'pref_render_font_family' && e.newValue) renderFontFamily = e.newValue;

    if (e.key.startsWith('pref_light_') && e.newValue) {
      const field = e.key.replace('pref_light_', '') as keyof ThemeColors;
      lightColors[field] = e.newValue;
    }
    if (e.key.startsWith('pref_dark_') && e.newValue) {
      const field = e.key.replace('pref_dark_', '') as keyof ThemeColors;
      darkColors[field] = e.newValue;
    }
  }

  $effect(() => {
    if (!isBrowser) return;
    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  });

  function normalizeHexColor(value: string): string | null {
    const trimmed = value.trim();
    return hexColorRegex.test(trimmed) ? trimmed.toUpperCase() : null;
  }

  function getColorInputValue(value: string): string {
    return normalizeHexColor(value) ?? '#000000';
  }

  function formatColorCode(value: string): string {
    return normalizeHexColor(value) ?? (value.trim().toUpperCase() || '#000000');
  }

  function getReadableTextColor(value: string): string {
    const hex = getColorInputValue(value).slice(1);
    const red = parseInt(hex.slice(0, 2), 16);
    const green = parseInt(hex.slice(2, 4), 16);
    const blue = parseInt(hex.slice(4, 6), 16);

    const toLinear = (channel: number) => {
      const normalized = channel / 255;
      return normalized <= 0.03928
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
    };

    const luminance = 0.2126 * toLinear(red) + 0.7152 * toLinear(green) + 0.0722 * toLinear(blue);
    return luminance > 0.179 ? '#000000' : '#ffffff';
  }

  function getColorCodeStyle(value: string): string {
    const backgroundColor = getColorInputValue(value);
    return `background-color: ${backgroundColor}; color: ${getReadableTextColor(backgroundColor)};`;
  }

  function openColorPicker(inputId: string) {
    if (!isBrowser) return;
    const colorInput = document.getElementById(inputId) as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!colorInput) return;

    colorInput.focus({ preventScroll: true });

    try {
      if (typeof colorInput.showPicker === 'function') {
        colorInput.showPicker();
      } else {
        colorInput.click();
      }
    } catch {
      colorInput.click();
    }
  }

  function handleColorTextPointerDown(inputId: string, event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    openColorPicker(inputId);
  }

  function handleColorInput(colors: ThemeColors, field: ColorField, event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    colors[field] = target.value.toUpperCase();
  }

  function handleColorCodeKeydown(inputId: string, event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openColorPicker(inputId);
  }
  // 반응형 상태
  let lineCount = $derived(fileContent.split(/\r?\n/).length);
  let charCount = $derived(fileContent.length);

  interface ParsedLine {
    id: number;
    indentLevel: number;
    extraIndentSpaces: number;
    tokens: Token[];
  }

  function annotateTokenOffsets(tokens: Token[], lineStartOffset: number) {
    let cursorOffset = 0;

    const visit = (token: Token) => {
      if (token.children && token.children.length > 0) {
        token.children.forEach(visit);
        return;
      }

      const text = token.text || '';
      if (token.type === 'color') {
        token.start = lineStartOffset + cursorOffset;
        token.end = token.start + text.length;
      }
      cursorOffset += text.length;
    };

    tokens.forEach(visit);
  }

  function getLineStartOffsets(content: string): number[] {
    const offsets = [0];
    const newlineRegex = /\r?\n/g;
    let match: RegExpExecArray | null;

    while ((match = newlineRegex.exec(content)) !== null) {
      offsets.push(match.index + match[0].length);
    }

    return offsets;
  }

  function parseLine(
    lineText: string,
    id: number,
    tabSize: number,
    comments: CommentSyntax | null,
    state: TokenizeState | null,
    lineStartOffset: number
  ): { line: ParsedLine; state: TokenizeState | null } {
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
    const tokenized = tokenizeLineWithState(lineText, { comments, state });
    annotateTokenOffsets(tokenized.tokens, lineStartOffset);

    return {
      line: {
        id,
        indentLevel,
        extraIndentSpaces,
        tokens: tokenized.tokens
      },
      state: tokenized.state
    };
  }

  function parseLines(
    lines: string[],
    tabSize: number,
    comments: CommentSyntax | null,
    lineStartOffsets: number[]
  ): ParsedLine[] {
    let state: TokenizeState | null = null;

    return lines.map((lineText, idx) => {
      const parsed = parseLine(lineText, idx, tabSize, comments, state, lineStartOffsets[idx] ?? 0);
      state = parsed.state;
      return parsed.line;
    });
  }

  // 렌더 모드 텍스트 및 가상화 파싱 라인 생성
  let rawLines = $derived(fileContent.split(/\r?\n/));
  let lineStartOffsets = $derived(getLineStartOffsets(fileContent));
  let activeCommentSyntax = $derived(getCommentSyntaxForPath(filePath || fileName));
  let parsedLines = $derived(parseLines(rawLines, tabSize, activeCommentSyntax, lineStartOffsets));

  // 가상화 범위 계산
  let startLine = $derived(Math.max(0, Math.floor(scrollTop / measuredLineHeight) - 8));
  let endLine = $derived(Math.min(rawLines.length - 1, Math.floor((scrollTop + clientHeight) / measuredLineHeight) + 8));

  // 줄 높이 실측 로직
  function measureLineHeight() {
    if (!isBrowser) return;
    const testEl = document.createElement('div');
    const fontFamilyVal = isRenderMode ? currentRenderFontFamilyCSS : 'var(--font-notepad)';
    testEl.style.fontFamily = fontFamilyVal;
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
    const _size = currentFontSize;
    const _mode = isRenderMode;
    const _family = renderFontFamily;
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

  function focusEditorOnStartup() {
    if (!textareaEl || hasFocusedEditorOnStartup) return;
    textareaEl.focus({ preventScroll: true });
    updateCursorPosition();
    hasFocusedEditorOnStartup = true;
  }

  async function showMainWindowAfterStartup() {
    const appWindow = getCurrentWindow();

    try {
      await appWindow.setTitle(`${isDirty ? "*" : ""}${fileName} - 메모장`);
      await appWindow.show();
      await appWindow.setFocus();
    } catch (err) {
      console.error('Failed to show main window:', err);
    } finally {
      requestAnimationFrame(focusEditorOnStartup);
    }
  }

  $effect(() => {
    if (!textareaEl || isSettingsWindow || hasShownMainWindowOnStartup) return;
    hasShownMainWindowOnStartup = true;

    if (!hasTauriRuntime()) {
      requestAnimationFrame(focusEditorOnStartup);
      return;
    }

    setTimeout(() => {
      void showMainWindowAfterStartup();
    }, 0);
  });

  // 창 제목 동기화 (Rune Effect)
  $effect(() => {
    if (!hasTauriRuntime()) return;
    const appWindow = getCurrentWindow();
    const title = `${isDirty ? "*" : ""}${fileName} - 메모장`;
    appWindow.setTitle(title).catch(() => {});
  });

  // 커서 위치 업데이트
  function updateCursorPosition() {
    if (!textareaEl) return;
    const pos = textareaEl.selectionStart;
    caretOffset = pos;
    const textBeforeCursor = fileContent.substring(0, pos);
    const linesBefore = textBeforeCursor.split(/\r?\n/);
    cursorLine = linesBefore.length;
    cursorCol = linesBefore[linesBefore.length - 1].length + 1;
    updateEditorCaretColor(pos);
    updateTabById(activeTabId, {
      cursorLine,
      cursorCol,
      caretOffset,
      selectionStart: textareaEl.selectionStart,
      selectionEnd: textareaEl.selectionEnd
    });
  }

  // 변경 감지
  function handleInput(event: Event) {
    fileContent = (event.target as HTMLTextAreaElement).value;
    fileName = filePath ? fileName : getFirstLineTitle(fileContent);
    isDirty = true;
    errorMsg = null;
    updateCursorPosition();
    reconcileInlineColorPickerState();
    updateTabById(activeTabId, {
      fileName,
      fileContent,
      isDirty: true
    });
  }

  function applyEditorContentChange(nextContent: string) {
    fileContent = nextContent;
    fileName = filePath ? fileName : getFirstLineTitle(fileContent);
    isDirty = true;
    errorMsg = null;
    reconcileInlineColorPickerState();
    updateTabById(activeTabId, {
      fileName,
      fileContent,
      isDirty: true
    });
  }

  function placeEditorCaret(offset: number) {
    requestAnimationFrame(() => {
      if (!textareaEl) return;
      textareaEl.focus({ preventScroll: true });
      textareaEl.selectionStart = textareaEl.selectionEnd = offset;
      updateCursorPosition();
    });
  }

  function placeEditorSelection(start: number, end: number) {
    requestAnimationFrame(() => {
      if (!textareaEl) return;
      textareaEl.focus({ preventScroll: true });
      textareaEl.selectionStart = start;
      textareaEl.selectionEnd = end;
      updateCursorPosition();
    });
  }

  function getSelectedLineBounds(text: string, start: number, end: number): { start: number; end: number } {
    const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const adjustedEnd = end > start && text[end - 1] === '\n' ? end - 1 : end;
    const nextLineBreak = text.indexOf('\n', adjustedEnd);
    if (nextLineBreak === -1) return { start: lineStart, end: text.length };

    const lineEnd = nextLineBreak > 0 && text[nextLineBreak - 1] === '\r'
      ? nextLineBreak - 1
      : nextLineBreak;
    return { start: lineStart, end: lineEnd };
  }

  function transformSelectedLines(
    text: string,
    lineStart: number,
    lineEnd: number,
    transformLine: (line: string, absoluteLineStart: number) => string
  ): string {
    const block = text.slice(lineStart, lineEnd);
    let result = '';
    let cursor = 0;
    const lineRegex = /([^\r\n]*)(\r\n|\n|\r|$)/g;
    let match: RegExpExecArray | null;

    while ((match = lineRegex.exec(block)) !== null) {
      if (match[0] === '' && match.index === block.length) break;
      const lineText = match[1];
      const lineEnding = match[2];
      result += transformLine(lineText, lineStart + cursor) + lineEnding;
      cursor += match[0].length;
    }

    return `${text.slice(0, lineStart)}${result}${text.slice(lineEnd)}`;
  }

  function countSelectedLines(text: string, lineStart: number, lineEnd: number): number {
    const block = text.slice(lineStart, lineEnd);
    if (block.length === 0) return 1;
    return (block.match(/\r\n|\n|\r/g)?.length ?? 0) + 1;
  }

  function handleEditorTabIndent(event: KeyboardEvent): boolean {
    if (!textareaEl || event.isComposing) return false;
    if (event.key !== 'Tab') return false;
    if (event.ctrlKey || event.altKey || event.metaKey) return false;

    event.preventDefault();

    const start = textareaEl.selectionStart;
    const end = textareaEl.selectionEnd;

    if (start === end && !event.shiftKey) {
      const nextContent = `${fileContent.slice(0, start)}${editorIndentUnit}${fileContent.slice(end)}`;
      applyEditorContentChange(nextContent);
      placeEditorCaret(start + editorIndentUnit.length);
      return true;
    }

    const bounds = getSelectedLineBounds(fileContent, start, end);

    if (!event.shiftKey) {
      const lineCount = countSelectedLines(fileContent, bounds.start, bounds.end);
      const nextContent = transformSelectedLines(
        fileContent,
        bounds.start,
        bounds.end,
        (lineText) => `${editorIndentUnit}${lineText}`
      );
      applyEditorContentChange(nextContent);
      if (start === end) {
        placeEditorSelection(start + editorIndentUnit.length, end + editorIndentUnit.length);
      } else {
        const nextStart = start === bounds.start ? start : start + editorIndentUnit.length;
        placeEditorSelection(nextStart, end + editorIndentUnit.length * lineCount);
      }
      return true;
    }

    let removedBeforeStart = 0;
    let removedBeforeEnd = 0;
    const nextContent = transformSelectedLines(
      fileContent,
      bounds.start,
      bounds.end,
      (lineText, absoluteLineStart) => {
        const removeCount = lineText.startsWith('\t')
          ? 1
          : Math.min(lineText.match(/^ {1,4}/)?.[0].length ?? 0, editorIndentUnit.length);
        const removeEnd = absoluteLineStart + removeCount;
        if (absoluteLineStart < start) {
          removedBeforeStart += Math.max(0, Math.min(removeEnd, start) - absoluteLineStart);
        }
        if (absoluteLineStart < end) {
          removedBeforeEnd += Math.max(0, Math.min(removeEnd, end) - absoluteLineStart);
        }
        return lineText.slice(removeCount);
      }
    );

    applyEditorContentChange(nextContent);
    placeEditorSelection(start - removedBeforeStart, end - removedBeforeEnd);
    return true;
  }

  function handleEditorIndentBackspace(event: KeyboardEvent): boolean {
    if (!textareaEl || event.isComposing) return false;
    if (event.key !== 'Backspace') return false;
    if (event.ctrlKey || event.altKey || event.metaKey) return false;

    const start = textareaEl.selectionStart;
    const end = textareaEl.selectionEnd;
    if (start !== end || start === 0) return false;

    const lineStart = fileContent.lastIndexOf('\n', start - 1) + 1;
    if (start === lineStart) return false;

    const linePrefix = fileContent.slice(lineStart, start);
    if (!/^[ \t]+$/.test(linePrefix)) return false;

    const trailingSpaces = linePrefix.match(/ +$/)?.[0].length ?? 0;
    const removeCount = trailingSpaces > 0
      ? ((trailingSpaces - 1) % editorIndentUnit.length) + 1
      : 1;
    const nextStart = start - removeCount;
    const nextContent = `${fileContent.slice(0, nextStart)}${fileContent.slice(start)}`;

    event.preventDefault();
    applyEditorContentChange(nextContent);
    placeEditorCaret(nextStart);
    return true;
  }

  function handleRenderAutoPairInput(event: KeyboardEvent): boolean {
    if (!renderAutoPairEditing) return false;
    if (!isRenderMode || !textareaEl || event.isComposing) return false;
    if (event.ctrlKey || event.altKey || event.metaKey) return false;

    const closingChar = renderAutoClosingPairs[event.key];
    if (!closingChar) return false;

    const start = textareaEl.selectionStart;
    const end = textareaEl.selectionEnd;
    if (start !== end) return false;
    if (fileContent[start] === closingChar) return false;

    event.preventDefault();

    const nextContent = `${fileContent.slice(0, start)}${event.key}${closingChar}${fileContent.slice(end)}`;
    applyEditorContentChange(nextContent);
    placeEditorCaret(start + 1);

    return true;
  }

  function handleRenderAutoPairBackspace(event: KeyboardEvent): boolean {
    if (!renderAutoPairEditing) return false;
    if (!isRenderMode || !textareaEl || event.isComposing) return false;
    if (event.key !== 'Backspace') return false;
    if (event.ctrlKey || event.altKey || event.metaKey) return false;

    const start = textareaEl.selectionStart;
    const end = textareaEl.selectionEnd;
    if (start !== end || start === 0) return false;

    const openingChar = fileContent[start - 1];
    const closingChar = renderAutoClosingPairs[openingChar];
    if (!closingChar || fileContent[start] !== closingChar) return false;

    event.preventDefault();

    const nextContent = `${fileContent.slice(0, start - 1)}${fileContent.slice(start + 1)}`;
    applyEditorContentChange(nextContent);
    placeEditorCaret(start - 1);

    return true;
  }

  function handleRenderAutoSubstitutionSpace(event: KeyboardEvent): boolean {
    if (!renderAutoSymbolSubstitution) return false;
    if (!isRenderMode || !textareaEl || event.isComposing) return false;
    if (event.key !== ' ') return false;
    if (event.ctrlKey || event.altKey || event.metaKey) return false;

    const start = textareaEl.selectionStart;
    const end = textareaEl.selectionEnd;
    if (start !== end || start === 0) return false;

    const trigger = renderAutoSubstitutionTriggers.find((candidate) => {
      const triggerStart = start - candidate.length;
      if (triggerStart < 0) return false;
      if (fileContent.slice(triggerStart, start) !== candidate) return false;
      return triggerStart === 0 || /\s/.test(fileContent[triggerStart - 1]);
    });
    if (!trigger) return false;

    event.preventDefault();

    const triggerStart = start - trigger.length;
    const substitution = renderAutoSubstitutions[trigger];
    const nextContent = `${fileContent.slice(0, triggerStart)}${substitution} ${fileContent.slice(end)}`;
    applyEditorContentChange(nextContent);
    placeEditorCaret(triggerStart + substitution.length + 1);

    return true;
  }

  function handleEditorKeyDown(event: KeyboardEvent) {
    if (handleEditorTabIndent(event)) return;
    if (handleEditorIndentBackspace(event)) return;
    if (handleRenderAutoPairBackspace(event)) return;
    if (handleRenderAutoSubstitutionSpace(event)) return;
    handleRenderAutoPairInput(event);
  }

  // 새 탭 생성
  function handleNewFile() {
    handleAddTab();
  }

  // 파일 열기
  async function handleOpenFile() {
    try {
      isLoading = true;
      errorMsg = null;
      syncActiveTabState();
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
        const content = await invoke<string>("read_file_content", { path: selected });
        const openedTab = createEditorTab({
          filePath: selected,
          fileName: getFileNameFromPath(selected),
          fileContent: content,
          isDirty: false
        });
        const activeTab = getActiveTab();

        if (activeTab && isCleanUntitledTab(activeTab)) {
          replaceActiveTabWith(openedTab);
        } else {
          addTab(openedTab);
        }
      }
    } catch (err: any) {
      errorMsg = typeof err === "string" ? err : err.message || String(err);
    } finally {
      isLoading = false;
    }
  }

  // 파일 저장
  async function handleSaveFile() {
    await runSaveOperation(saveCurrentFile);
  }

  // 다른 이름으로 저장
  async function handleSaveAsFile() {
    await runSaveOperation(saveCurrentFileAs);
  }

  // 앱 종료
  function handleExit() {
    // onCloseRequested 이벤트 리스너가 저장 여부를 묻고
    // 설정창도 함께 닫아주므로 여기서 바로 close만 호출합니다.
    getCurrentWindow().close().catch(() => {});
  }

  async function handleTitlebarPointerDown(event: PointerEvent) {
    if (!hasTauriRuntime() || event.button !== 0 || event.detail > 1) return;
    await getCurrentWindow().startDragging().catch(() => {});
  }

  async function handleTitlebarDoubleClick(event: MouseEvent) {
    if (!hasTauriRuntime() || event.button !== 0) return;
    event.preventDefault();
    await getCurrentWindow().toggleMaximize().catch(() => {});
    await refreshWindowMaximizedState();
  }

  async function handleWindowMinimize(event: MouseEvent) {
    event.stopPropagation();
    if (!hasTauriRuntime()) return;
    await getCurrentWindow().minimize().catch(() => {});
  }

  async function handleWindowToggleMaximize(event: MouseEvent) {
    event.stopPropagation();
    if (!hasTauriRuntime()) return;
    await getCurrentWindow().toggleMaximize().catch(() => {});
    await refreshWindowMaximizedState();
  }

  function handleWindowClose(event: MouseEvent) {
    event.stopPropagation();
    handleExit();
  }

  // 설정 창 열기 (독립 윈도우)
  async function centerSettingsWindowOverMain(settingsWindow: WebviewWindow) {
    const mainWindow = getCurrentWindow();
    const [mainPosition, mainSize, settingsSize] = await Promise.all([
      mainWindow.outerPosition(),
      mainWindow.outerSize(),
      settingsWindow.outerSize()
    ]);

    const x = Math.round(mainPosition.x + (mainSize.width - settingsSize.width) / 2);
    const y = Math.round(mainPosition.y + (mainSize.height - settingsSize.height) / 2);
    await settingsWindow.setPosition(new PhysicalPosition(x, y));
  }

  async function centerSettingsWindowOnFirstOpen(settingsWindow: WebviewWindow) {
    if (hasCenteredSettingsWindowThisSession) return;

    try {
      await centerSettingsWindowOverMain(settingsWindow);
      hasCenteredSettingsWindowThisSession = true;
    } catch (err) {
      console.warn('Failed to center settings window:', err);
    }
  }

  async function handleSettingsTrigger(e: MouseEvent) {
    e.stopPropagation();
    try {
      const win = await WebviewWindow.getByLabel('settings');
      if (win) {
        await centerSettingsWindowOnFirstOpen(win);
        await win.show();
        await win.setFocus();
      } else {
        const settingsUrl = isBrowser ? window.location.origin + '/' : '/';

        const settingsWin = new WebviewWindow('settings', {
          url: settingsUrl,
          title: '설정',
          width: 800,
          height: 580,
          resizable: true,
          visible: false
        });
        settingsWin.once('tauri://created', async () => {
          try {
            await centerSettingsWindowOnFirstOpen(settingsWin);
            await settingsWin.show();
            await settingsWin.setFocus();
          } catch (err) {
            console.error('Failed to show settings window:', err);
          }
        });
        settingsWin.once('tauri://error', (event) => {
          console.error('Failed to create settings window:', event.payload);
        });
      }
    } catch (err: any) {
      try {
        await message(`Error: ${err.message || err}`);
      } catch {}
      console.error('Failed to open settings window:', err);
    }
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
    reconcileInlineColorPickerState();
    syncActiveTabState();

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
    reconcileInlineColorPickerState();
    syncActiveTabState();

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
      reconcileInlineColorPickerState();
      syncActiveTabState();

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
    reconcileInlineColorPickerState();
    syncActiveTabState();

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
      scrollLeft = textareaEl.scrollLeft;
      updateTabById(activeTabId, { scrollLeft });
      e.preventDefault();
    }
    // Shift 키를 누르고 세로 휠을 돌릴 때 가로 스크롤 매핑
    else if (e.shiftKey && e.deltaY !== 0) {
      textareaEl.scrollLeft += e.deltaY;
      scrollLeft = textareaEl.scrollLeft;
      updateTabById(activeTabId, { scrollLeft });
      e.preventDefault();
    }
  }

  // 스크롤 갱신 핸들러
  function handleScroll(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    scrollTop = target.scrollTop;
    scrollLeft = target.scrollLeft;
    updateTabById(activeTabId, { scrollTop, scrollLeft });
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
    const unlistenPromise = hasTauriRuntime()
      ? listen<number>("native-horizontal-wheel", (event: TauriEvent<number>) => {
          if (!textareaEl) return;
          const delta = event.payload;
          // OS의 delta 값(보통 120 또는 -120)을 받아 가로 스크롤에 직접 반영
          // 윈도우 OS의 가로 스크롤 한 틱 단위가 대개 120이므로, 120px 만큼 스크롤됩니다.
          textareaEl.scrollLeft += delta;
          scrollTop = textareaEl.scrollTop;
          scrollLeft = textareaEl.scrollLeft;
          updateTabById(activeTabId, { scrollTop, scrollLeft });

          // 디버그 텍스트 갱신
          wheelDebug = `Native dX: ${delta}`;
        })
      : null;

    return () => {
      if (textareaEl) {
        textareaEl.removeEventListener('wheel', onWheelNative);
      }
      unlistenPromise?.then((unlisten: UnlistenFn) => unlisten());
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
    } else if (e.ctrlKey && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      handleCloseTab(activeTabId);
    } else if (e.key === 'F5') {
      e.preventDefault();
      insertDateTime();
    }
  }

  const depthColorCount = 5;

  function getTokenClass(token: Token): string {
    const classes = [`hl-${token.type}`];
    if (token.depth !== undefined) {
      classes.push(`hl-depth-${token.depth % depthColorCount}`);
    }
    return classes.join(' ');
  }

  let inlineColorPickerEl = $state<HTMLInputElement | null>(null);
  let inlineColorPickerValue = $state<string>('#000000');
  let pendingInlineColorReplacement = $state<{ start: number; end: number } | null>(null);
  let suppressNextEditorClickAfterColorOpen = false;
  const parkedInlineColorPickerPosition = { left: -10000, top: -10000 };
  let inlineColorPickerPosition = $state<{ left: number; top: number }>({ ...parkedInlineColorPickerPosition });
  const hexColorInContentRegex = /#[0-9a-fA-F]{6}/g;

  function hasWhitespaceWordBoundary(text: string, start: number, end: number): boolean {
    const previousChar = text[start - 1];
    const nextChar = text[end];

    return (!previousChar || /\s/.test(previousChar)) && (!nextChar || /\s/.test(nextChar));
  }

  function setInlineColorPickerPosition(position: { left: number; top: number }) {
    inlineColorPickerPosition = position;
    if (!inlineColorPickerEl) return;
    inlineColorPickerEl.style.left = `${position.left}px`;
    inlineColorPickerEl.style.top = `${position.top}px`;
  }

  function parkInlineColorPickerAnchor() {
    setInlineColorPickerPosition({ ...parkedInlineColorPickerPosition });
  }

  function clearInlineColorPickerState() {
    pendingInlineColorReplacement = null;
    parkInlineColorPickerAnchor();
  }

  function reconcileInlineColorPickerState() {
    if (!pendingInlineColorReplacement) return;
    const { start, end } = pendingInlineColorReplacement;
    const currentValue = fileContent.slice(start, end);

    if (!hexColorRegex.test(currentValue)) {
      clearInlineColorPickerState();
    }
  }

  function findColorCodeAtOffset(text: string, offset: number): { start: number; end: number; value: string } | null {
    hexColorInContentRegex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = hexColorInContentRegex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (!hasWhitespaceWordBoundary(text, start, end)) continue;
      if (offset >= start && offset < end) {
        return { start, end, value: match[0] };
      }
    }

    return null;
  }

  function findColorCodeAtCaretOffset(text: string, offset: number): { start: number; end: number; value: string } | null {
    hexColorInContentRegex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = hexColorInContentRegex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (!hasWhitespaceWordBoundary(text, start, end)) continue;
      if (offset > start && offset < end) {
        return { start, end, value: match[0] };
      }
    }

    return null;
  }

  function updateEditorCaretColor(offset: number) {
    const activeColor = isRenderMode ? findColorCodeAtCaretOffset(fileContent, offset) : null;
    editorCaretColor = activeColor
      ? getReadableTextColor(activeColor.value)
      : 'var(--color-render-text, var(--text-color))';
  }

  function getColorTokenElement(range: { start: number; end: number }) {
    if (!isBrowser) return null;
    return document.querySelector(
      `.hl-color[data-color-start="${range.start}"][data-color-end="${range.end}"]`
    ) as HTMLElement | null;
  }

  function findColorCodeAtPoint(clientX: number, clientY: number): { start: number; end: number; value: string } | null {
    if (!isBrowser || !isRenderMode) return null;
    const elements = document.querySelectorAll<HTMLElement>('.hl-color[data-color-start][data-color-end]');

    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue;

      const start = Number(element.dataset.colorStart);
      const end = Number(element.dataset.colorEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

      return {
        start,
        end,
        value: element.textContent || fileContent.slice(start, end)
      };
    }

    return null;
  }

  function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
  }

  function positionInlineColorPicker(range: { start: number; end: number }) {
    if (!editorViewportEl) return;

    const tokenElement = getColorTokenElement(range);
    const viewportRect = editorViewportEl.getBoundingClientRect();
    const tokenRect = tokenElement?.getBoundingClientRect();
    const pickerAnchorSize = 1;
    const gap = 6;
    const margin = 8;

    if (!tokenRect) {
      setInlineColorPickerPosition({ left: margin, top: margin });
      return;
    }

    const target = {
      left: tokenRect.left - viewportRect.left,
      top: tokenRect.top - viewportRect.top,
      width: tokenRect.width,
      height: tokenRect.height
    };
    const viewportWidth = Math.max(viewportRect.width, pickerAnchorSize + margin * 2);
    const viewportHeight = Math.max(viewportRect.height, pickerAnchorSize + margin * 2);
    const maxLeft = viewportWidth - pickerAnchorSize - margin;
    const maxTop = viewportHeight - pickerAnchorSize - margin;

    const candidates = [
      { left: target.left + target.width + gap, top: target.top + target.height / 2 },
      { left: target.left - gap, top: target.top + target.height / 2 },
      { left: target.left, top: target.top + target.height + gap },
      { left: target.left, top: target.top - gap }
    ].map((candidate) => ({
      left: clamp(candidate.left, margin, maxLeft),
      top: clamp(candidate.top, margin, maxTop)
    }));

    const positioned = candidates[0];
    setInlineColorPickerPosition({
      left: positioned.left,
      top: positioned.top
    });
  }

  function openInlineColorPicker(range: { start: number; end: number; value: string }) {
    pendingInlineColorReplacement = { start: range.start, end: range.end };
    const nextValue = getColorInputValue(range.value);
    inlineColorPickerValue = nextValue;
    if (inlineColorPickerEl) {
      inlineColorPickerEl.value = nextValue;
    }
    positionInlineColorPicker(range);

    inlineColorPickerEl?.focus({ preventScroll: true });

    try {
      if (typeof inlineColorPickerEl?.showPicker === 'function') {
        inlineColorPickerEl.showPicker();
      } else {
        inlineColorPickerEl?.click();
      }
    } catch {
      inlineColorPickerEl?.click();
    }
  }

  function handleEditorPointerDown(event: PointerEvent) {
    if (!isRenderMode || !textareaEl || event.button !== 0) return;

    const range = findColorCodeAtPoint(event.clientX, event.clientY);
    if (!range) return;

    event.preventDefault();
    suppressNextEditorClickAfterColorOpen = true;
    textareaEl.focus({ preventScroll: true });
    textareaEl.selectionStart = range.start;
    textareaEl.selectionEnd = range.end;
    updateCursorPosition();
    openInlineColorPicker(range);
  }

  function handleEditorClick(event: MouseEvent) {
    updateCursorPosition();
    if (suppressNextEditorClickAfterColorOpen) {
      suppressNextEditorClickAfterColorOpen = false;
      return;
    }
    if (!isRenderMode || !textareaEl) return;
    if (textareaEl.selectionStart !== textareaEl.selectionEnd) return;

    const range = findColorCodeAtPoint(event.clientX, event.clientY)
      ?? findColorCodeAtOffset(fileContent, textareaEl.selectionStart);
    if (range) {
      openInlineColorPicker(range);
    } else {
      clearInlineColorPickerState();
    }
  }

  function handleEditorMouseMove(event: MouseEvent) {
    editorCursorStyle = findColorCodeAtPoint(event.clientX, event.clientY) ? 'pointer' : 'text';
  }

  function handleEditorMouseLeave() {
    editorCursorStyle = 'text';
  }

  function handleInlineColorPickerInput(event: Event) {
    if (!pendingInlineColorReplacement) return;
    const target = event.currentTarget as HTMLInputElement;
    const nextValue = target.value.toUpperCase();
    const { start, end } = pendingInlineColorReplacement;

    fileContent = `${fileContent.slice(0, start)}${nextValue}${fileContent.slice(end)}`;
    inlineColorPickerValue = nextValue;
    pendingInlineColorReplacement = { start, end: start + nextValue.length };
    isDirty = true;
    updateEditorCaretColor(caretOffset);
    syncActiveTabState();

    requestAnimationFrame(() => {
      if (!textareaEl) return;
      textareaEl.selectionStart = start;
      textareaEl.selectionEnd = start + nextValue.length;
      updateCursorPosition();
      if (pendingInlineColorReplacement) {
        positionInlineColorPicker({ start, end: start + nextValue.length });
      }
    });
  }

  function handleInlineColorPickerChange() {
    clearInlineColorPickerState();
  }

  function toggleRenderMode() {
    isRenderMode = !isRenderMode;
    editorCursorStyle = 'text';
    clearInlineColorPickerState();
    requestAnimationFrame(() => updateCursorPosition());
  }
</script>

<svelte:window onkeydown={handleKeyDown} onclick={closeAllDropdown} />

{#snippet renderToken(token: Token)}{#if token.children && token.children.length > 0}<span class={getTokenClass(token)}>{#each token.children as child}{@render renderToken(child)}{/each}</span>{:else if token.type === 'color'}<span class={getTokenClass(token)} style={getColorCodeStyle(token.text || '')} data-color-start={token.start} data-color-end={token.end}>{token.text || ''}</span>{:else}<span class={getTokenClass(token)}>{token.text || ''}</span>{/if}{/snippet}

{#snippet colorSettingRow(id: string, labelText: string, colors: ThemeColors, field: ColorField)}
  {@const pickerId = `${id}-picker`}
  <div class="settings-row color-row">
    <label for={id}>{labelText}</label>
    <div class="color-picker-wrapper">
      <input
        id={pickerId}
        class="color-picker-native"
        type="color"
        value={getColorInputValue(colors[field])}
        oninput={(event) => handleColorInput(colors, field, event)}
        tabindex="-1"
        aria-hidden="true"
      />
      <input
        id={id}
        type="text"
        readonly
        class="color-text-input"
        value={formatColorCode(colors[field])}
        style={getColorCodeStyle(colors[field])}
        onpointerdown={(event) => handleColorTextPointerDown(pickerId, event)}
        onkeydown={(event) => handleColorCodeKeydown(pickerId, event)}
        aria-label={labelText}
      />
    </div>
  </div>
{/snippet}

{#if isSettingsWindow}
  <div class="settings-window-container" style="
    --color-hl-code-bg: {activeColors.codeBg};
    --color-hl-code-text: {activeColors.codeText};
    --color-hl-string: {activeColors.string};
    --color-hl-number: {activeColors.number};
    --color-hl-comment: {activeColors.comment};
    --color-indent-guide: {activeColors.guide};
    --color-render-bg: {activeColors.renderBg};
    --color-render-text: {activeColors.renderText};
    --font-render-family: {currentRenderFontFamilyCSS};
    --font-render-weight: {activeColors.renderFontWeight};
    --color-hl-paren: {activeColors.paren};
    --color-hl-bracket: {activeColors.bracket};
    --color-hl-brace: {activeColors.brace};
  ">
    <div class="settings-body window-mode">
      <!-- 좌측 네비게이션 메뉴 -->
      <aside class="settings-sidebar" aria-label="설정 분류">
        <div class="sidebar-tree-group">
          <button
            type="button"
            class="sidebar-group"
            aria-expanded={isSourceSettingsExpanded}
            onclick={() => isSourceSettingsExpanded = !isSourceSettingsExpanded}
          >
            <ChevronDown size={14} class={isSourceSettingsExpanded ? 'tree-chevron' : 'tree-chevron collapsed'}/>
            <FileCode2 size={16} class="tab-icon"/> 원본 모드
          </button>
          {#if isSourceSettingsExpanded}
            <button
              type="button"
              class="sidebar-item tree-child"
              class:active={activeSettingsView === 'sourceAppearance'}
              onclick={() => activeSettingsView = 'sourceAppearance'}
            >
              <PaintRoller size={15} class="tab-icon"/> 모양
            </button>
          {/if}
        </div>

        <div class="sidebar-tree-group">
          <button
            type="button"
            class="sidebar-group"
            aria-expanded={isRenderSettingsExpanded}
            onclick={() => isRenderSettingsExpanded = !isRenderSettingsExpanded}
          >
            <ChevronDown size={14} class={isRenderSettingsExpanded ? 'tree-chevron' : 'tree-chevron collapsed'}/>
            <PaintRoller size={16} class="tab-icon"/> 렌더 모드
          </button>
          {#if isRenderSettingsExpanded}
            <button
              type="button"
              class="sidebar-item tree-child"
              class:active={activeSettingsView === 'renderAppearance'}
              onclick={() => activeSettingsView = 'renderAppearance'}
            >
              <PaintRoller size={15} class="tab-icon"/> 모양
            </button>
            <button
              type="button"
              class="sidebar-item tree-child"
              class:active={activeSettingsView === 'renderEditing'}
              onclick={() => activeSettingsView = 'renderEditing'}
            >
              <PenLine size={15} class="tab-icon"/> 편집
            </button>
          {/if}
        </div>
      </aside>

      <!-- 우측 메인 콘텐츠 영역 -->
      <div class="settings-main">
        {#if activeSettingsView === 'sourceAppearance'}
          <div class="settings-section">
            <h4 class="section-title">글꼴 설정</h4>
            <div class="settings-row">
              <label for="source-font-size-input-window">글꼴 크기 (pt)</label>
              <div class="size-control">
                <input
                  id="source-font-size-input-window"
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
        {:else if activeSettingsView === 'renderAppearance'}
          <div class="settings-section">
            <h4 class="section-title">화면 및 글꼴</h4>
            <div class="settings-row">
              <label for="render-font-size-input-window">글꼴 크기 (pt)</label>
              <div class="size-control">
                <input
                  id="render-font-size-input-window"
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
              <label for="tab-size-select-window">들여쓰기 너비 (공백 개수)</label>
              <select id="tab-size-select-window" bind:value={tabSize} class="tab-size-select">
                <option value={2}>2</option>
                <option value={4}>4</option>
                <option value={8}>8</option>
              </select>
            </div>

            <div class="settings-row">
              <label for="render-font-family-select-window">렌더 모드 글꼴</label>
              <select id="render-font-family-select-window" bind:value={renderFontFamily} class="tab-size-select" style="width: 195px; text-align-last: center;">
                <optgroup label="기본">
                  <option value="nanum-gothic">나눔고딕</option>
                  <option value="notepad">기본 글꼴</option>
                </optgroup>
                <optgroup label="고정폭 (Monospace)">
                  <option value="jetbrains-mono">JetBrains Mono</option>
                  <option value="d2coding">D2Coding</option>
                  <option value="nanum-gothic-coding">나눔고딕 코딩</option>
                  <option value="fira-code">Fira Code</option>
                  <option value="roboto-mono">Roboto Mono</option>
                  <option value="cascadia-mono">Cascadia Mono</option>
                  <option value="consolas">Consolas</option>
                </optgroup>
              </select>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-row" style="margin-bottom: 0.75rem;">
              <h4 class="section-title">시각적 테마 색상 설정</h4>

              <div class="theme-edit-toggle">
                <button
                  class="theme-toggle-btn"
                  class:active={editingTheme === 'light'}
                  onclick={() => editingTheme = 'light'}
                >
                  <Sun size={16} class="tab-icon"/> 라이트
                </button>
                <button
                  class="theme-toggle-btn"
                  class:active={editingTheme === 'dark'}
                  onclick={() => editingTheme = 'dark'}
                >
                  <Moon size={16} class="tab-icon"/> 다크
                </button>
              </div>
            </div>

            {#if editingTheme === 'dark'}
              {@render colorSettingRow('color-render-bg-window-dark', '렌더 모드 배경색', darkColors, 'renderBg')}
              {@render colorSettingRow('color-render-text-window-dark', '렌더 모드 기본 글자 색상', darkColors, 'renderText')}

              <div class="settings-row color-row">
                <label for="render-font-weight-window-dark">렌더 모드 폰트 굵기</label>
                <select id="render-font-weight-window-dark" bind:value={darkColors.renderFontWeight} class="tab-size-select" style="width: 140px;">
                  <option value="300">Light</option>
                  <option value="400">Normal</option>
                  <option value="500">Medium</option>
                  <option value="600">Semi Bold</option>
                  <option value="700">Bold</option>
                </select>
              </div>

              {@render colorSettingRow('color-hl-code-bg-window-dark', '코드 백그라운드 색상', darkColors, 'codeBg')}
              {@render colorSettingRow('color-hl-code-text-window-dark', '코드 글자 색상', darkColors, 'codeText')}
              {@render colorSettingRow('color-hl-string-window-dark', `문자열 색상 ('...', "...")`, darkColors, 'string')}
              {@render colorSettingRow('color-hl-number-window-dark', '숫자 색상 (0-9)', darkColors, 'number')}
              {@render colorSettingRow('color-hl-comment-window-dark', '파일 형식별 주석 색상', darkColors, 'comment')}
              {@render colorSettingRow('color-hl-paren-window-dark', '소괄호 색상 ( )', darkColors, 'paren')}
              {@render colorSettingRow('color-hl-bracket-window-dark', '대괄호 색상 [ ]', darkColors, 'bracket')}
              {@render colorSettingRow('color-hl-brace-window-dark', '중괄호 색상 { }', darkColors, 'brace')}
              {@render colorSettingRow('color-indent-guide-window-dark', '들여쓰기 가이드라인 색상', darkColors, 'guide')}
            {:else}
              {@render colorSettingRow('color-render-bg-window-light', '렌더 모드 배경색', lightColors, 'renderBg')}
              {@render colorSettingRow('color-render-text-window-light', '렌더 모드 기본 글자 색상', lightColors, 'renderText')}

              <div class="settings-row color-row">
                <label for="render-font-weight-window-light">렌더 모드 폰트 굵기</label>
                <select id="render-font-weight-window-light" bind:value={lightColors.renderFontWeight} class="tab-size-select" style="width: 140px;">
                  <option value="300">Light</option>
                  <option value="400">Normal</option>
                  <option value="500">Medium</option>
                  <option value="600">Semi Bold</option>
                  <option value="700">Bold</option>
                </select>
              </div>

              {@render colorSettingRow('color-hl-code-bg-window-light', '코드 백그라운드 색상', lightColors, 'codeBg')}
              {@render colorSettingRow('color-hl-code-text-window-light', '코드 글자 색상', lightColors, 'codeText')}
              {@render colorSettingRow('color-hl-string-window-light', `문자열 색상 ('...', "...")`, lightColors, 'string')}
              {@render colorSettingRow('color-hl-number-window-light', '숫자 색상 (0-9)', lightColors, 'number')}
              {@render colorSettingRow('color-hl-comment-window-light', '파일 형식별 주석 색상', lightColors, 'comment')}
              {@render colorSettingRow('color-hl-paren-window-light', '소괄호 색상 ( )', lightColors, 'paren')}
              {@render colorSettingRow('color-hl-bracket-window-light', '대괄호 색상 [ ]', lightColors, 'bracket')}
              {@render colorSettingRow('color-hl-brace-window-light', '중괄호 색상 { }', lightColors, 'brace')}
              {@render colorSettingRow('color-indent-guide-window-light', '들여쓰기 가이드라인 색상', lightColors, 'guide')}
            {/if}

            <div class="settings-action-row">
              <button class="reset-colors-btn" onclick={resetColorsToDefault}>
                기본 색상으로 복원
              </button>
            </div>
          </div>
        {:else if activeSettingsView === 'renderEditing'}
          <div class="settings-section">
            <h4 class="section-title">자동 입력</h4>
            <label class="settings-check-row" for="render-auto-pair-editing-window">
              <input
                id="render-auto-pair-editing-window"
                class="settings-checkbox"
                type="checkbox"
                bind:checked={renderAutoPairEditing}
              />
              <span class="settings-check-copy">
                <span class="settings-check-title">쌍 문자 자동 입력 및 삭제</span>
                <span class="settings-check-description">( )나 &#123; &#125; 같은 괄호 및 따옴표를 하나만 입력해도 자동으로 쌍을 생성합니다.</span>
              </span>
            </label>
            <label class="settings-check-row" for="render-auto-symbol-substitution-window">
              <input
                id="render-auto-symbol-substitution-window"
                class="settings-checkbox"
                type="checkbox"
                bind:checked={renderAutoSymbolSubstitution}
              />
              <span class="settings-check-copy">
                <span class="settings-check-title">화살표 기호 자동 변환</span>
                <span class="settings-check-description">-->나 ==> 같은 기호를 단독으로 입력한 뒤 스페이스를 누르면 →나 ⇒로 변환합니다.</span>
              </span>
            </label>
          </div>
        {/if}
      </div>
    </div>
  </div>
{:else}
  <div class="app-container" style="
    --color-hl-code-bg: {activeColors.codeBg};
    --color-hl-code-text: {activeColors.codeText};
    --color-hl-string: {activeColors.string};
    --color-hl-number: {activeColors.number};
    --color-hl-comment: {activeColors.comment};
    --color-indent-guide: {activeColors.guide};
    --color-render-bg: {activeColors.renderBg};
    --color-render-text: {activeColors.renderText};
    --font-render-family: {currentRenderFontFamilyCSS};
    --font-render-weight: {activeColors.renderFontWeight};
    --color-hl-paren: {activeColors.paren};
    --color-hl-bracket: {activeColors.bracket};
    --color-hl-brace: {activeColors.brace};
  ">
    <!-- 통합 제목 표시줄 및 탭 영역 -->
    <div class="title-tab-bar">
      <div
        class="titlebar-app-icon"
        data-tauri-drag-region
        aria-hidden="true"
        onpointerdown={handleTitlebarPointerDown}
        ondblclick={handleTitlebarDoubleClick}
      >
        <img class="titlebar-app-image" src="/favicon.png" alt="" draggable="false" />
      </div>

      <div class="titlebar-tabs">
        <div class="tab-list" role="tablist" aria-label="열린 파일 탭">
          {#each tabs as tab (tab.id)}
            <div class="tab-item" class:active={tab.id === activeTabId} class:dirty={tab.isDirty}>
              <button
                type="button"
                class="tab-select"
                role="tab"
                aria-selected={tab.id === activeTabId}
                title={tab.filePath || getDisplayFileName(tab)}
                onclick={() => activateTab(tab.id)}
              >
                {#if tab.isDirty}
                  <span class="tab-dirty-dot" aria-hidden="true"></span>
                {/if}
                <span class="tab-title">{getDisplayFileName(tab)}</span>
              </button>
              <button
                type="button"
                class="tab-close-btn"
                aria-label={`${getDisplayFileName(tab)} 탭 닫기`}
                title="탭 닫기"
                onclick={(event) => handleCloseTab(tab.id, event)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          {/each}
        </div>
        <button
          type="button"
          class="tab-add-btn"
          aria-label="새 탭"
          title="새 탭"
          onclick={handleAddTab}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
        <div
          class="titlebar-drag-region"
          data-tauri-drag-region
          aria-hidden="true"
          onpointerdown={handleTitlebarPointerDown}
          ondblclick={handleTitlebarDoubleClick}
        ></div>
      </div>

      <div class="window-control-group" aria-label="창 제어">
        <button
          type="button"
          class="window-control-btn"
          aria-label="창 최소화"
          title="최소화"
          onclick={handleWindowMinimize}
        >
          <Minus size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          class="window-control-btn"
          aria-label={isWindowMaximized ? "창 복원" : "창 최대화"}
          title={isWindowMaximized ? "복원" : "최대화"}
          onclick={handleWindowToggleMaximize}
        >
          {#if isWindowMaximized}
            <Copy size={15} aria-hidden="true" />
          {:else}
            <Square size={14} aria-hidden="true" />
          {/if}
        </button>
        <button
          type="button"
          class="window-control-btn close"
          aria-label="창 닫기"
          title="닫기"
          onclick={handleWindowClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>

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
                <span class="item-label">새 탭</span>
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
          class="theme-mode-toggle"
          onclick={() => {
            if (themeMode === 'system') themeMode = systemIsDark ? 'light' : 'dark';
            else themeMode = themeMode === 'light' ? 'dark' : 'light';
          }}
          title="테마 모드 변경"
        >
          {#if currentTheme === 'dark'}
            <Moon size={18} />
          {:else}
            <Sun size={18} />
          {/if}
        </button>

        <button
          class="render-mode-toggle"
          class:active={isRenderMode}
          onclick={toggleRenderMode}
          title={isRenderMode ? "원본 모드로 전환" : "렌더 모드로 전환"}
        >
          {#if isRenderMode}
            <PaintRoller size={18} />
          {:else}
            <FileCode2 size={18} />
          {/if}
        </button>

        <button
          class="settings-trigger"
          onclick={handleSettingsTrigger}
          title="설정"
        >
          <Settings size={18} />
        </button>
      </div>
    </nav>

    <!-- 편집 공간 -->
    <main class="editor-area" class:render-mode={isRenderMode}>
      <div class="editor-container">
        <!-- 라인 번호 Gutter -->
        {#if isRenderMode}
          <div class="editor-gutter" style="background-color: var(--color-render-bg); border-right: 1px solid var(--border-color);">
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
                    <div class="backdrop-line" style="position: absolute; top: {lineIdx * measuredLineHeight + 8}px; left: 0; height: {measuredLineHeight}px; line-height: {measuredLineHeight}px; font-size: {currentFontSize}pt; tab-size: {tabSize}; -moz-tab-size: {tabSize};">{#each Array(line.indentLevel) as _, i}<span class="guide-line" style="left: calc({i * tabSize}ch + 12px);"></span>{/each}<span class="line-content">{#each line.tokens as token}{@render renderToken(token)}{/each}</span></div>
                  {/if}
                {/each}
              </div>
            </div>
          {/if}

          <textarea
            bind:this={textareaEl}
            class="editor-textarea"
            style="font-size: {currentFontSize}pt; line-height: {measuredLineHeight}px; tab-size: {tabSize}; -moz-tab-size: {tabSize}; caret-color: {isRenderMode ? editorCaretColor : 'var(--text-color)'}; cursor: {isRenderMode ? editorCursorStyle : 'text'};"
            bind:value={fileContent}
            onkeydown={handleEditorKeyDown}
            oninput={handleInput}
            onscroll={handleScroll}
            onpointerdown={handleEditorPointerDown}
            onkeyup={updateCursorPosition}
            onclick={handleEditorClick}
            onmousemove={handleEditorMouseMove}
            onmouseleave={handleEditorMouseLeave}
            onfocus={updateCursorPosition}
            spellcheck="false"
          ></textarea>
          <input
            bind:this={inlineColorPickerEl}
            class="color-picker-native inline-color-picker-native"
            type="color"
            value={inlineColorPickerValue}
            style="left: {inlineColorPickerPosition.left}px; top: {inlineColorPickerPosition.top}px;"
            oninput={handleInlineColorPickerInput}
            onchange={handleInlineColorPickerChange}
            tabindex="-1"
            aria-hidden="true"
          />
        </div>
      </div>
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
{/if}

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
    --bg-tab-strip: #ececec;
    --bg-tab-active: #ffffff;
    --bg-tab-hover: #f8f8f8;
    --bg-tab-button-hover: #e1e1e1;
    --tab-border-color: #d9d9d9;

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

  :global(body.theme-dark) {
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
    --bg-tab-strip: #181818;
    --bg-tab-active: #242424;
    --bg-tab-hover: #202020;
    --bg-tab-button-hover: #333333;
    --tab-border-color: #303030;

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

  /* 렌더 모드 토큰 색상 스타일 */
  :global(.hl-code) {
    background-color: var(--color-hl-code-bg);
    color: var(--color-hl-code-text);
    border-radius: 2px;
  }
  :global(.hl-string) {
    color: var(--color-hl-string);
  }
  :global(.hl-number) {
    color: var(--color-hl-number);
  }
  :global(.hl-color) {
    border-radius: 2px;
    box-shadow: inset 0 0 0 1px #9ca3af;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
    cursor: pointer;
  }
  :global(.hl-comment) {
    color: var(--color-hl-comment);
  }
  :global(.hl-text) {
    color: inherit;
  }
  :global(.hl-paren) {
    color: var(--color-hl-paren);
  }
  :global(.hl-bracket) {
    color: var(--color-hl-bracket);
  }
  :global(.hl-brace) {
    color: var(--color-hl-brace);
  }
  :global(.hl-depth-0) {
    color: var(--color-hl-paren);
  }
  :global(.hl-depth-1) {
    color: var(--color-hl-bracket);
  }
  :global(.hl-depth-2) {
    color: var(--color-hl-brace);
  }
  :global(.hl-depth-3) {
    color: var(--color-hl-string);
  }
  :global(.hl-depth-4) {
    color: var(--color-hl-code-text);
  }

  .render-mode-toggle, .theme-mode-toggle {
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

  .render-mode-toggle:hover, .render-mode-toggle.active,
  .theme-mode-toggle:hover {
    background-color: var(--bg-menu-hover);
  }

  .theme-edit-toggle {
    display: flex;
    gap: 4px;
    background-color: var(--bg-window);
    padding: 2px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
  }

  .theme-toggle-btn {
    background: transparent;
    border: none;
    color: var(--text-color);
    padding: 4px 12px;
    font-size: 0.8rem;
    border-radius: 4px;
    cursor: pointer;
    outline: none;
    transition: background 0.1s;
  }

  .theme-toggle-btn:hover {
    background-color: var(--bg-menu-hover);
  }

  .theme-toggle-btn.active {
    background-color: var(--bg-editor);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
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

  /* 통합 제목 표시줄 및 탭 디자인 */
  .title-tab-bar {
    display: flex;
    align-items: stretch;
    height: 36px;
    background-color: var(--bg-tab-strip);
    box-sizing: border-box;
    user-select: none;
    min-width: 0;
    overflow: hidden;
  }

  .titlebar-app-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    flex-shrink: 0;
  }

  .titlebar-app-image {
    width: 18px;
    height: 18px;
    object-fit: contain;
    pointer-events: none;
  }

  .titlebar-tabs {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    flex: 1 1 auto;
    min-width: 0;
    padding-top: 5px;
  }

  .titlebar-drag-region {
    align-self: stretch;
    flex: 1 1 32px;
    min-width: 16px;
  }

  .tab-list {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    flex: 0 1 auto;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
  }

  .tab-item {
    display: flex;
    align-items: center;
    flex: 0 1 252px;
    min-width: 150px;
    max-width: 272px;
    height: 32px;
    color: var(--text-color);
    background-color: transparent;
    border: 1px solid transparent;
    border-bottom: none;
    border-radius: 7px 7px 0 0;
    box-sizing: border-box;
    overflow: hidden;
  }

  .tab-item:hover {
    background-color: var(--bg-tab-hover);
  }

  .tab-item.active {
    background-color: var(--bg-tab-active);
    border-color: var(--tab-border-color);
  }

  .tab-select {
    flex: 1;
    min-width: 0;
    height: 100%;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 8px 0 12px;
    background: transparent;
    border: none;
    color: inherit;
    font-family: var(--font-ui);
    font-size: 0.78rem;
    text-align: left;
    cursor: pointer;
    outline: none;
  }

  .tab-select:focus-visible,
  .tab-close-btn:focus-visible,
  .tab-add-btn:focus-visible {
    outline: 2px solid var(--accent-color);
    outline-offset: -2px;
  }

  .tab-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-dirty-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--text-muted);
    flex-shrink: 0;
  }

  .tab-close-btn,
  .tab-add-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-color);
    cursor: pointer;
    outline: none;
    flex-shrink: 0;
  }

  .tab-close-btn {
    margin-right: 2px;
  }

  .tab-close-btn:hover,
  .tab-add-btn:hover {
    background-color: var(--bg-tab-button-hover);
  }

  .tab-add-btn {
    margin-bottom: 3px;
  }

  .window-control-group {
    display: flex;
    align-items: stretch;
    align-self: stretch;
    flex-shrink: 0;
  }

  .window-control-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    height: 100%;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 0;
    color: var(--text-color);
    cursor: pointer;
    outline: none;
  }

  .window-control-btn:hover {
    background-color: var(--bg-tab-button-hover);
  }

  .window-control-btn.close:hover {
    background-color: #c42b1c;
    color: #ffffff;
  }

  .window-control-btn:focus-visible {
    outline: 2px solid var(--accent-color);
    outline-offset: -3px;
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
    font-family: var(--font-render-family, var(--font-notepad));
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
    font-family: var(--font-render-family, var(--font-notepad));
    padding: 0 12px;
    box-sizing: border-box;
    letter-spacing: normal;
    word-spacing: normal;
    font-variant-ligatures: none;
    font-feature-settings: "liga" 0;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: subpixel-antialiased;
    -moz-osx-font-smoothing: auto;
    font-weight: var(--font-render-weight, normal);
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
    color: var(--color-render-text, var(--text-color));
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
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: subpixel-antialiased;
    -moz-osx-font-smoothing: auto;
  }

  /* 렌더 모드 활성화 시 스타일 */
  .render-mode .editor-textarea {
    background-color: transparent;
    color: transparent;
    caret-color: var(--color-render-text, var(--text-color));
    font-family: var(--font-render-family, var(--font-notepad));
    font-weight: var(--font-render-weight, normal);
  }

  .render-mode .editor-viewport {
    background-color: var(--color-render-bg, var(--bg-editor));
  }

  .settings-window-container {
    display: flex;
    flex-direction: column;
    width: 100vw;
    height: 100vh;
    box-sizing: border-box;
    background-color: var(--bg-editor);
  }

  .settings-body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .settings-body.window-mode {
    width: 100%;
    height: 100%;
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

  .sidebar-tree-group {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .sidebar-group,
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

  .sidebar-group {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-weight: 600;
  }

  .tree-chevron {
    flex-shrink: 0;
    transition: transform 0.1s;
  }

  .tree-chevron.collapsed {
    transform: rotate(-90deg);
  }

  .tree-child {
    padding-left: 2.35rem;
  }

  .sidebar-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .sidebar-group:hover,
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

  .settings-check-row {
    display: flex;
    align-items: flex-start;
    gap: 0.65rem;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .settings-checkbox {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    margin-top: 2px;
    accent-color: var(--accent-color);
  }

  .settings-check-copy {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    line-height: 1.35;
  }

  .settings-check-title {
    color: var(--text-color);
    font-weight: 500;
  }

  .settings-check-description {
    color: var(--text-muted);
    font-size: 0.78rem;
  }

  .color-picker-wrapper {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    position: relative;
  }

  .color-picker-native {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  .inline-color-picker-native {
    width: 1px;
    height: 1px;
    min-width: 0;
    min-height: 0;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: transparent;
    pointer-events: none;
    opacity: 0;
    outline: none;
    appearance: none;
    -webkit-appearance: none;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(100%);
    transform: scale(0);
    transform-origin: top left;
  }

  .inline-color-picker-native::-webkit-color-swatch-wrapper,
  .inline-color-picker-native::-webkit-color-swatch {
    width: 0;
    height: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .color-text-input {
    width: 92px;
    min-height: 28px;
    padding: 0;
    border: 1px solid #9ca3af;
    border-radius: 4px;
    font-family: Consolas, "Courier New", monospace;
    font-size: 0.8rem;
    font-weight: 600;
    line-height: 26px;
    text-align: center;
    outline: none;
    text-transform: uppercase;
    cursor: pointer;
    box-sizing: border-box;
    transition: box-shadow 0.1s, transform 0.1s;
  }

  .color-text-input:hover {
    box-shadow: 0 0 0 1px rgba(156, 163, 175, 0.45);
  }

  .color-text-input:focus {
    border-color: #9ca3af;
    outline: 2px solid var(--accent-color);
    outline-offset: 2px;
  }

  .color-text-input:active {
    transform: translateY(1px);
  }

  .color-text-input::selection {
    background: rgba(255, 255, 255, 0.35);
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


