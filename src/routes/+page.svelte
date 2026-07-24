<script lang="ts">
  import { message, open, save } from "@tauri-apps/plugin-dialog";
  import { invoke } from "@tauri-apps/api/core";
  import { PhysicalPosition } from "@tauri-apps/api/dpi";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { listen, type Event as TauriEvent, type UnlistenFn } from "@tauri-apps/api/event";
  import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
  import { Braces, ChevronDown, Code2, Copy, FileCode2, FileText, Minus, PaintRoller, PenLine, Settings, Square, Sun, Moon, Plus, Table2, X } from "@lucide/svelte";
  import {
    configurableDocumentFormatCategories,
    configurableDocumentFormats,
    createDefaultDocumentFeatureSettings,
    getDocumentDiagnostic,
    getDocumentFormatForContent,
    getSuggestedFileExtensionForContent,
    isDocumentFormatEditEnabled,
    isDocumentFormatRenderEnabled,
    normalizeDocumentFeatureSettings,
    openFileDialogFilters,
    parseDocumentForRender,
    saveFileDialogFilters
  } from "$lib/document-formats";
  import type { DocumentDiagnostic, DocumentFeatureSettings, DocumentFormatCategory, DocumentFormatCategoryId, DocumentFormatId } from "$lib/document-formats";
  import type { Token } from "$lib/render-tokenizer";
  import { EditorUndoHistory, type EditorSelection, type EditorSnapshot } from "$lib/editor-undo";
  import { untrack } from "svelte";
  import DelimitedTableEditor from "$lib/DelimitedTableEditor.svelte";
  import {
    parseDelimitedTable,
    serializeDelimitedTable,
    type DelimitedTableDocument,
    type DelimitedTableSeparator
  } from "$lib/delimited-table";

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
    const lfIndex = content.indexOf('\n');
    const firstLineEnd = lfIndex === -1
      ? content.length
      : (lfIndex > 0 && content[lfIndex - 1] === '\r' ? lfIndex - 1 : lfIndex);
    const firstLine = content.slice(0, firstLineEnd).trim();
    return firstLine || untitledFileName;
  }

  function getDisplayFileName(tab: Pick<EditorTab, 'filePath' | 'fileName' | 'fileContent'>): string {
    return tab.filePath ? tab.fileName : getFirstLineTitle(tab.fileContent);
  }

  function getUnsavedFileNameFromContent(content: string): string {
    const suggestedExtension = getSuggestedFileExtensionForContent(content);
    const firstLineTitle = getFirstLineTitle(content);
    const suggestedTitle = suggestedExtension === "json" && /^[{\[]\s*$/.test(firstLineTitle)
      ? untitledFileName
      : firstLineTitle;
    const fileNameBase = suggestedTitle
      .replace(invalidFileNameCharsPattern, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "") || untitledFileName;

    return /\.[^./\\]+$/.test(fileNameBase) ? fileNameBase : `${fileNameBase}.${suggestedExtension}`;
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

  function getTabSnapshot(tab: EditorTab): EditorSnapshot {
    return {
      content: tab.fileContent,
      selection: {
        start: Math.min(tab.selectionStart, tab.fileContent.length),
        end: Math.min(tab.selectionEnd, tab.fileContent.length)
      }
    };
  }

  const initialTab = createEditorTab();
  const undoHistories = new Map<string, EditorUndoHistory>([
    [initialTab.id, new EditorUndoHistory(getTabSnapshot(initialTab))]
  ]);
  let lastEditorSnapshot: EditorSnapshot = getTabSnapshot(initialTab);
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
  let hasLoadedStartupFiles = false;
  let isWindowMaximized = $state<boolean>(false);

  // 커서 상태 추적
  let cursorLine = $state<number>(1);
  let cursorCol = $state<number>(1);
  let caretOffset = $state<number>(0);
  let editorCaretColor = $state<string>('var(--color-render-text, var(--text-color))');
  let editorCursorStyle = $state<string>('text');
  let hasEditorSelection = $state<boolean>(false);
  let steadyEditorCaretVisible = $state<boolean>(false);
  let steadyEditorCaretCollapsed = $state<boolean>(true);
  let steadyEditorCaretLeft = $state<number>(12);
  let steadyEditorCaretTop = $state<number>(8);
  let steadyEditorCaretTimer: ReturnType<typeof setTimeout> | null = null;
  let steadyEditorCaretBlinkKey = $state<number>(0);
  let isEditorFocused = $state<boolean>(false);
  let editorTextMeasureCanvas: HTMLCanvasElement | null = null;
  let editorTextMeasureContext: CanvasRenderingContext2D | null = null;
  let editorTextMeasureFont = '';
  let editorTextWidthCache = new Map<string, number>();

  // 메뉴 및 설정 상태 추적
  let openDropdown = $state<'file' | 'edit' | null>(null);
  type FormatSettingsView = `format:${DocumentFormatId}`;
  type FormatCategorySettingsView = `category:${DocumentFormatCategoryId}`;
  type SettingsView = 'sourceAppearance' | 'renderAppearance' | 'renderEditing' | FormatCategorySettingsView | FormatSettingsView;
  let activeSettingsView = $state<SettingsView>('renderAppearance');
  let isSourceSettingsExpanded = $state<boolean>(true);
  let isRenderSettingsExpanded = $state<boolean>(true);
  let expandedFormatCategories = $state<Record<DocumentFormatCategoryId, boolean>>({
    document: true,
    structured: true,
    table: true,
    code: true
  });
  let hasCenteredSettingsWindowThisSession = false;

  // 폰트 크기 이원화
  let sourceFontSize = $state<number>(11);
  let renderFontSize = $state<number>(11);

  // 렌더 모드 상태
  let isRenderMode = $state<boolean>(true); // 기본값은 렌더 모드
  let renderAutoPairEditing = $state<boolean>(true);
  let renderAutoSymbolSubstitution = $state<boolean>(true);
  let renderPreserveIndentOnEnter = $state<boolean>(true);
  let delimitedTableHighlightHeader = $state<boolean>(true);
  let delimitedTableShowRowIndices = $state<boolean>(true);
  let delimitedTableAnimateReorder = $state<boolean>(true);
  let delimitedTableReorderDurationMs = $state<number>(150);
  let documentFeatureSettings = $state<DocumentFeatureSettings>(createDefaultDocumentFeatureSettings());
  let activeSettingsCategory = $derived(
    configurableDocumentFormatCategories.find(
      (category) => activeSettingsView === getDocumentFormatCategorySettingsView(category.id)
    ) ?? null
  );
  let activeSettingsFormat = $derived(
    configurableDocumentFormats.find((format) => activeSettingsView === getDocumentFormatSettingsView(format.id)) ?? null
  );
  let currentFontSize = $derived(isRenderMode ? renderFontSize : sourceFontSize);
  let tabSize = $state<number>(4);          // 기본 들여쓰기 탭 4칸
  let scrollTop = $state<number>(0);
  let scrollLeft = $state<number>(0);
  let measuredLineHeight = $state<number>(22);
  let clientHeight = $state<number>(500);
  let editorViewportResizeTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingEditorViewportWidth = 500;
  let isRenderWrapSettling = $state<boolean>(false);
  let renderWrapSettleGeneration = 0;
  let pendingNativeInput: { before: EditorSnapshot; inputType: string; isComposing: boolean } | null = null;
  let isComposingEditorText = false;

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
    keyStrong: string;
    keyMedium: string;
    keyLight: string;
    string: string;
    number: string;
    listMarker: string;
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
      keyStrong: '#0284c7',
      keyMedium: '#38bdf8',
      keyLight: '#7dd3fc',
      string: '#F3AF82',
      number: '#dffe8b',
      listMarker: '#A5B4FC',
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
      keyStrong: '#0369a1',
      keyMedium: '#0284c7',
      keyLight: '#38bdf8',
      string: '#b91c1c',
      number: '#d97706',
      listMarker: '#4F46E5',
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

  const notepadFontFamilyCSS = '"Consolas", "Courier New", "Malgun Gothic", monospace';
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
    renderFontFamily === 'notepad' ? notepadFontFamilyCSS :
    "'Nanum Gothic', 'NanumGothic', 'Malgun Gothic', sans-serif"
  );

  let canPersistPreferences = $state<boolean>(false);
  const documentFeaturePreferenceKey = 'pref_document_format_features';
  const textSaveFilters = saveFileDialogFilters;
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
  const editorHorizontalPadding = 24;
  const editorTopPadding = 8;
  const virtualLineOverscan = 8;
  const editorResizeDebounceMs = 80;
  const editorTextWidthCacheLimit = 12000;
  const delimitedTableReorderDurationMinMs = 50;
  const delimitedTableReorderDurationMaxMs = 2000;
  const delimitedTableReorderDurationStepMs = 50;
  const editorMovementKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

  function parseDocumentFeatureSettingsValue(value: string | null): DocumentFeatureSettings {
    if (!value) return createDefaultDocumentFeatureSettings();

    try {
      return normalizeDocumentFeatureSettings(JSON.parse(value));
    } catch {
      return createDefaultDocumentFeatureSettings();
    }
  }

  function getDocumentFormatSettingsView(formatId: DocumentFormatId): FormatSettingsView {
    return `format:${formatId}`;
  }

  function getDocumentFormatCategorySettingsView(
    categoryId: DocumentFormatCategoryId
  ): FormatCategorySettingsView {
    return `category:${categoryId}`;
  }

  function getDocumentFormatsForCategory(category: DocumentFormatCategory) {
    return configurableDocumentFormats.filter((format) => category.formatIds.includes(format.id));
  }

  function selectDocumentFormatCategory(categoryId: DocumentFormatCategoryId) {
    const categoryView = getDocumentFormatCategorySettingsView(categoryId);
    const wasActive = activeSettingsView === categoryView;
    activeSettingsView = categoryView;
    expandedFormatCategories = {
      ...expandedFormatCategories,
      [categoryId]: wasActive ? !expandedFormatCategories[categoryId] : true
    };
  }

  function setDocumentFormatFeature(
    formatId: DocumentFormatId,
    feature: keyof DocumentFeatureSettings[DocumentFormatId],
    enabled: boolean
  ) {
    documentFeatureSettings = {
      ...documentFeatureSettings,
      [formatId]: {
        ...documentFeatureSettings[formatId],
        [feature]: enabled
      }
    };
  }

  interface EditorLineLayout {
    tops: number[];
    heights: number[];
    totalHeight: number;
  }

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

  function getUndoHistoryForTab(tab: EditorTab): EditorUndoHistory {
    let history = undoHistories.get(tab.id);
    if (!history) {
      history = new EditorUndoHistory(getTabSnapshot(tab));
      undoHistories.set(tab.id, history);
    }
    return history;
  }

  function getActiveUndoHistory(): EditorUndoHistory {
    const activeTab = getActiveTab();
    if (activeTab) return getUndoHistoryForTab(activeTab);

    let history = undoHistories.get(activeTabId);
    if (!history) {
      history = new EditorUndoHistory(getCurrentEditorSnapshot());
      undoHistories.set(activeTabId, history);
    }
    return history;
  }

  function resetUndoHistoryForTab(tab: EditorTab) {
    const history = new EditorUndoHistory(getTabSnapshot(tab));
    undoHistories.set(tab.id, history);
  }

  function markTabHistorySaved(tabId: string) {
    const tab = tabs.find((item) => item.id === tabId);
    const history = tab ? getUndoHistoryForTab(tab) : undoHistories.get(tabId);
    history?.markSaved();
  }

  function normalizeDelimitedTableReorderDuration(value: string | number | null): number {
    if (value === null || value === '') return 150;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return 150;
    const stepped = Math.round(parsed / delimitedTableReorderDurationStepMs)
      * delimitedTableReorderDurationStepMs;
    return Math.max(
      delimitedTableReorderDurationMinMs,
      Math.min(stepped, delimitedTableReorderDurationMaxMs)
    );
  }

  function formatDelimitedTableReorderDuration(durationMs: number): string {
    return `${(durationMs / 1000).toFixed(durationMs % 1000 === 0 ? 0 : 2)}초`;
  }

  function getTextareaValueFromContent(content: string): string {
    return content.replace(/\r\n/g, '\n');
  }

  function contentOffsetToTextareaOffset(content: string, offset: number): number {
    const targetOffset = clamp(offset, 0, content.length);
    let textareaOffset = 0;

    for (let contentOffset = 0; contentOffset < targetOffset; contentOffset += 1) {
      if (content[contentOffset] === '\r' && content[contentOffset + 1] === '\n') continue;
      textareaOffset += 1;
    }

    return textareaOffset;
  }

  function textareaOffsetToContentOffset(content: string, offset: number): number {
    const targetOffset = Math.max(0, offset);
    let textareaOffset = 0;

    for (let contentOffset = 0; contentOffset < content.length; contentOffset += 1) {
      if (textareaOffset >= targetOffset) return contentOffset;
      if (content[contentOffset] === '\r' && content[contentOffset + 1] === '\n') continue;
      textareaOffset += 1;
    }

    return content.length;
  }

  function getTextareaSelectionInContent(content = fileContent): EditorSelection {
    if (!textareaEl) return { start: caretOffset, end: caretOffset };

    return {
      start: textareaOffsetToContentOffset(content, textareaEl.selectionStart),
      end: textareaOffsetToContentOffset(content, textareaEl.selectionEnd)
    };
  }

  function setTextareaSelectionFromContent(start: number, end: number, content = fileContent) {
    if (!textareaEl) return;

    textareaEl.selectionStart = contentOffsetToTextareaOffset(content, start);
    textareaEl.selectionEnd = contentOffsetToTextareaOffset(content, end);
  }

  function getSnapshotFromTextareaInput(
    before: EditorSnapshot,
    textareaValue: string,
    textareaSelectionStart: number,
    textareaSelectionEnd: number
  ): EditorSnapshot {
    const beforeTextareaValue = getTextareaValueFromContent(before.content);
    let prefixLength = 0;
    const prefixLimit = Math.min(beforeTextareaValue.length, textareaValue.length);

    while (
      prefixLength < prefixLimit
      && beforeTextareaValue[prefixLength] === textareaValue[prefixLength]
    ) {
      prefixLength += 1;
    }

    let suffixLength = 0;
    while (
      suffixLength < beforeTextareaValue.length - prefixLength
      && suffixLength < textareaValue.length - prefixLength
      && beforeTextareaValue[beforeTextareaValue.length - suffixLength - 1]
        === textareaValue[textareaValue.length - suffixLength - 1]
    ) {
      suffixLength += 1;
    }

    const beforeTextareaEnd = beforeTextareaValue.length - suffixLength;
    const afterTextareaEnd = textareaValue.length - suffixLength;
    const contentStart = textareaOffsetToContentOffset(before.content, prefixLength);
    const contentEnd = textareaOffsetToContentOffset(before.content, beforeTextareaEnd);
    const newline = getPreferredNewline(before.content, contentStart);
    const replacement = textareaValue.slice(prefixLength, afterTextareaEnd).replace(/\n/g, newline);
    const content = `${before.content.slice(0, contentStart)}${replacement}${before.content.slice(contentEnd)}`;

    return {
      content,
      selection: {
        start: textareaOffsetToContentOffset(content, textareaSelectionStart),
        end: textareaOffsetToContentOffset(content, textareaSelectionEnd)
      }
    };
  }

  function getCurrentEditorSelection(): EditorSelection {
    return getTextareaSelectionInContent();
  }

  function getCurrentEditorSnapshot(): EditorSnapshot {
    return {
      content: fileContent,
      selection: getCurrentEditorSelection()
    };
  }

  function setLastEditorSnapshot(snapshot: EditorSnapshot) {
    lastEditorSnapshot = {
      content: snapshot.content,
      selection: { ...snapshot.selection }
    };
  }

  function closeActiveUndoGroup() {
    getActiveUndoHistory().closeGroup();
  }

  function syncActiveTabState() {
    if (pendingInlineColorEditBefore) {
      finishInlineColorPickerEdit();
    }

    const activeTab = getActiveTab();
    if (!activeTab) return;

    const nextFileName = filePath ? fileName : getFirstLineTitle(fileContent);
    const nextIsDirty = getUndoHistoryForTab(activeTab).isDirty();
    fileName = nextFileName;
    isDirty = nextIsDirty;
    const selection = getCurrentEditorSelection();

    updateTabById(activeTab.id, {
      filePath,
      fileName: nextFileName,
      fileContent,
      isDirty: nextIsDirty,
      scrollTop,
      scrollLeft,
      selectionStart: selection.start,
      selectionEnd: selection.end,
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
      setTextareaSelectionFromContent(selectionStart, selectionEnd);
      textareaEl.scrollTop = tab.scrollTop;
      textareaEl.scrollLeft = tab.scrollLeft;
      updateCursorPosition();
    });
  }

  function loadTabIntoEditor(tab: EditorTab) {
    const history = getUndoHistoryForTab(tab);
    setLastEditorSnapshot(getTabSnapshot(tab));
    activeTabId = tab.id;
    filePath = tab.filePath;
    fileName = getDisplayFileName(tab);
    fileContent = tab.fileContent;
    isDirty = history.isDirty();
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
    resetUndoHistoryForTab(tab);
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
    resetUndoHistoryForTab(nextTab);
    tabs = tabs.map((item) => item.id === activeId ? nextTab : item);
    loadTabIntoEditor(nextTab);
  }

  function closeTabWithoutPrompt(tabId: string) {
    const closingIndex = tabs.findIndex((tab) => tab.id === tabId);
    if (closingIndex === -1) return;

    if (tabs.length === 1) {
      undoHistories.delete(tabId);
      const blankTab = createEditorTab();
      resetUndoHistoryForTab(blankTab);
      tabs = [blankTab];
      loadTabIntoEditor(blankTab);
      return;
    }

    const nextTabs = tabs.filter((tab) => tab.id !== tabId);
    undoHistories.delete(tabId);
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
    renderPreserveIndentOnEnter = localStorage.getItem('pref_render_preserve_indent_on_enter') !== 'false';
    delimitedTableHighlightHeader = localStorage.getItem('pref_delimited_table_highlight_header') !== 'false';
    delimitedTableShowRowIndices = localStorage.getItem('pref_delimited_table_show_row_indices') !== 'false';
    delimitedTableAnimateReorder = localStorage.getItem('pref_delimited_table_animate_reorder') !== 'false';
    delimitedTableReorderDurationMs = normalizeDelimitedTableReorderDuration(
      localStorage.getItem('pref_delimited_table_reorder_duration_ms')
    );
    documentFeatureSettings = parseDocumentFeatureSettingsValue(localStorage.getItem(documentFeaturePreferenceKey));

    renderFontFamily = localStorage.getItem('pref_render_font_family') || 'nanum-gothic';

    const loadColors = (isDark: boolean): ThemeColors => {
      const prefix = isDark ? 'pref_dark_' : 'pref_light_';
      const defaults = getSystemDefaultColors(isDark);

      // Migration from old keys (if new key doesn't exist but old key does, use old key once, or just fallback to default)
      return {
        codeBg: localStorage.getItem(`${prefix}codeBg`) || (isDark && systemIsDark ? localStorage.getItem('pref_color_hl_code_bg') : null) || defaults.codeBg,
        codeText: localStorage.getItem(`${prefix}codeText`) || (isDark && systemIsDark ? localStorage.getItem('pref_color_hl_code_text') : null) || defaults.codeText,
        keyStrong: localStorage.getItem(`${prefix}keyStrong`) || defaults.keyStrong,
        keyMedium: localStorage.getItem(`${prefix}keyMedium`) || defaults.keyMedium,
        keyLight: localStorage.getItem(`${prefix}keyLight`) || defaults.keyLight,
        string: localStorage.getItem(`${prefix}string`) || (isDark && systemIsDark ? localStorage.getItem('pref_color_hl_string') : null) || defaults.string,
        number: localStorage.getItem(`${prefix}number`) || (isDark && systemIsDark ? localStorage.getItem('pref_color_hl_number') : null) || defaults.number,
        listMarker: localStorage.getItem(`${prefix}listMarker`) || defaults.listMarker,
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
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem('pref_render_preserve_indent_on_enter', renderPreserveIndentOnEnter ? 'true' : 'false'); });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem('pref_delimited_table_highlight_header', delimitedTableHighlightHeader ? 'true' : 'false'); });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem('pref_delimited_table_show_row_indices', delimitedTableShowRowIndices ? 'true' : 'false'); });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem('pref_delimited_table_animate_reorder', delimitedTableAnimateReorder ? 'true' : 'false'); });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem('pref_delimited_table_reorder_duration_ms', delimitedTableReorderDurationMs.toString()); });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem(documentFeaturePreferenceKey, JSON.stringify(documentFeatureSettings)); });
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
    markTabHistorySaved(tabId);
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
    if (e.key === 'pref_render_preserve_indent_on_enter' && e.newValue) renderPreserveIndentOnEnter = e.newValue !== 'false';
    if (e.key === 'pref_delimited_table_highlight_header' && e.newValue) delimitedTableHighlightHeader = e.newValue !== 'false';
    if (e.key === 'pref_delimited_table_show_row_indices' && e.newValue) delimitedTableShowRowIndices = e.newValue !== 'false';
    if (e.key === 'pref_delimited_table_animate_reorder' && e.newValue) delimitedTableAnimateReorder = e.newValue !== 'false';
    if (e.key === 'pref_delimited_table_reorder_duration_ms' && e.newValue) {
      delimitedTableReorderDurationMs = normalizeDelimitedTableReorderDuration(e.newValue);
    }
    if (e.key === documentFeaturePreferenceKey) documentFeatureSettings = parseDocumentFeatureSettingsValue(e.newValue);
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
  function getLineStartOffsets(content: string): number[] {
    const lineStartOffsets = [0];
    const newlineRegex = /\r?\n/g;
    let match: RegExpExecArray | null;

    while ((match = newlineRegex.exec(content)) !== null) {
      lineStartOffsets.push(match.index + match[0].length);
    }

    return lineStartOffsets;
  }

  function getLineTextForLayout(content: string, offsets: number[], lineIndex: number): string {
    const lineStart = offsets[lineIndex] ?? 0;
    const nextLineStart = offsets[lineIndex + 1];
    let lineEnd = nextLineStart ?? content.length;

    if (nextLineStart !== undefined && content[lineEnd - 1] === '\n') {
      lineEnd -= 1;
      if (lineEnd > lineStart && content[lineEnd - 1] === '\r') {
        lineEnd -= 1;
      }
    }

    return content.slice(lineStart, lineEnd);
  }

  function measureEditorTextEndWidth(text: string, startWidth = 0): number {
    if (!isBrowser || text.length === 0) return startWidth;

    if (!text.includes('\t')) {
      return startWidth + measureEditorPlainTextWidth(text);
    }

    const context = getEditorTextMeasureContext();
    if (!context) return startWidth;

    const tabWidth = context.measureText(' '.repeat(tabSize)).width || 1;
    let width = startWidth;
    let segmentStart = 0;

    for (let i = 0; i < text.length; i += 1) {
      if (text[i] !== '\t') continue;

      if (segmentStart < i) {
        width += measureEditorPlainTextWidth(text.slice(segmentStart, i));
      }

      const tabRemainder = width % tabWidth;
      width += tabRemainder === 0 ? tabWidth : tabWidth - tabRemainder;
      segmentStart = i + 1;
    }

    if (segmentStart < text.length) {
      width += measureEditorPlainTextWidth(text.slice(segmentStart));
    }

    return width;
  }

  function countWrappedVisualLines(lineText: string, contentWidth: number): number {
    if (!isBrowser || contentWidth <= 0 || lineText.length === 0) return 1;

    const segments = lineText.match(/\S+\s*|\s+/g) || [lineText];
    let visualLineCount = 1;
    let currentWidth = 0;

    const appendPiece = (piece: string) => {
      const nextWidth = measureEditorTextEndWidth(piece, currentWidth);
      if (currentWidth > 0 && nextWidth > contentWidth) {
        visualLineCount += 1;
        currentWidth = measureEditorTextEndWidth(piece, 0);
      } else {
        currentWidth = nextWidth;
      }
    };

    for (const segment of segments) {
      const segmentWidth = measureEditorTextEndWidth(segment, 0);
      if (segmentWidth <= contentWidth) {
        appendPiece(segment);
        continue;
      }

      for (const char of Array.from(segment)) {
        appendPiece(char);
        if (currentWidth > contentWidth) {
          visualLineCount += 1;
          currentWidth = 0;
        }
      }
    }

    return visualLineCount;
  }

  interface WrappedLineSegment {
    start: number;
    end: number;
  }

  function appendWrappedLineSegment(
    segments: WrappedLineSegment[],
    start: number,
    end: number
  ) {
    if (end <= start && segments.length > 0) return;
    segments.push({ start, end });
  }

  function getWrappedLineSegments(lineText: string, contentWidth: number): WrappedLineSegment[] {
    if (!isBrowser || contentWidth <= 0 || lineText.length === 0) {
      return [{ start: 0, end: lineText.length }];
    }

    const segments: WrappedLineSegment[] = [];
    const pieces = lineText.match(/\S+\s*|\s+/g) || [lineText];
    let pieceStart = 0;
    let currentStart = 0;
    let currentEnd = 0;
    let currentWidth = 0;

    const commitCurrentSegment = () => {
      appendWrappedLineSegment(segments, currentStart, currentEnd);
      currentStart = currentEnd;
      currentWidth = 0;
    };

    const appendRange = (start: number, end: number) => {
      if (end <= start) return;

      const piece = lineText.slice(start, end);
      const nextWidth = measureEditorTextEndWidth(piece, currentWidth);
      if (currentEnd > currentStart && nextWidth > contentWidth) {
        commitCurrentSegment();
        currentStart = start;
        currentEnd = start;
        currentWidth = 0;
      }

      currentEnd = end;
      currentWidth = measureEditorTextEndWidth(lineText.slice(currentStart, currentEnd), 0);
    };

    for (const piece of pieces) {
      const pieceEnd = pieceStart + piece.length;
      const pieceWidth = measureEditorTextEndWidth(piece, 0);

      if (pieceWidth <= contentWidth) {
        appendRange(pieceStart, pieceEnd);
      } else {
        for (let charStart = pieceStart; charStart < pieceEnd;) {
          const codePoint = lineText.codePointAt(charStart);
          const charEnd = charStart + (codePoint && codePoint > 0xffff ? 2 : 1);
          appendRange(charStart, Math.min(charEnd, pieceEnd));
          charStart = charEnd;
        }
      }

      pieceStart = pieceEnd;
    }

    appendWrappedLineSegment(segments, currentStart, currentEnd);
    return segments.length > 0 ? segments : [{ start: 0, end: lineText.length }];
  }

  function getEditorLineLayout(content: string, offsets: number[], contentWidth: number): EditorLineLayout {
    const lineTotal = offsets.length;
    const tops: number[] = new Array(lineTotal);
    const heights: number[] = new Array(lineTotal);
    let top = 0;

    for (let lineIndex = 0; lineIndex < lineTotal; lineIndex += 1) {
      const lineText = getLineTextForLayout(content, offsets, lineIndex);
      const visualLineCount = isRenderMode
        ? countWrappedVisualLines(lineText, contentWidth)
        : 1;
      const height = Math.max(measuredLineHeight, visualLineCount * measuredLineHeight);

      tops[lineIndex] = top;
      heights[lineIndex] = height;
      top += height;
    }

    return { tops, heights, totalHeight: top };
  }

  function findLineIndexForLayoutOffset(layout: EditorLineLayout, offset: number): number {
    if (layout.tops.length === 0) return 0;

    const safeOffset = Math.max(0, offset);
    let low = 0;
    let high = layout.tops.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const top = layout.tops[mid] ?? 0;
      const bottom = top + (layout.heights[mid] ?? measuredLineHeight);

      if (safeOffset >= top && safeOffset < bottom) return mid;
      if (safeOffset < top) high = mid - 1;
      else low = mid + 1;
    }

    return Math.max(0, Math.min(low, layout.tops.length - 1));
  }

  function getRenderLineTop(lineIndex: number): number {
    return renderLineLayout.tops[lineIndex] ?? lineIndex * measuredLineHeight;
  }

  function getRenderLineHeight(lineIndex: number): number {
    return renderLineLayout.heights[lineIndex] ?? measuredLineHeight;
  }

  // 반응형 상태
  let lineStartOffsets = $derived(getLineStartOffsets(fileContent));
  let lineCount = $derived(lineStartOffsets.length);
  let charCount = $derived(fileContent.length);
  let textareaDisplayContent = $derived(getTextareaValueFromContent(fileContent));
  let editorViewportWidth = $state<number>(500);
  function getEditorTextBoxWidth(): number {
    const fallbackWidth = Math.max(1, editorViewportWidth);
    if (!isBrowser || !textareaEl) return fallbackWidth;
    return Math.max(1, textareaEl.clientWidth || fallbackWidth);
  }

  function getEditorTextPaddingLeft(): number {
    if (!isBrowser || !textareaEl) return editorHorizontalPadding / 2;

    const textareaStyle = getComputedStyle(textareaEl);
    return Number.parseFloat(textareaStyle.paddingLeft) || (editorHorizontalPadding / 2);
  }

  function getEditorWrapContentWidth(): number {
    const fallbackWidth = Math.max(1, editorViewportWidth - editorHorizontalPadding);
    if (!isBrowser || !textareaEl) return fallbackWidth;

    const textareaStyle = getComputedStyle(textareaEl);
    const paddingLeft = Number.parseFloat(textareaStyle.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(textareaStyle.paddingRight) || 0;
    return Math.max(1, getEditorTextBoxWidth() - paddingLeft - paddingRight);
  }

  let renderWrapContentWidth = $derived(getEditorWrapContentWidth());
  let renderLineLayout = $derived(getEditorLineLayout(fileContent, lineStartOffsets, renderWrapContentWidth));
  let shouldShowNativeRenderText = $derived(isRenderMode && isRenderWrapSettling);
  let shouldRenderHighlightLayer = $derived(isRenderMode && !shouldShowNativeRenderText);

  // 가상화 범위 계산
  let startLine = $derived(Math.max(
    0,
    findLineIndexForLayoutOffset(renderLineLayout, scrollTop - editorTopPadding) - virtualLineOverscan
  ));
  let endLine = $derived(Math.min(
    lineCount - 1,
    findLineIndexForLayoutOffset(renderLineLayout, scrollTop + clientHeight - editorTopPadding) + virtualLineOverscan
  ));

  // 렌더 모드 텍스트 및 가상화 파싱 라인 생성
  let activeDocumentFormat = $derived(getDocumentFormatForContent(fileContent, filePath || fileName));
  let isActiveDocumentRenderEnabled = $derived(isDocumentFormatRenderEnabled(activeDocumentFormat, documentFeatureSettings));
  let isActiveDocumentEditEnabled = $derived(isDocumentFormatEditEnabled(activeDocumentFormat, documentFeatureSettings));
  let activeDelimitedTableSeparator = $derived<DelimitedTableSeparator | null>(
    activeDocumentFormat.id === 'csv' ? ',' : activeDocumentFormat.id === 'tsv' ? '\t' : null
  );
  let activeDelimitedTableDocument = $derived(
    activeDelimitedTableSeparator ? parseDelimitedTable(fileContent, activeDelimitedTableSeparator) : null
  );
  let shouldShowDelimitedTableEditor = $derived(
    isRenderMode && isActiveDocumentRenderEnabled && activeDelimitedTableDocument !== null
  );
  let shouldShowDocumentSyntaxStatus = $derived(activeDocumentFormat.validatesSyntax && isActiveDocumentRenderEnabled);
  let documentDiagnostic = $state<DocumentDiagnostic | null>(null);
  let documentRender = $derived(parseDocumentForRender(fileContent, {
    pathOrName: filePath || fileName,
    tabSize,
    lineStartOffsets,
    lineRange: { startLine, endLine },
    featureSettings: documentFeatureSettings
  }));
  let parsedLines = $derived(documentRender.lines);

  const syntaxDiagnosticDelayMs = 500;

  $effect(() => {
    const content = fileContent;
    const pathOrName = filePath || fileName;
    const format = activeDocumentFormat;
    const featureSettings = documentFeatureSettings;

    if (!format.validatesSyntax || !isDocumentFormatRenderEnabled(format, featureSettings)) {
      documentDiagnostic = null;
      return;
    }

    const timer = setTimeout(() => {
      documentDiagnostic = getDocumentDiagnostic(content, { pathOrName, featureSettings });
    }, syntaxDiagnosticDelayMs);

    return () => clearTimeout(timer);
  });

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

  function getEditorTextMeasureContext(): CanvasRenderingContext2D | null {
    if (!isBrowser) return null;

    if (!editorTextMeasureCanvas) {
      editorTextMeasureCanvas = document.createElement('canvas');
      editorTextMeasureContext = editorTextMeasureCanvas.getContext('2d');
    }

    if (!editorTextMeasureContext) return null;

    const fontFamily = isRenderMode ? currentRenderFontFamilyCSS : notepadFontFamilyCSS;
    const fontWeight = isRenderMode ? activeColors.renderFontWeight : '400';
    const font = `${fontWeight} ${currentFontSize}pt ${fontFamily}`;
    if (font !== editorTextMeasureFont) {
      editorTextMeasureFont = font;
      editorTextMeasureContext.font = font;
      editorTextWidthCache.clear();
    }

    return editorTextMeasureContext;
  }

  function measureEditorPlainTextWidth(text: string): number {
    if (!isBrowser || text.length === 0) return 0;

    const context = getEditorTextMeasureContext();
    if (!context) return 0;

    const cachedWidth = editorTextWidthCache.get(text);
    if (cachedWidth !== undefined) return cachedWidth;

    const width = context.measureText(text).width;
    if (editorTextWidthCache.size > editorTextWidthCacheLimit) {
      editorTextWidthCache.clear();
    }
    editorTextWidthCache.set(text, width);
    return width;
  }

  function measureEditorTextWidth(text: string): number {
    return measureEditorTextEndWidth(text, 0);
  }

  function syncSteadyEditorCaretPosition() {
    if (!textareaEl) return;

    const textareaStart = textareaEl.selectionStart;
    const textareaEnd = textareaEl.selectionEnd;
    const { start } = getTextareaSelectionInContent();
    steadyEditorCaretCollapsed = textareaStart === textareaEnd;
    if (!steadyEditorCaretCollapsed) {
      if (isRenderMode) {
        steadyEditorCaretVisible = false;
      }
      return;
    }

    if (isRenderMode) {
      const editorHasFocus = isEditorFocused || document.activeElement === textareaEl;
      steadyEditorCaretVisible = editorHasFocus && isActiveDocumentRenderEnabled && shouldRenderHighlightLayer;
      if (!steadyEditorCaretVisible) return;

      const caretRect = getRenderedCaretRectForOffset(start);
      if (!caretRect || !editorViewportEl) {
        steadyEditorCaretVisible = false;
        return;
      }

      const viewportRect = editorViewportEl.getBoundingClientRect();
      steadyEditorCaretLeft = caretRect.left - viewportRect.left;
      steadyEditorCaretTop = caretRect.top - viewportRect.top;
      return;
    }

    const lineIndex = Math.max(0, cursorLine - 1);
    const lineStart = lineStartOffsets[lineIndex] ?? 0;
    const linePrefix = fileContent.slice(lineStart, start);
    steadyEditorCaretLeft = 12 + measureEditorTextWidth(linePrefix) - scrollLeft;
    steadyEditorCaretTop = 8 + lineIndex * measuredLineHeight - scrollTop;
  }

  function restartSteadyEditorCaretBlink() {
    steadyEditorCaretBlinkKey += 1;
  }

  function hideSteadyEditorCaret() {
    steadyEditorCaretVisible = false;
    if (steadyEditorCaretTimer) {
      clearTimeout(steadyEditorCaretTimer);
      steadyEditorCaretTimer = null;
    }
  }

  function keepEditorCaretVisibleDuringEdit() {
    if (isRenderMode) {
      syncSteadyEditorCaretPosition();
      return;
    }

    if (!isBrowser || !textareaEl) {
      hideSteadyEditorCaret();
      return;
    }

    steadyEditorCaretVisible = true;
    syncSteadyEditorCaretPosition();
    if (steadyEditorCaretTimer) {
      clearTimeout(steadyEditorCaretTimer);
    }
    steadyEditorCaretTimer = setTimeout(() => {
      steadyEditorCaretVisible = false;
      steadyEditorCaretTimer = null;
    }, 700);
  }

  function syncEditorCaretVisibilityForCurrentMode() {
    if (isRenderMode) {
      keepEditorCaretVisibleDuringEdit();
    } else {
      hideSteadyEditorCaret();
    }
  }

  // 폰트 변경 반응성
  $effect(() => {
    const _size = currentFontSize;
    const _mode = isRenderMode;
    const _family = renderFontFamily;
    measureLineHeight();
  });

  function beginRenderWrapSettling() {
    if (!isRenderMode) return;
    renderWrapSettleGeneration += 1;
    isRenderWrapSettling = true;
  }

  function finishRenderWrapSettlingAfterPaint() {
    if (!isBrowser) {
      isRenderWrapSettling = false;
      return;
    }

    const generation = renderWrapSettleGeneration + 1;
    renderWrapSettleGeneration = generation;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (renderWrapSettleGeneration === generation) {
          isRenderWrapSettling = false;
        }
      });
    });
  }

  // 뷰포트 크기 변경 관찰
  $effect(() => {
    if (!editorViewportEl) return;

    pendingEditorViewportWidth = editorViewportEl.clientWidth || editorViewportWidth;
    editorViewportWidth = pendingEditorViewportWidth;
    clientHeight = editorViewportEl.clientHeight || clientHeight;
    let hasObservedViewportResize = false;

    const flushEditorViewportWidth = () => {
      editorViewportWidth = pendingEditorViewportWidth;
      editorViewportResizeTimer = null;
      finishRenderWrapSettlingAfterPaint();
    };

    const observer = new ResizeObserver((entries) => {
      let widthChanged = false;

      for (let entry of entries) {
        const nextWidth = entry.contentRect.width;
        clientHeight = entry.contentRect.height;
        widthChanged = widthChanged || Math.abs(nextWidth - pendingEditorViewportWidth) > 0.5;
        pendingEditorViewportWidth = nextWidth;
      }

      if (hasObservedViewportResize && widthChanged) {
        beginRenderWrapSettling();
      }

      if (editorViewportResizeTimer) {
        clearTimeout(editorViewportResizeTimer);
      }

      editorViewportResizeTimer = setTimeout(flushEditorViewportWidth, editorResizeDebounceMs);
      hasObservedViewportResize = true;
    });
    observer.observe(editorViewportEl);
    return () => {
      observer.disconnect();
      renderWrapSettleGeneration += 1;
      isRenderWrapSettling = false;
      if (editorViewportResizeTimer) {
        clearTimeout(editorViewportResizeTimer);
        editorViewportResizeTimer = null;
      }
    };
  });

  async function openFilePath(selected: string) {
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

  async function loadStartupFiles() {
    if (hasLoadedStartupFiles || !hasTauriRuntime() || isSettingsWindow) return;
    hasLoadedStartupFiles = true;

    try {
      const startupPaths = await invoke<string[]>("get_startup_file_paths");
      if (!startupPaths.length) return;

      isLoading = true;
      errorMsg = null;
      syncActiveTabState();
      for (const startupPath of startupPaths) {
        await openFilePath(startupPath);
      }
    } catch (err: any) {
      errorMsg = typeof err === "string" ? err : err.message || String(err);
    } finally {
      isLoading = false;
    }
  }

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

  async function initializeMainWindowAfterStartup() {
    await loadStartupFiles();
    await showMainWindowAfterStartup();
  }

  $effect(() => {
    if (!textareaEl || isSettingsWindow || hasShownMainWindowOnStartup) return;
    hasShownMainWindowOnStartup = true;

    if (!hasTauriRuntime()) {
      requestAnimationFrame(focusEditorOnStartup);
      return;
    }

    setTimeout(() => {
      void initializeMainWindowAfterStartup();
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
  function findLineIndexForOffset(offset: number): number {
    let low = 0;
    let high = lineStartOffsets.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const current = lineStartOffsets[mid] ?? 0;
      const next = lineStartOffsets[mid + 1] ?? Number.POSITIVE_INFINITY;

      if (offset >= current && offset < next) return mid;
      if (offset < current) high = mid - 1;
      else low = mid + 1;
    }

    return Math.max(0, lineStartOffsets.length - 1);
  }

  function updateEditorSelectionState() {
    hasEditorSelection = textareaEl
      ? textareaEl.selectionStart !== textareaEl.selectionEnd
      : false;
  }

  function updateCursorPosition() {
    if (!textareaEl) return;
    const { start: pos } = getTextareaSelectionInContent();
    const previousCaretOffset = caretOffset;
    const isCollapsed = textareaEl.selectionStart === textareaEl.selectionEnd;
    updateEditorSelectionState();
    caretOffset = pos;
    const lineIndex = findLineIndexForOffset(pos);
    cursorLine = lineIndex + 1;
    cursorCol = pos - (lineStartOffsets[lineIndex] ?? 0) + 1;
    updateEditorCaretColor(pos);
    syncSteadyEditorCaretPosition();
    if (isRenderMode && isCollapsed && pos !== previousCaretOffset && steadyEditorCaretVisible) {
      restartSteadyEditorCaretBlink();
    }
    setLastEditorSnapshot(getCurrentEditorSnapshot());
  }

  function updateEditorStateForSnapshot(snapshot: EditorSnapshot) {
    fileContent = snapshot.content;
    fileName = filePath ? fileName : getFirstLineTitle(fileContent);
    isDirty = getActiveUndoHistory().isDirty();
    errorMsg = null;
    reconcileInlineColorPickerState();
    setLastEditorSnapshot(snapshot);
    updateTabById(activeTabId, {
      fileName,
      fileContent,
      isDirty,
      selectionStart: snapshot.selection.start,
      selectionEnd: snapshot.selection.end
    });
  }

  function applyEditorSnapshot(snapshot: EditorSnapshot, selectionAlreadyApplied = false) {
    updateEditorStateForSnapshot(snapshot);

    if (selectionAlreadyApplied) {
      updateCursorPosition();
      syncActiveTabState();
      return;
    }

    requestAnimationFrame(() => {
      if (!textareaEl) return;
      textareaEl.focus({ preventScroll: true });
      setTextareaSelectionFromContent(snapshot.selection.start, snapshot.selection.end, snapshot.content);
      updateCursorPosition();
      syncActiveTabState();
    });
  }

  function commitEditorEdit(
    before: EditorSnapshot,
    after: EditorSnapshot,
    options: { mergeKey?: string | null; selectionAlreadyApplied?: boolean; keepRenderCaretVisible?: boolean } = {}
  ) {
    const history = getActiveUndoHistory();
    history.record(before, after, { mergeKey: options.mergeKey ?? null });
    applyEditorSnapshot(after, options.selectionAlreadyApplied ?? false);
    if (options.keepRenderCaretVisible) {
      keepEditorCaretVisibleDuringEdit();
    } else {
      syncEditorCaretVisibilityForCurrentMode();
    }
  }

  function commitManualEditorEdit(
    nextContent: string,
    nextSelection: EditorSelection,
    options: { mergeKey?: string | null; keepRenderCaretVisible?: boolean } = {}
  ) {
    if (!options.mergeKey) {
      closeActiveUndoGroup();
    }
    const before = getCurrentEditorSnapshot();
    const after = { content: nextContent, selection: nextSelection };
    commitEditorEdit(before, after, options);
  }

  function commitRenderEditorEdit(nextContent: string, nextSelection: EditorSelection) {
    commitManualEditorEdit(nextContent, nextSelection, { keepRenderCaretVisible: true });
  }

  function commitDelimitedTableEdit(
    nextDocument: DelimitedTableDocument,
    options: { mergeKey?: string | null } = {}
  ) {
    const nextContent = serializeDelimitedTable(nextDocument);
    if (nextContent === fileContent) return;
    if (!options.mergeKey) closeActiveUndoGroup();

    const before = getCurrentEditorSnapshot();
    const selectionOffset = Math.min(before.selection.start, nextContent.length);
    commitEditorEdit(before, {
      content: nextContent,
      selection: { start: selectionOffset, end: selectionOffset }
    }, {
      mergeKey: options.mergeKey ?? null,
      selectionAlreadyApplied: true
    });
  }

  function getNativeInputMergeKey(inputType: string, before: EditorSnapshot, isComposing: boolean): string | null {
    if (isComposing) return 'composition';
    if (before.selection.start !== before.selection.end) return null;
    if (inputType === 'insertText') return 'insert-text';
    if (inputType === 'deleteContentBackward') return 'delete-backward';
    if (inputType === 'deleteContentForward') return 'delete-forward';
    return null;
  }

  // 변경 감지
  function handleInput(event: Event) {
    const target = event.target as HTMLTextAreaElement;
    const pendingInput = pendingNativeInput;
    pendingNativeInput = null;

    const before = pendingInput?.before ?? lastEditorSnapshot;
    const after = getSnapshotFromTextareaInput(before, target.value, target.selectionStart, target.selectionEnd);
    const inputType = pendingInput?.inputType ?? 'input';
    const mergeKey = getNativeInputMergeKey(inputType, before, pendingInput?.isComposing ?? isComposingEditorText);

    commitEditorEdit(before, after, {
      mergeKey,
      selectionAlreadyApplied: true
    });
  }

  function handleEditorBeforeInput(event: InputEvent) {
    if (event.inputType === 'historyUndo') {
      event.preventDefault();
      performUndo();
      return;
    }

    if (event.inputType === 'historyRedo') {
      event.preventDefault();
      performRedo();
      return;
    }

    pendingNativeInput = {
      before: getCurrentEditorSnapshot(),
      inputType: event.inputType,
      isComposing: event.isComposing || isComposingEditorText
    };
    syncEditorCaretVisibilityForCurrentMode();
  }

  function handleEditorCompositionStart() {
    isComposingEditorText = true;
    pendingNativeInput = null;
  }

  function handleEditorCompositionEnd() {
    isComposingEditorText = false;
  }

  function handleEditorFocus() {
    isEditorFocused = true;
    if (isRenderMode && pendingRenderCaretPointerDown && !pendingRenderCaretPointerDown.moved) return;
    updateCursorPosition();
  }

  function handleEditorBlur() {
    isEditorFocused = false;
    closeActiveUndoGroup();
    updateEditorSelectionState();
    hideSteadyEditorCaret();
  }

  $effect(() => {
    if (!isBrowser || !textareaEl) return;

    const handleDocumentSelectionChange = () => {
      if (document.activeElement === textareaEl) {
        if (pendingRenderCaretPointerDown && !pendingRenderCaretPointerDown.moved) return;
        updateCursorPosition();
      }
    };

    document.addEventListener('selectionchange', handleDocumentSelectionChange);
    return () => document.removeEventListener('selectionchange', handleDocumentSelectionChange);
  });

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

  function handleRenderTabIndent(event: KeyboardEvent): boolean {
    if (!textareaEl || event.isComposing) return false;
    if (event.key !== 'Tab') return false;
    if (event.ctrlKey || event.altKey || event.metaKey) return false;

    event.preventDefault();

    const { start, end } = getTextareaSelectionInContent();

    if (start === end && !event.shiftKey) {
      const nextContent = `${fileContent.slice(0, start)}${editorIndentUnit}${fileContent.slice(end)}`;
      commitRenderEditorEdit(nextContent, {
        start: start + editorIndentUnit.length,
        end: start + editorIndentUnit.length
      });
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
      if (start === end) {
        commitRenderEditorEdit(nextContent, {
          start: start + editorIndentUnit.length,
          end: end + editorIndentUnit.length
        });
      } else {
        const nextStart = start === bounds.start ? start : start + editorIndentUnit.length;
        commitRenderEditorEdit(nextContent, {
          start: nextStart,
          end: end + editorIndentUnit.length * lineCount
        });
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

    commitRenderEditorEdit(nextContent, {
      start: start - removedBeforeStart,
      end: end - removedBeforeEnd
    });
    return true;
  }

  function handleRenderIndentBackspace(event: KeyboardEvent): boolean {
    if (!textareaEl || event.isComposing) return false;
    if (event.key !== 'Backspace') return false;
    if (event.ctrlKey || event.altKey || event.metaKey) return false;

    const { start, end } = getTextareaSelectionInContent();
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
    commitRenderEditorEdit(nextContent, {
      start: nextStart,
      end: nextStart
    });
    return true;
  }

  function getLineStartOffset(text: string, offset: number): number {
    if (offset <= 0) return 0;
    return text.lastIndexOf('\n', offset - 1) + 1;
  }

  function getLineEndOffset(text: string, offset: number): number {
    const nextLineBreak = text.indexOf('\n', offset);
    if (nextLineBreak === -1) return text.length;
    return text[nextLineBreak - 1] === '\r' ? nextLineBreak - 1 : nextLineBreak;
  }

  function getPreferredNewline(text: string, offset: number): string {
    const previousLineBreak = offset <= 0 ? -1 : text.lastIndexOf('\n', offset - 1);
    if (previousLineBreak > 0 && text[previousLineBreak - 1] === '\r') return '\r\n';

    const firstLineBreak = text.indexOf('\n');
    if (firstLineBreak > 0 && text[firstLineBreak - 1] === '\r') return '\r\n';

    return '\n';
  }

  function getPreviousLineBounds(text: string, lineStart: number): { start: number; end: number } | null {
    if (lineStart <= 0 || text[lineStart - 1] !== '\n') return null;

    const previousLineEnd = lineStart > 1 && text[lineStart - 2] === '\r'
      ? lineStart - 2
      : lineStart - 1;
    const previousLineStart = previousLineEnd <= 0 ? 0 : text.lastIndexOf('\n', previousLineEnd - 1) + 1;

    return { start: previousLineStart, end: previousLineEnd };
  }

  function getLeadingWhitespace(text: string): string {
    return text.match(/^[ \t]*/)?.[0] ?? '';
  }

  function handleRenderPreserveIndentEnter(event: KeyboardEvent): boolean {
    if (!renderPreserveIndentOnEnter) return false;
    if (!textareaEl || event.isComposing) return false;
    if (event.key !== 'Enter') return false;
    if (event.ctrlKey || event.altKey || event.metaKey) return false;

    const { start, end } = getTextareaSelectionInContent();
    const lineStart = getLineStartOffset(fileContent, start);
    const lineEnd = getLineEndOffset(fileContent, start);
    const lineIndent = getLeadingWhitespace(fileContent.slice(lineStart, lineEnd));
    if (lineIndent.length === 0) return false;

    const insertText = `${getPreferredNewline(fileContent, start)}${lineIndent}`;

    event.preventDefault();
    commitRenderEditorEdit(`${fileContent.slice(0, start)}${insertText}${fileContent.slice(end)}`, {
      start: start + insertText.length,
      end: start + insertText.length
    });
    return true;
  }

  function handleRenderEmptyIndentedLineBackspace(event: KeyboardEvent): boolean {
    if (!renderPreserveIndentOnEnter) return false;
    if (!textareaEl || event.isComposing) return false;
    if (event.key !== 'Backspace') return false;
    if (event.ctrlKey || event.altKey || event.metaKey) return false;

    const { start, end } = getTextareaSelectionInContent();
    if (start !== end || start === 0) return false;

    const lineStart = getLineStartOffset(fileContent, start);
    if (lineStart === 0 || start === lineStart) return false;

    const lineEnd = getLineEndOffset(fileContent, start);
    if (start !== lineEnd) return false;

    const currentLine = fileContent.slice(lineStart, lineEnd);
    if (!/^[ \t]+$/.test(currentLine)) return false;

    const previousLineBounds = getPreviousLineBounds(fileContent, lineStart);
    if (!previousLineBounds) return false;

    const previousLine = fileContent.slice(previousLineBounds.start, previousLineBounds.end);
    if (currentLine !== getLeadingWhitespace(previousLine)) return false;

    event.preventDefault();
    commitRenderEditorEdit(`${fileContent.slice(0, previousLineBounds.end)}${fileContent.slice(start)}`, {
      start: previousLineBounds.end,
      end: previousLineBounds.end
    });
    return true;
  }

  function handleRenderAutoPairInput(event: KeyboardEvent): boolean {
    if (!renderAutoPairEditing) return false;
    if (!textareaEl || event.isComposing) return false;
    if (event.ctrlKey || event.altKey || event.metaKey) return false;

    const closingChar = renderAutoClosingPairs[event.key];
    if (!closingChar) return false;

    const { start, end } = getTextareaSelectionInContent();
    if (start !== end) return false;

    event.preventDefault();

    const nextContent = `${fileContent.slice(0, start)}${event.key}${closingChar}${fileContent.slice(end)}`;
    commitRenderEditorEdit(nextContent, {
      start: start + 1,
      end: start + 1
    });

    return true;
  }

  function isIncompleteRepeatedPairContext(openingChar: string, closingChar: string, caretOffset: number): boolean {
    if (fileContent[caretOffset - 2] !== openingChar) return false;
    return fileContent[caretOffset + 1] !== closingChar;
  }

  function handleRenderAutoPairBackspace(event: KeyboardEvent): boolean {
    if (!renderAutoPairEditing) return false;
    if (!textareaEl || event.isComposing) return false;
    if (event.key !== 'Backspace') return false;
    if (event.ctrlKey || event.altKey || event.metaKey) return false;

    const { start, end } = getTextareaSelectionInContent();
    if (start !== end || start === 0) return false;

    const openingChar = fileContent[start - 1];
    const closingChar = renderAutoClosingPairs[openingChar];
    if (!closingChar || fileContent[start] !== closingChar) return false;
    if (isIncompleteRepeatedPairContext(openingChar, closingChar, start)) return false;

    event.preventDefault();

    const nextContent = `${fileContent.slice(0, start - 1)}${fileContent.slice(start + 1)}`;
    commitRenderEditorEdit(nextContent, {
      start: start - 1,
      end: start - 1
    });

    return true;
  }

  function handleRenderAutoSubstitutionSpace(event: KeyboardEvent): boolean {
    if (!renderAutoSymbolSubstitution) return false;
    if (!textareaEl || event.isComposing) return false;
    if (event.key !== ' ') return false;
    if (event.ctrlKey || event.altKey || event.metaKey) return false;

    const { start, end } = getTextareaSelectionInContent();
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
    commitRenderEditorEdit(nextContent, {
      start: triggerStart + substitution.length + 1,
      end: triggerStart + substitution.length + 1
    });

    return true;
  }

  function handleRenderEditorKeyDown(event: KeyboardEvent) {
    if (handleRenderPreserveIndentEnter(event)) return;
    if (handleRenderEmptyIndentedLineBackspace(event)) return;
    if (handleRenderTabIndent(event)) return;
    if (handleRenderIndentBackspace(event)) return;
    if (handleRenderAutoPairBackspace(event)) return;
    if (handleRenderAutoSubstitutionSpace(event)) return;
    handleRenderAutoPairInput(event);
  }

  function handleEditorKeyDown(event: KeyboardEvent) {
    if (editorMovementKeys.has(event.key)) {
      closeActiveUndoGroup();
    }

    if (!isRenderMode) return;
    handleRenderEditorKeyDown(event);
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
        filters: openFileDialogFilters
      });

      if (selected && typeof selected === "string") {
        await openFilePath(selected);
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

  function performUndo(): boolean {
    finishInlineColorPickerEdit();
    const history = getActiveUndoHistory();
    history.closeGroup();
    const nextSnapshot = history.undo(getCurrentEditorSnapshot());
    if (!nextSnapshot) return false;

    pendingNativeInput = null;
    clearInlineColorPickerState();
    applyEditorSnapshot(nextSnapshot);
    syncEditorCaretVisibilityForCurrentMode();
    return true;
  }

  function performRedo(): boolean {
    finishInlineColorPickerEdit();
    const history = getActiveUndoHistory();
    history.closeGroup();
    const nextSnapshot = history.redo(getCurrentEditorSnapshot());
    if (!nextSnapshot) return false;
    history.closeGroup();

    pendingNativeInput = null;
    clearInlineColorPickerState();
    applyEditorSnapshot(nextSnapshot);
    syncEditorCaretVisibilityForCurrentMode();
    return true;
  }

  function canUndoActiveTab(): boolean {
    return getActiveUndoHistory().canUndo();
  }

  function canRedoActiveTab(): boolean {
    return getActiveUndoHistory().canRedo();
  }

  // 날짜/시간 삽입 (F5)
  function insertDateTime() {
    if (!textareaEl) return;
    const { start, end } = getTextareaSelectionInContent();
    const now = new Date();

    const timeStr = now.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', hour12: true });
    const dateStr = now.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
      .replace(/\. /g, '-').replace(/\./g, '');

    const formatted = `${timeStr} ${dateStr}`;

    const before = fileContent.substring(0, start);
    const after = fileContent.substring(end);
    commitManualEditorEdit(before + formatted + after, {
      start: start + formatted.length,
      end: start + formatted.length
    });

    closeAllDropdown();
  }

  // 편집 메뉴 액션들
  function handleUndo() {
    if (textareaEl) textareaEl.focus();
    performUndo();
    closeAllDropdown();
  }

  // 다시 실행
  function handleRedo() {
    if (textareaEl) textareaEl.focus();
    performRedo();
    closeAllDropdown();
  }

  async function handleCut() {
    if (!textareaEl) return;
    const { start, end } = getTextareaSelectionInContent();
    if (start === end) return;

    const selectedText = fileContent.substring(start, end);
    await navigator.clipboard.writeText(selectedText);

    const before = fileContent.substring(0, start);
    const after = fileContent.substring(end);
    commitManualEditorEdit(before + after, {
      start,
      end: start
    });

    closeAllDropdown();
  }

  async function handleCopy() {
    if (!textareaEl) return;
    const { start, end } = getTextareaSelectionInContent();
    if (start === end) return;

    const selectedText = fileContent.substring(start, end);
    await navigator.clipboard.writeText(selectedText);
    closeAllDropdown();
  }

  async function handlePaste() {
    if (!textareaEl) return;
    try {
      const text = await navigator.clipboard.readText();
      const { start, end } = getTextareaSelectionInContent();

      const before = fileContent.substring(0, start);
      const after = fileContent.substring(end);
      commitManualEditorEdit(before + text + after, {
        start: start + text.length,
        end: start + text.length
      });

      closeAllDropdown();
    } catch (err) {
      console.error(err);
    }
  }

  function handleDelete() {
    if (!textareaEl) return;
    const { start, end } = getTextareaSelectionInContent();
    let newCursorPos = start;

    if (start === end) {
      const before = fileContent.substring(0, start);
      const after = fileContent.substring(start + 1);
      commitManualEditorEdit(before + after, {
        start: newCursorPos,
        end: newCursorPos
      });
    } else {
      const before = fileContent.substring(0, start);
      const after = fileContent.substring(end);
      commitManualEditorEdit(before + after, {
        start: newCursorPos,
        end: newCursorPos
      });
    }

    closeAllDropdown();
  }

  function handleSelectAll() {
    closeActiveUndoGroup();
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
      e.preventDefault();
    }
    // Shift 키를 누르고 세로 휠을 돌릴 때 가로 스크롤 매핑
    else if (e.shiftKey && e.deltaY !== 0) {
      textareaEl.scrollLeft += e.deltaY;
      scrollLeft = textareaEl.scrollLeft;
      e.preventDefault();
    }
  }

  // 스크롤 갱신 핸들러
  function handleScroll(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    scrollTop = target.scrollTop;
    scrollLeft = target.scrollLeft;
    syncSteadyEditorCaretPosition();
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
    const key = e.key.toLowerCase();

    if (!isSettingsWindow && e.ctrlKey && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        performRedo();
      } else {
        performUndo();
      }
    } else if (!isSettingsWindow && e.ctrlKey && key === 'y') {
      e.preventDefault();
      performRedo();
    } else if (e.ctrlKey && key === 'n') {
      e.preventDefault();
      handleNewFile();
    } else if (e.ctrlKey && key === 'o') {
      e.preventDefault();
      handleOpenFile();
    } else if (e.ctrlKey && !e.shiftKey && key === 's') {
      e.preventDefault();
      handleSaveFile();
    } else if (e.ctrlKey && e.shiftKey && key === 's') {
      e.preventDefault();
      handleSaveAsFile();
    } else if (e.ctrlKey && key === 'w') {
      e.preventDefault();
      handleCloseTab(activeTabId);
    } else if (e.key === 'F5') {
      e.preventDefault();
      insertDateTime();
    }
  }

  const depthColorCount = 5;
  const keyDepthColorCount = 3;

  function getTokenClass(token: Token): string {
    const classes = [`hl-${token.type}`];
    if (token.type === 'boolean') {
      if (token.text === 'true') {
        classes.push('hl-boolean-true');
      } else if (token.text === 'false') {
        classes.push('hl-boolean-false');
      }
    }
    if (token.type === 'key') {
      classes.push(`hl-key-depth-${(token.depth ?? 0) % keyDepthColorCount}`);
    } else if (token.depth !== undefined) {
      classes.push(`hl-depth-${token.depth % depthColorCount}`);
    }
    return classes.join(' ');
  }

  let inlineColorPickerEl = $state<HTMLInputElement | null>(null);
  let inlineColorPickerValue = $state<string>('#000000');
  let pendingInlineColorReplacement = $state<{ start: number; end: number } | null>(null);
  let pendingInlineColorEditBefore = $state<EditorSnapshot | null>(null);
  let suppressNextEditorClickAfterRenderAction = false;
  let pendingRenderCaretPointerDown: { pointerId: number; x: number; y: number; moved: boolean } | null = null;
  const parkedInlineColorPickerPosition = { left: -10000, top: -10000 };
  let inlineColorPickerPosition = $state<{ left: number; top: number }>({ ...parkedInlineColorPickerPosition });
  type DataBooleanValue = 'true' | 'false';
  interface DataBooleanRange {
    start: number;
    end: number;
    value: DataBooleanValue;
  }

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
    pendingInlineColorEditBefore = null;
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

  function findColorCodeNearOffset(
    text: string,
    offset: number,
    requireCaretInside: boolean
  ): { start: number; end: number; value: string } | null {
    const colorCodeLength = 7;
    const maxStart = Math.min(
      offset - (requireCaretInside ? 1 : 0),
      text.length - colorCodeLength
    );
    const minStart = Math.max(0, offset - colorCodeLength + 1);

    for (let start = minStart; start <= maxStart; start++) {
      const end = start + colorCodeLength;
      const value = text.slice(start, end);
      if (!hexColorRegex.test(value)) continue;
      if (!hasWhitespaceWordBoundary(text, start, end)) continue;
      if (requireCaretInside ? offset > start && offset < end : offset >= start && offset < end) {
        return { start, end, value };
      }
    }

    return null;
  }

  function findColorCodeAtOffset(text: string, offset: number): { start: number; end: number; value: string } | null {
    return findColorCodeNearOffset(text, offset, false);
  }

  function findColorCodeAtCaretOffset(text: string, offset: number): { start: number; end: number; value: string } | null {
    return findColorCodeNearOffset(text, offset, true);
  }

  function updateEditorCaretColor(offset: number) {
    const activeColor = isRenderMode && isActiveDocumentRenderEnabled ? findColorCodeAtCaretOffset(fileContent, offset) : null;
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

  function getDataBooleanValue(text: string): DataBooleanValue | null {
    return text === 'true' || text === 'false' ? text : null;
  }

  function getRenderedLineElementAtPoint(clientY: number): HTMLElement | null {
    if (!shouldRenderHighlightLayer || !isBrowser || !editorViewportEl || measuredLineHeight <= 0) return null;

    const viewportRect = editorViewportEl.getBoundingClientRect();
    const layoutOffset = clientY - viewportRect.top + scrollTop - editorTopPadding;
    const lineIndex = findLineIndexForLayoutOffset(renderLineLayout, layoutOffset);
    if (lineIndex < startLine || lineIndex > endLine) return null;

    return document.querySelector(`.backdrop-line[data-line-index="${lineIndex}"]`) as HTMLElement | null;
  }

  function getMeasuredTextOffsetAtX(text: string, clientX: number): number {
    if (text.length === 0) return 0;

    let bestOffset = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let offset = 0; offset <= text.length; offset += 1) {
      const caretX = measureEditorTextEndWidth(text.slice(0, offset), 0);
      const distance = Math.abs(caretX - clientX);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestOffset = offset;
      }
    }

    return bestOffset;
  }

  function getRenderedLineSegmentAtPoint(
    lineText: string,
    lineElement: HTMLElement,
    clientY: number
  ): { segment: WrappedLineSegment; rowIndex: number } {
    const segments = getWrappedLineSegments(lineText, renderWrapContentWidth);
    const lineRect = lineElement.getBoundingClientRect();
    const rowIndex = clamp(Math.floor((clientY - lineRect.top) / measuredLineHeight), 0, segments.length - 1);

    return {
      segment: segments[rowIndex] ?? segments[segments.length - 1] ?? { start: 0, end: lineText.length },
      rowIndex
    };
  }

  function getRenderedLineTextOffsetAtPoint(
    lineElement: HTMLElement,
    lineText: string,
    clientX: number,
    clientY: number
  ): number {
    const lineRect = lineElement.getBoundingClientRect();
    const { segment } = getRenderedLineSegmentAtPoint(lineText, lineElement, clientY);
    const contentLeft = lineRect.left + getEditorTextPaddingLeft();
    const segmentText = lineText.slice(segment.start, segment.end);
    const localX = Math.max(0, clientX - contentLeft);

    return clamp(
      segment.start + getMeasuredTextOffsetAtX(segmentText, localX),
      0,
      lineText.length
    );
  }

  function getRenderedCaretRectFromLineText(
    lineElement: HTMLElement,
    lineText: string,
    offsetInLine: number
  ): DOMRect {
    const segments = getWrappedLineSegments(lineText, renderWrapContentWidth);
    let rowIndex = 0;
    let segment = segments[0] ?? { start: 0, end: lineText.length };

    for (let i = 0; i < segments.length; i += 1) {
      const candidate = segments[i];
      if (!candidate) continue;

      if (offsetInLine < candidate.end || i === segments.length - 1) {
        rowIndex = i;
        segment = candidate;
        break;
      }
    }

    const lineRect = lineElement.getBoundingClientRect();
    const offsetWithinSegment = clamp(offsetInLine - segment.start, 0, segment.end - segment.start);
    const caretX = measureEditorTextEndWidth(
      lineText.slice(segment.start, segment.start + offsetWithinSegment),
      0
    );

    return new DOMRect(
      lineRect.left + getEditorTextPaddingLeft() + caretX,
      lineRect.top + rowIndex * measuredLineHeight,
      1,
      measuredLineHeight
    );
  }

  function getRenderedCaretRectForOffset(offset: number): DOMRect | null {
    if (!isBrowser || !editorViewportEl || !shouldRenderHighlightLayer) return null;

    const lineIndex = findLineIndexForOffset(offset);
    if (lineIndex < startLine || lineIndex > endLine) return null;

    const lineElement = document.querySelector(
      `.backdrop-line[data-line-index="${lineIndex}"]`
    ) as HTMLElement | null;
    if (!lineElement) return null;

    const lineStart = lineStartOffsets[lineIndex] ?? 0;
    const lineText = getLineTextForLayout(fileContent, lineStartOffsets, lineIndex);
    const lineEnd = lineStart + lineText.length;
    const offsetInLine = clamp(offset - lineStart, 0, lineEnd - lineStart);
    return getRenderedCaretRectFromLineText(lineElement, lineText, offsetInLine);
  }

  function getRenderedCaretOffsetAtPoint(clientX: number, clientY: number): number | null {
    const lineElement = getRenderedLineElementAtPoint(clientY);
    if (!lineElement) return null;

    const lineIndex = Number(lineElement.dataset.lineIndex);
    if (!Number.isFinite(lineIndex)) return null;

    const lineStart = lineStartOffsets[lineIndex] ?? 0;
    const lineText = getLineTextForLayout(fileContent, lineStartOffsets, lineIndex);
    const offsetInLine = getRenderedLineTextOffsetAtPoint(lineElement, lineText, clientX, clientY);
    return lineStart + offsetInLine;
  }

  function findRenderedTokenElementAtPoint(
    clientX: number,
    clientY: number,
    selector: string
  ): HTMLElement | null {
    const lineElement = getRenderedLineElementAtPoint(clientY);
    if (!lineElement) return null;

    const elements = lineElement.querySelectorAll<HTMLElement>(selector);
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return element;
      }
    }

    return null;
  }

  function findDataBooleanAtPoint(clientX: number, clientY: number): DataBooleanRange | null {
    if (!isBrowser || !isRenderMode || !isActiveDocumentRenderEnabled || !isActiveDocumentEditEnabled) return null;
    const element = findRenderedTokenElementAtPoint(
      clientX,
      clientY,
      '.hl-boolean[data-boolean-start][data-boolean-end]'
    );
    if (!element) return null;

    const start = Number(element.dataset.booleanStart);
    const end = Number(element.dataset.booleanEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

    const value = getDataBooleanValue(fileContent.slice(start, end))
      ?? getDataBooleanValue(element.dataset.booleanValue || '');
    if (!value) return null;

    return { start, end, value };
  }

  function toggleDataBoolean(range: DataBooleanRange) {
    const nextValue = range.value === 'true' ? 'false' : 'true';
    const nextContent = `${fileContent.slice(0, range.start)}${nextValue}${fileContent.slice(range.end)}`;
    const { start: selectionStart, end: selectionEnd } = getCurrentEditorSelection();
    const nextSelectionStart = adjustOffsetAfterReplacement(selectionStart, range, nextValue.length);
    const nextSelectionEnd = adjustOffsetAfterReplacement(selectionEnd, range, nextValue.length);

    commitRenderEditorEdit(nextContent, {
      start: nextSelectionStart,
      end: nextSelectionEnd
    });
  }

  function adjustOffsetAfterReplacement(offset: number, range: { start: number; end: number }, replacementLength: number) {
    if (offset <= range.start) return offset;

    const replacedLength = range.end - range.start;
    const delta = replacementLength - replacedLength;
    if (offset >= range.end) return offset + delta;

    return range.start + Math.min(offset - range.start, replacementLength);
  }

  function findColorCodeAtPoint(clientX: number, clientY: number): { start: number; end: number; value: string } | null {
    if (!isBrowser || !isRenderMode || !isActiveDocumentRenderEnabled || !isActiveDocumentEditEnabled) return null;
    const element = findRenderedTokenElementAtPoint(
      clientX,
      clientY,
      '.hl-color[data-color-start][data-color-end]'
    );
    if (!element) return null;

    const start = Number(element.dataset.colorStart);
    const end = Number(element.dataset.colorEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

    return {
      start,
      end,
      value: element.textContent || fileContent.slice(start, end)
    };
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
    pendingInlineColorEditBefore = getCurrentEditorSnapshot();
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

  function applyInlineColorPreview(start: number, end: number, nextValue: string) {
    fileContent = `${fileContent.slice(0, start)}${nextValue}${fileContent.slice(end)}`;
    inlineColorPickerValue = nextValue;
    pendingInlineColorReplacement = { start, end: start + nextValue.length };
    fileName = filePath ? fileName : getFirstLineTitle(fileContent);
    isDirty = true;
    errorMsg = null;
    updateEditorCaretColor(caretOffset);
    setLastEditorSnapshot({
      content: fileContent,
      selection: {
        start,
        end: start + nextValue.length
      }
    });
    updateTabById(activeTabId, {
      fileName,
      fileContent,
      isDirty,
      selectionStart: start,
      selectionEnd: start + nextValue.length
    });

    requestAnimationFrame(() => {
      if (!textareaEl) return;
      setTextareaSelectionFromContent(start, start + nextValue.length);
      updateCursorPosition();
      if (pendingInlineColorReplacement) {
        positionInlineColorPicker({ start, end: start + nextValue.length });
      }
    });
  }

  function finishInlineColorPickerEdit() {
    if (!pendingInlineColorReplacement || !pendingInlineColorEditBefore) return;

    const { start, end } = pendingInlineColorReplacement;
    const before = pendingInlineColorEditBefore;
    const after = {
      content: fileContent,
      selection: { start, end }
    };
    pendingInlineColorEditBefore = null;
    closeActiveUndoGroup();
    commitEditorEdit(before, after);
  }

  function handleEditorPointerDown(event: PointerEvent) {
    if (event.button === 0) {
      closeActiveUndoGroup();
    }
    if (!isRenderMode || !isActiveDocumentRenderEnabled || !textareaEl || event.button !== 0) return;

    pendingRenderCaretPointerDown = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false
    };

    if (!isActiveDocumentEditEnabled) return;

    const booleanRange = findDataBooleanAtPoint(event.clientX, event.clientY);
    if (booleanRange) {
      pendingRenderCaretPointerDown = null;
      event.preventDefault();
      suppressNextEditorClickAfterRenderAction = true;
      textareaEl.focus({ preventScroll: true });
      clearInlineColorPickerState();
      toggleDataBoolean(booleanRange);
      return;
    }

    const range = findColorCodeAtPoint(event.clientX, event.clientY);
    if (!range) return;

    pendingRenderCaretPointerDown = null;
    event.preventDefault();
    suppressNextEditorClickAfterRenderAction = true;
    textareaEl.focus({ preventScroll: true });
    setTextareaSelectionFromContent(range.start, range.end);
    updateCursorPosition();
    openInlineColorPicker(range);
  }

  function placeRenderCaretAtPoint(clientX: number, clientY: number): boolean {
    if (!textareaEl || textareaEl.selectionStart !== textareaEl.selectionEnd) return false;

    const renderedCaretOffset = getRenderedCaretOffsetAtPoint(clientX, clientY);
    if (renderedCaretOffset === null) return false;

    setTextareaSelectionFromContent(renderedCaretOffset, renderedCaretOffset);
    updateCursorPosition();
    if (steadyEditorCaretVisible) {
      restartSteadyEditorCaretBlink();
    }
    return true;
  }

  function handleEditorPointerUp(event: PointerEvent) {
    if (!isRenderMode || !isActiveDocumentRenderEnabled || !textareaEl || event.button !== 0) return;
    if (suppressNextEditorClickAfterRenderAction) {
      pendingRenderCaretPointerDown = null;
      return;
    }

    const pointerDown = pendingRenderCaretPointerDown;
    if (!pointerDown || pointerDown.pointerId !== event.pointerId) return;

    const movedDistance = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
    pointerDown.moved = movedDistance > 4;
    if (pointerDown.moved) {
      pendingRenderCaretPointerDown = null;
      updateCursorPosition();
    }
  }

  function trackRenderCaretPointerMove(event: MouseEvent) {
    const pointerDown = pendingRenderCaretPointerDown;
    if (!pointerDown || pointerDown.moved || event.buttons !== 1) return;

    const movedDistance = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
    if (movedDistance <= 4) return;

    pointerDown.moved = true;
    hideSteadyEditorCaret();
    updateCursorPosition();
  }

  function handleEditorClick(event: MouseEvent) {
    if (suppressNextEditorClickAfterRenderAction) {
      suppressNextEditorClickAfterRenderAction = false;
      pendingRenderCaretPointerDown = null;
      return;
    }
    if (!isRenderMode || !isActiveDocumentRenderEnabled || !isActiveDocumentEditEnabled || !textareaEl) return;

    const pointerDown = pendingRenderCaretPointerDown;
    pendingRenderCaretPointerDown = null;

    if (pointerDown?.moved) {
      updateCursorPosition();
      return;
    }

    if (textareaEl.selectionStart !== textareaEl.selectionEnd) {
      updateCursorPosition();
      return;
    }

    const targetX = pointerDown && !pointerDown.moved ? pointerDown.x : event.clientX;
    const targetY = pointerDown && !pointerDown.moved ? pointerDown.y : event.clientY;
    const placedCaret = placeRenderCaretAtPoint(targetX, targetY);
    if (!placedCaret) {
      updateCursorPosition();
    }

    if (!isActiveDocumentEditEnabled) {
      clearInlineColorPickerState();
      return;
    }

    const range = findColorCodeAtPoint(targetX, targetY)
      ?? findColorCodeAtOffset(fileContent, getCurrentEditorSelection().start);
    if (range) {
      openInlineColorPicker(range);
    } else {
      clearInlineColorPickerState();
    }
  }

  function handleEditorMouseMove(event: MouseEvent) {
    trackRenderCaretPointerMove(event);

    if (!isRenderMode || !isActiveDocumentRenderEnabled || !isActiveDocumentEditEnabled) {
      editorCursorStyle = 'text';
      return;
    }
    editorCursorStyle = findDataBooleanAtPoint(event.clientX, event.clientY) || findColorCodeAtPoint(event.clientX, event.clientY)
      ? 'pointer'
      : 'text';
  }

  function handleEditorMouseLeave() {
    editorCursorStyle = 'text';
  }

  function handleInlineColorPickerInput(event: Event) {
    if (!pendingInlineColorReplacement) return;
    const target = event.currentTarget as HTMLInputElement;
    const nextValue = target.value.toUpperCase();
    const { start, end } = pendingInlineColorReplacement;

    applyInlineColorPreview(start, end, nextValue);
  }

  function handleInlineColorPickerChange(event: Event) {
    if (pendingInlineColorReplacement) {
      const target = event.currentTarget as HTMLInputElement;
      const nextValue = target.value.toUpperCase();
      if (nextValue !== inlineColorPickerValue) {
        const { start, end } = pendingInlineColorReplacement;
        applyInlineColorPreview(start, end, nextValue);
      }
    }
    finishInlineColorPickerEdit();
    clearInlineColorPickerState();
  }

  function toggleRenderMode() {
    isRenderMode = !isRenderMode;
    editorCursorStyle = 'text';
    hideSteadyEditorCaret();
    clearInlineColorPickerState();
    requestAnimationFrame(() => updateCursorPosition());
  }
</script>

<svelte:window onkeydown={handleKeyDown} onclick={closeAllDropdown} />

{#snippet renderToken(token: Token)}{#if token.children && token.children.length > 0}<span class={getTokenClass(token)}>{#each token.children as child}{@render renderToken(child)}{/each}</span>{:else if token.type === 'boolean'}<span class={getTokenClass(token)} data-token-start={token.start ?? null} data-token-end={token.end ?? null} data-boolean-start={token.start} data-boolean-end={token.end} data-boolean-value={token.text}>{token.text || ''}</span>{:else if token.type === 'color'}<span class={getTokenClass(token)} style={getColorCodeStyle(token.text || '')} data-token-start={token.start ?? null} data-token-end={token.end ?? null} data-color-start={token.start} data-color-end={token.end}>{token.text || ''}</span>{:else}<span class={getTokenClass(token)} data-token-start={token.start ?? null} data-token-end={token.end ?? null}>{token.text || ''}</span>{/if}{/snippet}

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
    --color-hl-key-strong: {activeColors.keyStrong};
    --color-hl-key-medium: {activeColors.keyMedium};
    --color-hl-key-light: {activeColors.keyLight};
    --color-hl-string: {activeColors.string};
    --color-hl-number: {activeColors.number};
    --color-hl-list-marker: {activeColors.listMarker};
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
            {#each configurableDocumentFormatCategories as category}
              <div class="sidebar-tree-group format-category-group">
                <button
                  type="button"
                  class="sidebar-item tree-child sidebar-category"
                  class:active={activeSettingsView === getDocumentFormatCategorySettingsView(category.id)}
                  aria-expanded={expandedFormatCategories[category.id]}
                  onclick={() => selectDocumentFormatCategory(category.id)}
                >
                  <ChevronDown
                    size={12}
                    class={expandedFormatCategories[category.id] ? 'tree-chevron' : 'tree-chevron collapsed'}
                  />
                  {#if category.id === 'document'}
                    <FileText size={15} class="tab-icon"/>
                  {:else if category.id === 'structured'}
                    <Braces size={15} class="tab-icon"/>
                  {:else if category.id === 'table'}
                    <Table2 size={15} class="tab-icon"/>
                  {:else}
                    <Code2 size={15} class="tab-icon"/>
                  {/if}
                  {category.label}
                </button>
                {#if expandedFormatCategories[category.id]}
                  {#each getDocumentFormatsForCategory(category) as format}
                    <button
                      type="button"
                      class="sidebar-item tree-grandchild"
                      class:active={activeSettingsView === getDocumentFormatSettingsView(format.id)}
                      onclick={() => activeSettingsView = getDocumentFormatSettingsView(format.id)}
                    >
                      <FileCode2 size={14} class="tab-icon"/> {format.label}
                    </button>
                  {/each}
                {/if}
              </div>
            {/each}
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
              {@render colorSettingRow('color-hl-key-strong-window-dark', '키 색상 1단계 (진한색)', darkColors, 'keyStrong')}
              {@render colorSettingRow('color-hl-key-medium-window-dark', '키 색상 2단계 (중간색)', darkColors, 'keyMedium')}
              {@render colorSettingRow('color-hl-key-light-window-dark', '키 색상 3단계 (연한색)', darkColors, 'keyLight')}
              {@render colorSettingRow('color-hl-string-window-dark', `문자열 색상 ('...', "...")`, darkColors, 'string')}
              {@render colorSettingRow('color-hl-number-window-dark', '숫자 색상 (0-9)', darkColors, 'number')}
              {@render colorSettingRow('color-hl-list-marker-window-dark', '글머리 기호 색상', darkColors, 'listMarker')}
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
              {@render colorSettingRow('color-hl-key-strong-window-light', '키 색상 1단계 (진한색)', lightColors, 'keyStrong')}
              {@render colorSettingRow('color-hl-key-medium-window-light', '키 색상 2단계 (중간색)', lightColors, 'keyMedium')}
              {@render colorSettingRow('color-hl-key-light-window-light', '키 색상 3단계 (연한색)', lightColors, 'keyLight')}
              {@render colorSettingRow('color-hl-string-window-light', `문자열 색상 ('...', "...")`, lightColors, 'string')}
              {@render colorSettingRow('color-hl-number-window-light', '숫자 색상 (0-9)', lightColors, 'number')}
              {@render colorSettingRow('color-hl-list-marker-window-light', '글머리 기호 색상', lightColors, 'listMarker')}
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
            <label class="settings-check-row" for="render-preserve-indent-on-enter-window">
              <input
                id="render-preserve-indent-on-enter-window"
                class="settings-checkbox"
                type="checkbox"
                bind:checked={renderPreserveIndentOnEnter}
              />
              <span class="settings-check-copy">
                <span class="settings-check-title">줄바꿈 시 들여쓰기 유지</span>
                <span class="settings-check-description">들여쓰기된 줄에서 Enter를 누르면 다음 줄에도 같은 들여쓰기를 넣습니다.</span>
              </span>
            </label>
          </div>
        {:else if activeSettingsCategory}
          <div class="settings-section">
            <div class="settings-format-module">
              <div class="settings-format-heading">
                <h4 class="section-title">{activeSettingsCategory.label}</h4>
                <span class="settings-check-description">{activeSettingsCategory.description}</span>
              </div>
              <div class="settings-category-formats" aria-label={`${activeSettingsCategory.label} 형식`}>
                {#each getDocumentFormatsForCategory(activeSettingsCategory) as format}
                  <span class="settings-format-chip">{format.label}</span>
                {/each}
              </div>
            </div>

            {#if activeSettingsCategory.id === 'table'}
              <div class="settings-format-module">
                <h5 class="settings-subsection-title">표시</h5>
                <label class="settings-check-row" for="delimited-table-highlight-header-window">
                  <input
                    id="delimited-table-highlight-header-window"
                    class="settings-checkbox"
                    type="checkbox"
                    bind:checked={delimitedTableHighlightHeader}
                  />
                  <span class="settings-check-copy">
                    <span class="settings-check-title">첫 행 강조</span>
                    <span class="settings-check-description">CSV와 TSV에서 데이터의 첫 번째 행을 머리글로 강조합니다.</span>
                  </span>
                </label>
                <label class="settings-check-row" for="delimited-table-show-row-indices-window">
                  <input
                    id="delimited-table-show-row-indices-window"
                    class="settings-checkbox"
                    type="checkbox"
                    bind:checked={delimitedTableShowRowIndices}
                  />
                  <span class="settings-check-copy">
                    <span class="settings-check-title">행 번호 표시</span>
                    <span class="settings-check-description">CSV와 TSV 표의 왼쪽 조작 여백에 행 번호를 표시합니다.</span>
                  </span>
                </label>
              </div>

              <div class="settings-format-module">
                <h5 class="settings-subsection-title">행·열 이동</h5>
                <label class="settings-check-row" for="delimited-table-reorder-animation-window">
                  <input
                    id="delimited-table-reorder-animation-window"
                    class="settings-checkbox"
                    type="checkbox"
                    bind:checked={delimitedTableAnimateReorder}
                  />
                  <span class="settings-check-copy">
                    <span class="settings-check-title">이동 애니메이션</span>
                    <span class="settings-check-description">드롭할 때 주변 행과 열을 밀고 대상을 삽입 위치로 이동시킵니다.</span>
                  </span>
                </label>
                <label
                  class="settings-duration-row"
                  class:disabled={!delimitedTableAnimateReorder}
                  for="delimited-table-reorder-duration-window"
                >
                  <span>이동 시간</span>
                  <input
                    id="delimited-table-reorder-duration-window"
                    class="settings-duration-range"
                    type="range"
                    min={delimitedTableReorderDurationMinMs}
                    max={delimitedTableReorderDurationMaxMs}
                    step={delimitedTableReorderDurationStepMs}
                    bind:value={delimitedTableReorderDurationMs}
                    disabled={!delimitedTableAnimateReorder}
                    aria-valuetext={formatDelimitedTableReorderDuration(delimitedTableReorderDurationMs)}
                  />
                  <output class="settings-duration-value">
                    {formatDelimitedTableReorderDuration(delimitedTableReorderDurationMs)}
                  </output>
                </label>
              </div>
            {:else}
              <p class="settings-category-note">
                렌더 표시와 편집 여부는 아래의 개별 파일 형식에서 설정합니다.
              </p>
            {/if}
          </div>
        {:else if activeSettingsFormat}
          <div class="settings-section">
            <div class="settings-format-module">
              <div class="settings-format-heading">
                <h4 class="section-title">{activeSettingsFormat.label}</h4>
                <span class="settings-check-description">
                  {activeSettingsFormat.extensions.length > 0 ? activeSettingsFormat.extensions.map((extension) => `.${extension}`).join(', ') : '확장자가 없는 기본 텍스트'}
                </span>
              </div>
              <label class="settings-check-row" for={`document-format-${activeSettingsFormat.id}-render-window`}>
                <input
                  id={`document-format-${activeSettingsFormat.id}-render-window`}
                  class="settings-checkbox"
                  type="checkbox"
                  checked={documentFeatureSettings[activeSettingsFormat.id].render}
                  onchange={(event) => setDocumentFormatFeature(activeSettingsFormat.id, 'render', (event.currentTarget as HTMLInputElement).checked)}
                />
                <span class="settings-check-copy">
                  <span class="settings-check-title">렌더 표시</span>
                  <span class="settings-check-description">{activeSettingsFormat.renderDescription}</span>
                </span>
              </label>
              <label class="settings-check-row" for={`document-format-${activeSettingsFormat.id}-edit-window`}>
                <input
                  id={`document-format-${activeSettingsFormat.id}-edit-window`}
                  class="settings-checkbox"
                  type="checkbox"
                  checked={documentFeatureSettings[activeSettingsFormat.id].edit}
                  onchange={(event) => setDocumentFormatFeature(activeSettingsFormat.id, 'edit', (event.currentTarget as HTMLInputElement).checked)}
                />
                <span class="settings-check-copy">
                  <span class="settings-check-title">렌더 편집</span>
                  <span class="settings-check-description">{activeSettingsFormat.editDescription}</span>
                </span>
              </label>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{:else}
  <div class="app-container" style="
    --color-hl-code-bg: {activeColors.codeBg};
    --color-hl-code-text: {activeColors.codeText};
    --color-hl-key-strong: {activeColors.keyStrong};
    --color-hl-key-medium: {activeColors.keyMedium};
    --color-hl-key-light: {activeColors.keyLight};
    --color-hl-string: {activeColors.string};
    --color-hl-number: {activeColors.number};
    --color-hl-list-marker: {activeColors.listMarker};
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
              <button class="dropdown-item" onclick={handleUndo} disabled={!canUndoActiveTab()}>
                <span class="item-label">실행 취소</span>
                <span class="shortcut-label">Ctrl+Z</span>
              </button>
              <button class="dropdown-item" onclick={handleRedo} disabled={!canRedoActiveTab()}>
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
        {#if errorMsg || documentDiagnostic}
          <div
            class="menu-error-indicator"
            class:syntax-error={!errorMsg && !!documentDiagnostic}
            title={errorMsg || documentDiagnostic?.message}
          >
            ⚠️ {errorMsg || documentDiagnostic?.message}
          </div>
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
    <main
      class="editor-area"
      class:render-mode={isRenderMode}
      class:render-selection-active={isRenderMode && hasEditorSelection}
      class:render-wrap-settling={isRenderMode && isRenderWrapSettling}
      class:render-native-text-visible={shouldShowNativeRenderText}
    >
      <div class="editor-container">
        {#if shouldShowDelimitedTableEditor && activeDelimitedTableDocument}
          <DelimitedTableEditor
            document={activeDelimitedTableDocument}
            formatLabel={activeDocumentFormat.label}
            editable={isActiveDocumentEditEnabled}
            highlightHeader={delimitedTableHighlightHeader}
            showRowIndices={delimitedTableShowRowIndices}
            animateReorder={delimitedTableAnimateReorder}
            reorderDurationMs={delimitedTableReorderDurationMs}
            ondocumentchange={commitDelimitedTableEdit}
            onhighlightheaderchange={(enabled) => delimitedTableHighlightHeader = enabled}
            onshowrowindiceschange={(enabled) => delimitedTableShowRowIndices = enabled}
          />
        {:else}
        <!-- 라인 번호 Gutter -->
        {#if isRenderMode}
          <div class="editor-gutter" style="background-color: var(--color-render-bg); border-right: 1px solid var(--border-color);">
            {#if !isRenderWrapSettling}
              <div class="gutter-scroll-container" style="transform: translate3d(0, -{scrollTop}px, 0);">
                {#each Array(endLine - startLine + 1) as _, idx}
                  {@const lineIdx = startLine + idx}
                  <div
                    class="gutter-line-number"
                    class:diagnostic-line={documentDiagnostic?.line === lineIdx + 1}
                    style="position: absolute; top: {getRenderLineTop(lineIdx) + editorTopPadding}px; height: {getRenderLineHeight(lineIdx)}px; line-height: {measuredLineHeight}px; font-size: {currentFontSize}pt;"
                  >
                    {lineIdx + 1}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}

        <!-- 에디터 영역 뷰포트 -->
        <div
          class="editor-viewport"
          bind:this={editorViewportEl}
        >
          <!-- 렌더 모드 Backdrop -->
          {#if shouldRenderHighlightLayer}
            <div class="editor-backdrop">
              <div class="backdrop-scroll-container" style="transform: translate3d(0, -{scrollTop}px, 0);">
                {#each Array(endLine - startLine + 1) as _, idx}
                  {@const lineIdx = startLine + idx}
                  {@const line = parsedLines[idx]}
                  {#if line}
                    <div class="backdrop-line" data-line-index={lineIdx} class:diagnostic-line={documentDiagnostic?.line === lineIdx + 1} style="position: absolute; top: {getRenderLineTop(lineIdx) + editorTopPadding}px; left: 0; width: {getEditorTextBoxWidth()}px; min-height: {getRenderLineHeight(lineIdx)}px; line-height: {measuredLineHeight}px; font-size: {currentFontSize}pt; tab-size: {tabSize}; -moz-tab-size: {tabSize};">{#each Array(line.indentLevel) as _, i}<span class="guide-line" style="left: calc({i * tabSize}ch + 12px);"></span>{/each}<span class="line-content">{#each line.tokens as token}{@render renderToken(token)}{/each}</span></div>
                  {/if}
                {/each}
              </div>
            </div>
          {/if}

          <textarea
            bind:this={textareaEl}
            class="editor-textarea"
            style="font-size: {currentFontSize}pt; line-height: {measuredLineHeight}px; tab-size: {tabSize}; -moz-tab-size: {tabSize}; caret-color: {isRenderMode && isActiveDocumentRenderEnabled && !shouldShowNativeRenderText ? 'transparent' : steadyEditorCaretVisible ? 'transparent' : 'var(--text-color)'}; cursor: {isRenderMode ? editorCursorStyle : 'text'};"
            wrap={isRenderMode ? 'soft' : 'off'}
            value={textareaDisplayContent}
            onkeydown={handleEditorKeyDown}
            onbeforeinput={handleEditorBeforeInput}
            oninput={handleInput}
            oncompositionstart={handleEditorCompositionStart}
            oncompositionend={handleEditorCompositionEnd}
            onscroll={handleScroll}
            onpointerdown={handleEditorPointerDown}
            onpointerup={handleEditorPointerUp}
            onkeyup={updateCursorPosition}
            onselect={updateCursorPosition}
            onclick={handleEditorClick}
            onmousemove={handleEditorMouseMove}
            onmouseleave={handleEditorMouseLeave}
            onfocus={handleEditorFocus}
            onblur={handleEditorBlur}
            spellcheck="false"
          ></textarea>
          {#if steadyEditorCaretVisible && steadyEditorCaretCollapsed}
            {#key steadyEditorCaretBlinkKey}
              <div
                class="steady-editor-caret"
                style="left: {steadyEditorCaretLeft}px; top: {steadyEditorCaretTop}px; height: {measuredLineHeight}px; background-color: {isRenderMode ? editorCaretColor : 'var(--text-color)'};"
                aria-hidden="true"
              ></div>
            {/key}
          {/if}
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
        {/if}
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
        {#if shouldShowDocumentSyntaxStatus}
          <span
            class="status-item"
            class:status-error={!!documentDiagnostic}
            title={documentDiagnostic?.message || `${activeDocumentFormat.label} 문법 문제가 없습니다`}
          >
            {#if documentDiagnostic}
              {activeDocumentFormat.label} 오류 {documentDiagnostic.line}:{documentDiagnostic.column}
            {:else}
              {activeDocumentFormat.label} 정상
            {/if}
          </span>
        {/if}
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
    --color-hl-key-strong: #0369a1;
    --color-hl-key-medium: #0284c7;
    --color-hl-key-light: #38bdf8;
    --color-hl-string: #a31515;
    --color-hl-number: #098658;
    --color-hl-list-marker: #4f46e5;
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
    --color-hl-key-strong: #0284c7;
    --color-hl-key-medium: #38bdf8;
    --color-hl-key-light: #7dd3fc;
    --color-hl-string: #ce9178;
    --color-hl-number: #b5cea8;
    --color-hl-list-marker: #a5b4fc;
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
  :global(.hl-list-marker) {
    color: var(--color-hl-list-marker);
  }
  :global(.hl-key) {
    color: var(--color-hl-key-medium);
  }
  :global(.hl-key-depth-0) {
    color: var(--color-hl-key-strong);
  }
  :global(.hl-key-depth-1) {
    color: var(--color-hl-key-medium);
  }
  :global(.hl-key-depth-2) {
    color: var(--color-hl-key-light);
  }
  :global(.hl-literal) {
    color: var(--color-hl-number);
  }
  :global(.hl-boolean) {
    border-radius: 3px;
    margin-inline: -0.16em;
    padding-inline: 0.16em;
    box-shadow: inset 0 0 0 1px rgba(107, 114, 128, 0.35);
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }
  :global(.hl-boolean-true) {
    color: #166534;
    background-color: #dcfce7;
  }
  :global(.hl-boolean-false) {
    color: #991b1b;
    background-color: #fee2e2;
  }
  :global(.theme-dark .hl-boolean-true) {
    color: #bbf7d0;
    background-color: rgba(34, 197, 94, 0.22);
    box-shadow: inset 0 0 0 1px rgba(134, 239, 172, 0.45);
  }
  :global(.theme-dark .hl-boolean-false) {
    color: #fecaca;
    background-color: rgba(239, 68, 68, 0.22);
    box-shadow: inset 0 0 0 1px rgba(252, 165, 165, 0.45);
  }
  :global(.hl-punctuation) {
    color: var(--text-muted);
  }
  :global(.hl-invalid) {
    color: #dc2626;
    background-color: rgba(220, 38, 38, 0.12);
    box-shadow: inset 0 -1px 0 #dc2626;
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
    position: relative;
    z-index: 110;
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
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: 6px;
    flex: 1 1 auto;
    min-width: 0;
    padding: 5px 96px 0 0;
    box-sizing: border-box;
  }

  .titlebar-drag-region {
    position: absolute;
    inset: 0;
    z-index: 0;
  }

  .tab-list {
    position: relative;
    z-index: 1;
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
    position: relative;
    z-index: 1;
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
    position: relative;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background-color: var(--bg-window);
    height: 32px;
    padding: 0 0.5rem;
    border-bottom: 1px solid var(--border-color);
    user-select: none;
    box-sizing: border-box;
    z-index: 100;
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

  .menu-error-indicator.syntax-error {
    color: #dc2626;
  }

  /* 메인 편집기 공간 */
  .editor-area {
    flex: 1;
    background-color: var(--bg-editor);
    overflow: hidden;
    position: relative;
    z-index: 0;
    isolation: isolate;
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

  .gutter-line-number.diagnostic-line {
    color: #dc2626;
    font-weight: 700;
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
    width: 100%;
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    word-break: keep-all;
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

  .backdrop-line.diagnostic-line {
    background-color: rgba(220, 38, 38, 0.07);
  }

  .guide-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background-color: var(--color-indent-guide);
  }

  .line-content {
    display: inline;
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
    white-space: pre-wrap;
    overflow-wrap: break-word;
    word-break: keep-all;
  }

  .render-mode .editor-textarea::selection {
    background: rgba(96, 165, 250, 0.28);
    color: transparent;
  }

  .render-mode.render-native-text-visible .editor-backdrop {
    opacity: 0;
  }

  .render-mode.render-native-text-visible .editor-textarea {
    color: var(--color-render-text, var(--text-color));
  }

  .render-mode.render-native-text-visible .editor-textarea::selection {
    color: var(--color-render-text, var(--text-color));
  }

  .steady-editor-caret {
    position: absolute;
    width: 1px;
    z-index: 3;
    pointer-events: none;
    animation: editorCaretBlink 1s step-end infinite;
  }

  @keyframes editorCaretBlink {
    0%, 50% {
      opacity: 1;
    }
    50.01%, 100% {
      opacity: 0;
    }
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
    overflow-y: auto;
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

  .tree-grandchild {
    padding-left: 4.25rem;
    font-size: 0.8rem;
  }

  .format-category-group {
    gap: 0;
  }

  .sidebar-category {
    font-weight: 500;
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

  .settings-duration-row {
    display: grid;
    grid-template-columns: 64px minmax(120px, 240px) 52px;
    align-items: center;
    gap: 0.6rem;
    padding-left: 26px;
    color: var(--text-color);
    font-size: 0.8rem;
  }

  .settings-duration-row.disabled {
    opacity: 0.45;
  }

  .settings-duration-range {
    width: 100%;
    min-width: 0;
    margin: 0;
    accent-color: var(--accent-color);
  }

  .settings-duration-value {
    color: var(--text-muted);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .settings-format-module {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    padding-top: 0.25rem;
  }

  .settings-format-module + .settings-format-module {
    border-top: 1px solid var(--border-color);
    padding-top: 0.85rem;
  }

  .settings-format-heading {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    min-height: 20px;
  }

  .settings-subsection-title {
    margin: 0 0 0.1rem;
    color: var(--text-color);
    font-size: 0.8rem;
    font-weight: 600;
  }

  .settings-category-formats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .settings-format-chip {
    padding: 0.15rem 0.45rem;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--bg-window);
    color: var(--text-muted);
    font-size: 0.72rem;
  }

  .settings-category-note {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.8rem;
    line-height: 1.45;
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

  .status-item.status-error {
    color: #dc2626;
    font-weight: 600;
  }

  .status-item:first-child {
    border-left: none;
  }
</style>


