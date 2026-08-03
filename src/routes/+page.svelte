<script lang="ts">
  import { ask, message } from "@tauri-apps/plugin-dialog";
  import { invoke } from "@tauri-apps/api/core";
  import { PhysicalPosition } from "@tauri-apps/api/dpi";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { emit, emitTo, type Event as TauriEvent, type UnlistenFn } from "@tauri-apps/api/event";
  import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
  import { Braces, ChevronDown, Code2, Copy, Download, FileCode2, FileText, Minus, PaintRoller, PenLine, Settings, Square, Sun, Moon, Plus, Table2, Upload, X } from "@lucide/svelte";
  import {
    configurableDocumentFormatCategories,
    configurableDocumentFormats,
    createDefaultDocumentFeatureSettings,
    createDocumentRenderCache,
    getDocumentDiagnostic,
    getDocumentFormatForContent,
    getSuggestedFileExtensionForContent,
    isDocumentFormatEditEnabled,
    isDocumentFormatRenderEnabled,
    normalizeDocumentFeatureSettings,
    getOpenFileDialogFilters,
    parseDocumentForRender,
    getSaveFileDialogFilters
  } from "$lib/document-formats";
  import type { DocumentDiagnostic, DocumentFeatureSettings, DocumentFormatCategory, DocumentFormatCategoryId, DocumentFormatId } from "$lib/document-formats";
  import type { Token } from "$lib/render-tokenizer";
  import {
    formatListMarker,
    getListContinuationIndent,
    getListMarkerAtStart,
    getListMarkerBackspaceEdit,
    getListMarkerForIndentLevel,
    getNextListMarkerLabel,
    renumberFollowingListMarkerSequence,
    type ListMarker
  } from "$lib/list-markers";
  import { EditorUndoHistory, EditorUndoWindowBudget, type EditorSelection, type EditorSnapshot, type EditorUndoHistoryState } from "$lib/editor-undo";
  import {
    getTabDragPreviewPosition,
    getTabDropIndex,
    insertTabItem,
    isPointInsideTabDock,
    reorderTabItems,
    shouldReplaceDetachedWindowPlaceholder,
    tabDetachTargetClaimDelayMs,
    type TabDragMetadata
  } from "$lib/tab-drag";
  import {
    createDefaultMarkdownRenderSettings,
    markdownHeadingLevels,
    normalizeMarkdownRenderSettings,
    type MarkdownHeadingLevel,
    type MarkdownHeadingStyle,
    type MarkdownRenderSettings
  } from "$lib/markdown-settings";
  import { onDestroy, tick, untrack } from "svelte";
  import AboutDialog from "$lib/AboutDialog.svelte";
  import {
    getLanguageNativeName,
    isAppLocale,
    isRtlLocale,
    resolveSystemLocale,
    supportedLanguages,
    translate,
    type AppLocale,
    type LanguagePreference,
    type TranslationKey,
    type TranslationValues
  } from "$lib/i18n";
  import DelimitedTableEditor from "$lib/DelimitedTableEditor.svelte";
  import { APP_VERSION_FALLBACK } from "$lib/app-metadata";
  import {
    checkForAppUpdate,
    closeAppUpdate,
    getInstalledAppVersion,
    installAppUpdate,
    type DownloadEvent,
    type Update
  } from "$lib/app-updater";
  import {
    parseDelimitedTableWithinCellLimit,
    serializeDelimitedTable,
    type DelimitedTableDocument,
    type DelimitedTableSeparator
  } from "$lib/delimited-table";
  import {
    MAX_ENHANCED_RENDER_CHARS,
    MAX_ENHANCED_RENDER_LINES,
    MAX_INTERACTIVE_TABLE_CELLS
  } from "$lib/render-budgets";
  import {
    contentOffsetToTextareaOffset,
    createTextOffsetIndex,
    textareaOffsetToContentOffset,
    type TextOffsetIndex
  } from "$lib/text-offset-index";
  import { getPreferredNewline, getSnapshotFromTextareaInput } from "$lib/editor-input";
  import { BoundedLruCache, BoundedRecentSet } from "$lib/bounded-collections";
  import {
    canInsertAutoPairAt,
    createDefaultAutoPairAllowedFollowingStrings,
    maximumAutoPairAllowedFollowingStringCount,
    maximumAutoPairAllowedFollowingStringLength,
    normalizeAutoPairAllowedFollowingString,
    parseAutoPairAllowedFollowingStrings
  } from "$lib/auto-pair";
  import { getTextChange, type TextChange } from "$lib/text-change";
  import {
    createEditorLineLayoutCache,
    createFencedCodeBlockCache,
    getEditorLineLayout,
    getFencedCodeBlockRanges,
    type FencedCodeBlockRange,
    type RenderedLineHeightMeasurements,
    type RenderListLineLayout
  } from "$lib/editor-layout";
  import {
    createBrowserDocumentDiagnosticWorkerClient,
    DocumentDiagnosticCancelledError
  } from "$lib/document-diagnostic-client";
  import {
    parseSettingsFile,
    serializeSettingsFile,
    type AppSettingsSnapshot,
    type SettingsImportErrorReason
  } from "$lib/settings-transfer";
  import {
    createRenderedTextBoundaryIndex,
    findClosestRenderedTextOffset,
    getNativeCaretTextOffsetAtPoint,
    type RenderedTextBoundary
  } from "$lib/rendered-text-geometry";

  type TextEncoding = 'utf8' | 'utf8Bom' | 'utf16Le' | 'utf16Be';

  interface EditorTab {
    id: string;
    filePath: string | null;
    fileName: string;
    fileContent: string;
    encoding: TextEncoding;
    isDirty: boolean;
    scrollTop: number;
    scrollLeft: number;
    selectionStart: number;
    selectionEnd: number;
    cursorLine: number;
    cursorCol: number;
    caretOffset: number;
  }

  interface TabTransferPayload {
    transferId: string;
    sourceWindowLabel: string;
    tab: EditorTab;
    undoHistory: EditorUndoHistoryState;
  }

  interface TabTransferRequest extends TabDragMetadata {
    targetWindowLabel: string;
    dropIndex: number;
  }

  interface TabTransferDelivery extends TabTransferPayload {
    dropIndex: number;
  }

  interface TabTransferAccepted {
    transferId: string;
    targetWindowLabel: string;
  }

  interface TabDragPreviewPresentation {
    previewTitle: string;
    previewIsDirty: boolean;
    previewWidth: number;
    previewOffsetX: number;
    previewOffsetY: number;
  }

  interface OutgoingTabTransfer extends TabTransferPayload, TabDragPreviewPresentation {
    receiverRequested: boolean;
    handledInCurrentWindow: boolean;
    hasLeftDock: boolean;
    screenX: number;
    screenY: number;
    detachTimer: ReturnType<typeof setTimeout> | null;
    expiryTimer: ReturnType<typeof setTimeout> | null;
  }

  interface TabPointerDragPayload extends TabDragMetadata, TabDragPreviewPresentation {
    screenX: number;
    screenY: number;
  }

  interface PendingPointerTabDrag {
    pointerId: number;
    tabId: string;
    startClientX: number;
    startClientY: number;
    lastScreenX: number;
    lastScreenY: number;
    previewWidth: number;
    previewOffsetX: number;
    previewOffsetY: number;
    transferId: string | null;
  }

  interface TabDragPreview extends TabDragPreviewPresentation {
    transferId: string;
    left: number;
    top: number;
  }


  interface OpenedFile {
    path: string;
    content: string;
    encoding: TextEncoding;
  }

  interface SavedFile {
    path: string;
    encoding: TextEncoding;
  }

  let nextTabId = 1;
  let nextUntitledNumber = 1;
  const invalidFileNameCharsPattern = /[<>:"/\\|?*\x00-\x1F]/g;
  const isBrowser = typeof window !== 'undefined';
  const languagePreferenceKey = 'pref_language';
  const documentRenderCache = createDocumentRenderCache();
  const editorLineLayoutCache = createEditorLineLayoutCache();
  const fencedCodeBlockCache = createFencedCodeBlockCache();
  const documentDiagnosticWorkerClient = isBrowser && typeof Worker !== 'undefined'
    ? createBrowserDocumentDiagnosticWorkerClient()
    : null;
  let documentDiagnosticRequestId = 0;


  const tabTransferRequestEvent = 'text-pad-tab-transfer-request';
  const tabTransferDeliveryEvent = 'text-pad-tab-transfer-delivery';
  const tabTransferAcceptedEvent = 'text-pad-tab-transfer-accepted';
  const tabPointerDragMoveEvent = 'text-pad-tab-pointer-move';
  const tabPointerDragDropEvent = 'text-pad-tab-pointer-drop';
  const tabTransferIdQueryKey = 'tabTransferId';
  const tabTransferSourceQueryKey = 'tabTransferSource';
  function getInitialLanguagePreference(): LanguagePreference {
    if (!isBrowser) return 'system';
    const savedPreference = localStorage.getItem(languagePreferenceKey);
    return savedPreference === 'system' || isAppLocale(savedPreference) ? savedPreference : 'system';
  }

  let systemLocale = $state<AppLocale>(resolveSystemLocale(isBrowser ? navigator.languages : []));
  let languagePreference = $state<LanguagePreference>(getInitialLanguagePreference());
  let locale = $derived<AppLocale>(languagePreference === 'system' ? systemLocale : languagePreference);
  let untitledFileName = $derived(translate(locale, 'app.untitled'));

  function t(key: TranslationKey, values: TranslationValues = {}) {
    return translate(locale, key, values);
  }

  function hasTauriRuntime(): boolean {
    if (!isBrowser) return false;
    const runtimeWindow = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
    return '__TAURI_INTERNALS__' in runtimeWindow || '__TAURI__' in runtimeWindow;
  }

  function getStartupTabTransferMetadata(): TabDragMetadata | null {
    if (!isBrowser) return null;
    const searchParams = new URLSearchParams(window.location.search);
    const transferId = searchParams.get(tabTransferIdQueryKey);
    const sourceWindowLabel = searchParams.get(tabTransferSourceQueryKey);
    return transferId && sourceWindowLabel ? { transferId, sourceWindowLabel } : null;
  }

  function getCurrentEditorWindowLabel(): string {
    if (!hasTauriRuntime()) return 'browser';
    try {
      return getCurrentWindow().label;
    } catch {
      return 'browser';
    }
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

  function getCurrentWindowTitle(): string {
    if (isSettingsWindow) return t('settings.windowTitle');
    const displayName = getDisplayFileName({ filePath, fileName, fileContent });
    return `${isDirty ? '*' : ''}${t('app.windowTitle', { fileName: displayName })}`;
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

  function createEditorTab(options: Partial<Pick<EditorTab, 'filePath' | 'fileName' | 'fileContent' | 'encoding' | 'isDirty'>> = {}): EditorTab {
    const nextFileContent = options.fileContent ?? "";
    const nextFilePath = options.filePath ?? null;
    return {
      id: `tab-${nextTabId++}`,
      filePath: nextFilePath,
      fileName: options.fileName ?? (nextFilePath ? getFileNameFromPath(nextFilePath) : getNextUntitledFileName()),
      fileContent: nextFileContent,
      encoding: options.encoding ?? 'utf8',
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
  const undoWindowBudget = new EditorUndoWindowBudget(128 * 1024 * 1024);
  undoWindowBudget.touch(initialTab.id);
  let tabs = $state<EditorTab[]>([initialTab]);
  let activeTabId = $state<string>(initialTab.id);
  const minimumTabWidth = 128;
  const preferredTabWidth = 150;
  const tabItemGap = 2;
  let tabListEl = $state<HTMLDivElement | null>(null);
  let titlebarTabsEl = $state<HTMLDivElement | null>(null);
  let isTabStripOverflowing = $state(false);
  let isTabOverflowMenuOpen = $state(false);
  let hiddenTabIds = $state<string[]>([]);
  let tabScrollThumbWidth = $state(0);
  let tabScrollThumbLeft = $state(0);
  let hiddenTabs = $derived(tabs.filter((tab) => hiddenTabIds.includes(tab.id)));
  let tabListPreferredWidth = $derived(
    tabs.length * preferredTabWidth + Math.max(0, tabs.length - 1) * tabItemGap
  );

  let draggedTabId = $state<string | null>(null);
  let tabDropIndex = $state<number | null>(null);
  let tabDropIndicatorLeft = $state(0);
  let isTabDockDropTarget = $state(false);
  let pendingPointerTabDrag: PendingPointerTabDrag | null = null;
  let tabDragPreview = $state<TabDragPreview | null>(null);
  let suppressedTabClickId: string | null = null;
  let foreignTabDragTransferId: string | null = null;
  const outgoingTabTransfers = new Map<string, OutgoingTabTransfer>();
  const receivedTabTransferIds = new BoundedRecentSet<string>(256);
  const pendingIncomingTransferResolvers = new Map<string, (received: boolean) => void>();
  let tabTransferListenersPromise: Promise<UnlistenFn[]> | null = null;
  const startupTabTransferMetadata = getStartupTabTransferMetadata();
  let filePath = $state<string | null>(initialTab.filePath);
  let fileName = $state<string>(initialTab.fileName);
  let fileContent = $state<string>(initialTab.fileContent);
  let textOffsetIndex = $state.raw<TextOffsetIndex>(createTextOffsetIndex(initialTab.fileContent));
  let latestContentChange = $state.raw<TextChange | null>(null);
  let fileEncoding = $state<TextEncoding>(initialTab.encoding);
  let isDirty = $state<boolean>(initialTab.isDirty);
  let isLoading = $state<boolean>(false);
  let errorMsg = $state<string | null>(null);
  let isHandlingCloseRequest = false;
  let hasFocusedEditorOnStartup = false;
  let hasShownMainWindowOnStartup = false;
  let hasLoadedStartupFiles = false;
  let hasCheckedForUpdateOnStartup = false;
  let startupUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  let transientStatusTimer: ReturnType<typeof setTimeout> | null = null;
  let isWindowMaximized = $state<boolean>(false);
  let transientStatusMessage = $state<string | null>(null);
  let isCheckingForUpdate = $state<boolean>(false);
  let isInstallingUpdate = $state<boolean>(false);
  let availableAppUpdate = $state.raw<Update | null>(null);
  let isAboutDialogOpen = $state<boolean>(false);
  let installedAppVersion = $state<string>(APP_VERSION_FALLBACK);

  // 커서 상태 추적
  let cursorLine = $state<number>(1);
  let cursorCol = $state<number>(1);
  let caretOffset = $state<number>(0);
  let editorCaretColor = $state<string>('var(--color-render-text, var(--text-color))');
  let editorCursorStyle = $state<string>('text');
  let hasEditorSelection = $state<boolean>(false);
  let hasRenderedSelectionHighlight = $state<boolean>(false);
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
  let editorTextWidthCache = new BoundedLruCache<string, number>(12000);
  const renderedSelectionHighlightName = 'render-selection';
  const supportsRenderedSelectionHighlight = isBrowser
    && typeof Highlight === 'function'
    && typeof CSS !== 'undefined'
    && !!CSS.highlights;
  let renderedSelectionHighlightFrame: number | null = null;

  // 메뉴 및 설정 상태 추적
  let openDropdown = $state<'file' | 'edit' | 'help' | null>(null);
  type FormatSettingsView = `format:${DocumentFormatId}`;
  type FormatCategorySettingsView = `category:${DocumentFormatCategoryId}`;
  type SettingsView = 'general' | 'sourceAppearance' | 'renderAppearance' | 'renderEditing' | FormatCategorySettingsView | FormatSettingsView;
  type SettingsTransferStatus = { kind: 'success' | 'warning' | 'error'; message: string };
  let settingsTransferStatus = $state<SettingsTransferStatus | null>(null);
  let isSettingsTransferBusy = $state<boolean>(false);
  let activeSettingsView = $state<SettingsView>('general');
  let isSourceSettingsExpanded = $state<boolean>(true);
  let isRenderSettingsExpanded = $state<boolean>(true);
  let expandedFormatCategories = $state<Record<DocumentFormatCategoryId, boolean>>({
    document: true,
    structured: true,
    project: true,
    table: true,
    subtitle: true
  });
  let hasCenteredSettingsWindowThisSession = false;

  // 폰트 크기 이원화
  let sourceFontSize = $state<number>(11);
  let renderFontSize = $state<number>(11);

  // 렌더 모드 상태
  let isRenderMode = $state<boolean>(true); // 기본값은 렌더 모드
  let renderAutoPairEditing = $state<boolean>(true);
  let renderAutoPairAllowedFollowingStrings = $state<string[]>(createDefaultAutoPairAllowedFollowingStrings());
  let renderAutoPairAllowedFollowingStringDraft = $state<string>('');
  let normalizedRenderAutoPairAllowedFollowingStringDraft = $derived(
    normalizeAutoPairAllowedFollowingString(renderAutoPairAllowedFollowingStringDraft)
  );
  let canAddRenderAutoPairAllowedFollowingString = $derived(
    normalizedRenderAutoPairAllowedFollowingStringDraft !== null
    && !renderAutoPairAllowedFollowingStrings.includes(normalizedRenderAutoPairAllowedFollowingStringDraft)
    && renderAutoPairAllowedFollowingStrings.length < maximumAutoPairAllowedFollowingStringCount
  );
  let renderAutoSymbolSubstitution = $state<boolean>(true);
  let renderPreserveIndentOnEnter = $state<boolean>(true);
  let delimitedTableHighlightHeader = $state<boolean>(true);
  let delimitedTableShowRowIndices = $state<boolean>(true);
  let delimitedTableAnimateReorder = $state<boolean>(true);
  let delimitedTableReorderDurationMs = $state<number>(150);
  let documentFeatureSettings = $state<DocumentFeatureSettings>(createDefaultDocumentFeatureSettings());
  let markdownRenderSettings = $state<MarkdownRenderSettings>(createDefaultMarkdownRenderSettings());
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
  let renderedLineHeightMeasurements = $state<RenderedLineHeightMeasurements>({
    content: '',
    context: '',
    heights: {}
  });
  let renderedLineResizeObserver: ResizeObserver | null = null;

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
  const previousLightCodeBgDefault = '#f1f5f9';
  const previousDarkCodeTextDefaults = new Set(['#38bdf8', '#4fc1ff']);

  // 시스템 테마별 기본 강조 색상
  function getSystemDefaultColors(isDark: boolean): ThemeColors {
    return isDark ? {
      renderBg: '#0a0a0b',
      renderText: '#d6eaf0',
      renderFontWeight: '400',
      codeBg: '#1e293b',
      codeText: '#94a3b8',
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
      codeBg: '#e2e8f0',
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
  const markdownRenderPreferenceKey = 'pref_markdown_render_settings';
  function getCloseSaveButtons() {
    return {
      yes: t('dialog.saveChanges.save'),
      no: t('dialog.saveChanges.dontSave'),
      cancel: t('dialog.saveChanges.cancel')
    };
  }

  const fileErrorTranslationKeys: Partial<Record<string, TranslationKey>> = {
    file_too_large: 'error.fileTooLarge',
    too_many_lines: 'error.tooManyLines',
    path_not_approved: 'error.pathNotApproved',
    invalid_data: 'error.invalidData',
    invalid_path: 'error.invalidPath',
    state_error: 'error.fileState'
  };

  function getErrorPayload(error: unknown): { code?: unknown; message?: unknown } | null {
    if (error && typeof error === 'object') return error as { code?: unknown; message?: unknown };
    if (typeof error !== 'string') return null;
    try {
      const parsed = JSON.parse(error);
      return parsed && typeof parsed === 'object'
        ? parsed as { code?: unknown; message?: unknown }
        : null;
    } catch {
      return null;
    }
  }

  function getErrorDetail(error: unknown): string {
    const payload = getErrorPayload(error);
    if (typeof payload?.code === 'string') {
      const translationKey = fileErrorTranslationKeys[payload.code];
      if (translationKey) return t(translationKey);
    }
    if (typeof payload?.message === 'string') return payload.message;
    return typeof error === 'string' ? error : String(error);
  }

  function localizeError(key: TranslationKey, error: unknown): string {
    return t(key, { detail: getErrorDetail(error) });
  }
  const renderAutoClosingPairs: Record<string, string> = {
    '(': ')',
    '[': ']',
    '{': '}',
    '"': '"',
    "'": "'",
    '`': '`'
  };
  const renderAutoPairAllowedFollowingStringsPreferenceKey = 'pref_render_auto_pair_allowed_following_strings';
  const renderAutoClosingCharacters = new Set(Object.values(renderAutoClosingPairs));

  function addRenderAutoPairAllowedFollowingString() {
    const value = normalizedRenderAutoPairAllowedFollowingStringDraft;
    if (
      !value
      || renderAutoPairAllowedFollowingStrings.includes(value)
      || renderAutoPairAllowedFollowingStrings.length >= maximumAutoPairAllowedFollowingStringCount
    ) {
      return;
    }

    renderAutoPairAllowedFollowingStrings = [...renderAutoPairAllowedFollowingStrings, value];
    renderAutoPairAllowedFollowingStringDraft = '';
  }

  function removeRenderAutoPairAllowedFollowingString(value: string) {
    renderAutoPairAllowedFollowingStrings = renderAutoPairAllowedFollowingStrings.filter(
      (candidate) => candidate !== value
    );
  }

  function handleRenderAutoPairAllowedFollowingStringKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    if (canAddRenderAutoPairAllowedFollowingString) {
      addRenderAutoPairAllowedFollowingString();
    }
  }

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
  const fencedCodeHorizontalPadding = 12;
  const editorTopPadding = 8;
  const virtualLineOverscan = 8;
  const editorResizeDebounceMs = 80;
  const delimitedTableReorderDurationMinMs = 50;
  const delimitedTableReorderDurationMaxMs = 2000;
  const delimitedTableReorderDurationStepMs = 50;
  const editorMovementKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
  let pendingRenderCaretMovementDirection: -1 | 0 | 1 = 0;

  function parseDocumentFeatureSettingsValue(value: string | null): DocumentFeatureSettings {
    if (!value) return createDefaultDocumentFeatureSettings();

    try {
      return normalizeDocumentFeatureSettings(JSON.parse(value));
    } catch {
      return createDefaultDocumentFeatureSettings();
    }
  }

  function parseMarkdownRenderSettingsValue(value: string | null): MarkdownRenderSettings {
    if (!value) return createDefaultMarkdownRenderSettings();
    try {
      return normalizeMarkdownRenderSettings(JSON.parse(value));
    } catch {
      return createDefaultMarkdownRenderSettings();
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

  function setMarkdownHeadingStyle(
    level: MarkdownHeadingLevel,
    field: keyof MarkdownHeadingStyle,
    value: number | MarkdownHeadingStyle['fontWeight']
  ) {
    markdownRenderSettings = {
      ...markdownRenderSettings,
      headings: {
        ...markdownRenderSettings.headings,
        [level]: {
          ...markdownRenderSettings.headings[level],
          [field]: value
        }
      }
    };
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
    undoWindowBudget.touch(tab.id);
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
    undoWindowBudget.touch(activeTabId);
    return history;
  }

  function enforceUndoWindowBudget() {
    undoWindowBudget.enforce(undoHistories, activeTabId);
  }

  function resetUndoHistoryForTab(tab: EditorTab) {
    const history = new EditorUndoHistory(getTabSnapshot(tab));
    undoHistories.set(tab.id, history);
    undoWindowBudget.touch(tab.id);
    enforceUndoWindowBudget();
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
    return t('common.seconds', {
      seconds: (durationMs / 1000).toFixed(durationMs % 1000 === 0 ? 0 : 2)
    });
  }

  function getTextOffsetIndex(content: string): TextOffsetIndex {
    return textOffsetIndex.content === content ? textOffsetIndex : createTextOffsetIndex(content);
  }

  function getTextareaSelectionInContent(content = fileContent): EditorSelection {
    if (!textareaEl) return { start: caretOffset, end: caretOffset };

    return {
      start: textareaOffsetToContentOffset(getTextOffsetIndex(content), textareaEl.selectionStart),
      end: textareaOffsetToContentOffset(getTextOffsetIndex(content), textareaEl.selectionEnd)
    };
  }

  function setTextareaSelectionFromContent(start: number, end: number, content = fileContent) {
    if (!textareaEl) return;

    const index = getTextOffsetIndex(content);
    textareaEl.selectionStart = contentOffsetToTextareaOffset(index, start);
    textareaEl.selectionEnd = contentOffsetToTextareaOffset(index, end);
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
      encoding: fileEncoding,
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
    latestContentChange = null;
    textOffsetIndex = createTextOffsetIndex(tab.fileContent);
    fileContent = tab.fileContent;
    enforceUndoWindowBudget();
    fileEncoding = tab.encoding;
    isDirty = history.isDirty();
    errorMsg = null;
    restoreEditorView(tab);
  }

  function updateTabStripMetrics() {
    const tabList = tabListEl;
    if (!tabList || tabList.clientWidth <= 0) return;

    const viewportWidth = tabList.clientWidth;
    const contentWidth = tabList.scrollWidth;
    const maxScrollLeft = Math.max(0, contentWidth - viewportWidth);
    const nextIsOverflowing = maxScrollLeft > 1;

    isTabStripOverflowing = nextIsOverflowing;
    if (!nextIsOverflowing) {
      isTabOverflowMenuOpen = false;
      hiddenTabIds = [];
      tabScrollThumbWidth = viewportWidth;
      tabScrollThumbLeft = 0;
      return;
    }

    const nextThumbWidth = Math.max(32, viewportWidth * (viewportWidth / contentWidth));
    const scrollProgress = Math.min(1, Math.max(0, tabList.scrollLeft / maxScrollLeft));
    tabScrollThumbWidth = nextThumbWidth;
    tabScrollThumbLeft = scrollProgress * (viewportWidth - nextThumbWidth);

    const visibleLeft = tabList.scrollLeft;
    const visibleRight = visibleLeft + viewportWidth;
    const nextHiddenTabIds = Array.from(tabList.querySelectorAll<HTMLElement>('[data-tab-id]'))
      .filter((tabItem) => (
        tabItem.offsetLeft < visibleLeft - 0.5
        || tabItem.offsetLeft + tabItem.offsetWidth > visibleRight + 0.5
      ))
      .map((tabItem) => tabItem.dataset.tabId)
      .filter((tabId): tabId is string => !!tabId);

    if (
      nextHiddenTabIds.length !== hiddenTabIds.length
      || nextHiddenTabIds.some((tabId, index) => tabId !== hiddenTabIds[index])
    ) {
      hiddenTabIds = nextHiddenTabIds;
    }
  }

  function scrollTabIntoView(tabId: string) {
    const tabList = tabListEl;
    if (!tabList) return;

    const tabItem = Array.from(tabList.querySelectorAll<HTMLElement>('[data-tab-id]'))
      .find((item) => item.dataset.tabId === tabId);
    if (!tabItem) return;

    const tabLeft = tabItem.offsetLeft;
    const tabRight = tabLeft + tabItem.offsetWidth;
    if (tabLeft < tabList.scrollLeft) {
      tabList.scrollLeft = tabLeft;
    } else if (tabRight > tabList.scrollLeft + tabList.clientWidth) {
      tabList.scrollLeft = tabRight - tabList.clientWidth;
    }
    updateTabStripMetrics();
  }

  function handleTabListWheel(event: WheelEvent) {
    if (!isTabStripOverflowing || !tabListEl) return;

    const rawDelta = event.deltaX !== 0
      ? event.deltaX
      : (event.shiftKey ? event.deltaY : 0);
    if (rawDelta === 0) return;

    event.preventDefault();
    const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : (event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? tabListEl.clientWidth : 1);
    tabListEl.scrollLeft += rawDelta * deltaScale;
    updateTabStripMetrics();
  }

  function toggleTabOverflowMenu(event: MouseEvent) {
    event.stopPropagation();
    openDropdown = null;
    isTabOverflowMenuOpen = !isTabOverflowMenuOpen;
  }

  function selectTabFromOverflowMenu(tabId: string) {
    isTabOverflowMenuOpen = false;
    if (tabId !== activeTabId) activateTab(tabId);
    requestAnimationFrame(() => scrollTabIntoView(tabId));
  }

  function createTabTransferId(): string {
    const randomPart = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    return `tab-transfer-${Date.now().toString(36)}-${randomPart}`;
  }


  function getActiveOutgoingTabTransfer(): OutgoingTabTransfer | null {
    if (!draggedTabId) return null;
    return Array.from(outgoingTabTransfers.values())
      .find((transfer) => transfer.tab.id === draggedTabId) ?? null;
  }

  function clearTabDropTarget() {
    tabDropIndex = null;
    tabDropIndicatorLeft = 0;
    isTabDockDropTarget = false;
  }

  function updateTabDropTarget(pointerX: number) {
    const tabList = tabListEl;
    if (!tabList) return;

    const listRect = tabList.getBoundingClientRect();
    if (isTabStripOverflowing) {
      if (pointerX < listRect.left + 28) {
        tabList.scrollLeft -= 16;
      } else if (pointerX > listRect.right - 28) {
        tabList.scrollLeft += 16;
      }
      updateTabStripMetrics();
    }

    const tabItems = Array.from(tabList.querySelectorAll<HTMLElement>('[data-tab-id]'));
    const tabRects = tabItems.map((item) => {
      const rect = item.getBoundingClientRect();
      return { left: rect.left, width: rect.width };
    });
    const nextDropIndex = getTabDropIndex(pointerX, tabRects);
    const indicatorClientX = nextDropIndex < tabItems.length
      ? tabItems[nextDropIndex].getBoundingClientRect().left
      : (tabItems.at(-1)?.getBoundingClientRect().right ?? listRect.left);

    tabDropIndex = nextDropIndex;
    tabDropIndicatorLeft = Math.max(
      0,
      Math.min(indicatorClientX - listRect.left, tabList.clientWidth)
    );
    isTabDockDropTarget = true;
  }

  function scheduleOutgoingTransferExpiry(transfer: OutgoingTabTransfer) {
    if (transfer.expiryTimer) clearTimeout(transfer.expiryTimer);
    transfer.expiryTimer = setTimeout(() => {
      if (transfer.detachTimer) clearTimeout(transfer.detachTimer);
      outgoingTabTransfers.delete(transfer.transferId);
      if (tabDragPreview?.transferId === transfer.transferId) tabDragPreview = null;
    }, 30_000);
  }

  function createOutgoingTabTransfer(
    tabId: string,
    screenX: number,
    screenY: number,
    previewWidth: number,
    previewOffsetX: number,
    previewOffsetY: number
  ): OutgoingTabTransfer | null {
    syncActiveTabState();
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) return null;

    const transferId = createTabTransferId();
    const sourceWindowLabel = getCurrentEditorWindowLabel();
    const transfer: OutgoingTabTransfer = {
      transferId,
      sourceWindowLabel,
      tab: { ...tab },
      undoHistory: getUndoHistoryForTab(tab).exportState(),
      receiverRequested: false,
      handledInCurrentWindow: false,
      hasLeftDock: false,
      screenX,
      screenY,
      previewTitle: getDisplayFileName(tab),
      previewIsDirty: tab.isDirty,
      previewWidth,
      previewOffsetX,
      previewOffsetY,
      detachTimer: null,
      expiryTimer: null
    };
    outgoingTabTransfers.set(transferId, transfer);
    scheduleOutgoingTransferExpiry(transfer);
    draggedTabId = tabId;
    closeAllDropdown();
    return transfer;
  }

  function getTabDockPointFromClient(clientX: number, clientY: number) {
    const dock = titlebarTabsEl;
    if (!dock) return null;
    const rect = dock.getBoundingClientRect();
    if (!isPointInsideTabDock(clientX, clientY, rect)) return null;
    return { clientX, clientY };
  }

  function getTabDockPointFromScreen(screenX: number, screenY: number) {
    return getTabDockPointFromClient(
      screenX - window.screenX,
      screenY - window.screenY
    );
  }

  function getTabPointerPayload(transfer: OutgoingTabTransfer): TabPointerDragPayload {
    return {
      transferId: transfer.transferId,
      sourceWindowLabel: transfer.sourceWindowLabel,
      screenX: transfer.screenX,
      screenY: transfer.screenY,
      previewTitle: transfer.previewTitle,
      previewIsDirty: transfer.previewIsDirty,
      previewWidth: transfer.previewWidth,
      previewOffsetX: transfer.previewOffsetX,
      previewOffsetY: transfer.previewOffsetY
    };
  }
  function updateTabDragPreview(
    transferId: string,
    presentation: TabDragPreviewPresentation,
    pointerX: number,
    pointerY: number
  ) {
    const position = getTabDragPreviewPosition(
      pointerX,
      pointerY,
      presentation.previewOffsetX,
      presentation.previewOffsetY,
      window.innerWidth,
      window.innerHeight
    );
    tabDragPreview = position.visible
      ? { transferId, ...presentation, left: position.left, top: position.top }
      : null;
  }


  function broadcastTabPointerEvent(
    eventName: typeof tabPointerDragMoveEvent | typeof tabPointerDragDropEvent,
    transfer: OutgoingTabTransfer
  ) {
    if (!hasTauriRuntime()) return;
    void emit(eventName, getTabPointerPayload(transfer)).catch((error) => {
      console.error('Failed to broadcast tab pointer event:', error);
    });
  }

  function handleTabPointerDown(event: PointerEvent, tabId: string) {
    if (event.button !== 0 || !event.isPrimary) return;

    const pointerTarget = event.currentTarget as HTMLElement;
    const tabItem = pointerTarget.closest<HTMLElement>('[data-tab-id]') ?? pointerTarget;
    const tabRect = tabItem.getBoundingClientRect();

    pendingPointerTabDrag = {
      pointerId: event.pointerId,
      tabId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastScreenX: event.screenX,
      lastScreenY: event.screenY,
      previewWidth: tabRect.width,
      previewOffsetX: Math.max(0, Math.min(event.clientX - tabRect.left, tabRect.width)),
      previewOffsetY: Math.max(0, Math.min(event.clientY - tabRect.top, tabRect.height)),
      transferId: null
    };
    pointerTarget.setPointerCapture(event.pointerId);
  }

  function handleTabPointerMove(event: PointerEvent) {
    const pointerDrag = pendingPointerTabDrag;
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;

    pointerDrag.lastScreenX = event.screenX;
    pointerDrag.lastScreenY = event.screenY;
    if (!pointerDrag.transferId) {
      const distance = Math.hypot(
        event.clientX - pointerDrag.startClientX,
        event.clientY - pointerDrag.startClientY
      );
      if (distance < 5) return;

      const transfer = createOutgoingTabTransfer(
        pointerDrag.tabId,
        event.screenX,
        event.screenY,
        pointerDrag.previewWidth,
        pointerDrag.previewOffsetX,
        pointerDrag.previewOffsetY
      );
      if (!transfer) return;
      pointerDrag.transferId = transfer.transferId;
    }

    event.preventDefault();
    const transfer = outgoingTabTransfers.get(pointerDrag.transferId);
    if (!transfer) return;
    transfer.screenX = event.screenX;
    transfer.screenY = event.screenY;

    updateTabDragPreview(transfer.transferId, transfer, event.clientX, event.clientY);
    const dockPoint = getTabDockPointFromClient(event.clientX, event.clientY);
    if (dockPoint) {
      updateTabDropTarget(dockPoint.clientX);
    } else {
      transfer.hasLeftDock = true;
      clearTabDropTarget();
    }
    broadcastTabPointerEvent(tabPointerDragMoveEvent, transfer);
  }

  function reorderTabWithinCurrentWindow(tabId: string, dropIndex: number) {
    syncActiveTabState();
    const sourceIndex = tabs.findIndex((tab) => tab.id === tabId);
    if (sourceIndex === -1) return;

    const nextTabs = reorderTabItems(tabs, sourceIndex, dropIndex);
    if (nextTabs.every((tab, index) => tab.id === tabs[index]?.id)) return;
    tabs = nextTabs;
    requestAnimationFrame(() => scrollTabIntoView(tabId));
  }

  function insertTransferredTab(delivery: TabTransferDelivery): boolean {
    if (receivedTabTransferIds.has(delivery.transferId)) return true;

    syncActiveTabState();
    const hasSingleCleanUntitledTab = tabs.length === 1 && isCleanUntitledTab(tabs[0]);
    const shouldReplaceBlank = shouldReplaceDetachedWindowPlaceholder(
      startupTabTransferMetadata?.transferId ?? null,
      delivery.transferId,
      hasSingleCleanUntitledTab
    );
    const receivedTab: EditorTab = {
      ...delivery.tab,
      id: shouldReplaceBlank ? tabs[0].id : `tab-${nextTabId++}`
    };
    const receivedHistory = EditorUndoHistory.fromState(
      getTabSnapshot(receivedTab),
      delivery.undoHistory
    );
    receivedTab.isDirty = receivedHistory.isDirty();

    if (shouldReplaceBlank) {
      undoWindowBudget.remove(tabs[0].id);
      undoHistories.delete(tabs[0].id);
      tabs = [receivedTab];
    } else {
      tabs = insertTabItem(tabs, receivedTab, delivery.dropIndex);
    }

    undoHistories.set(receivedTab.id, receivedHistory);
    undoWindowBudget.touch(receivedTab.id);
    closeAllDropdown();
    loadTabIntoEditor(receivedTab);
    receivedTabTransferIds.add(delivery.transferId);
    requestAnimationFrame(() => scrollTabIntoView(receivedTab.id));
    return true;
  }

  function requestIncomingTabTransfer(
    metadata: TabDragMetadata,
    dropIndex: number
  ): Promise<boolean> {
    if (!hasTauriRuntime()) return Promise.resolve(false);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pendingIncomingTransferResolvers.delete(metadata.transferId);
        resolve(false);
      }, 3_000);
      pendingIncomingTransferResolvers.set(metadata.transferId, (received) => {
        clearTimeout(timeout);
        pendingIncomingTransferResolvers.delete(metadata.transferId);
        resolve(received);
      });

      void emitTo(metadata.sourceWindowLabel, tabTransferRequestEvent, {
        ...metadata,
        targetWindowLabel: getCurrentEditorWindowLabel(),
        dropIndex
      } satisfies TabTransferRequest).catch((error) => {
        console.error('Failed to request tab transfer:', error);
        const resolver = pendingIncomingTransferResolvers.get(metadata.transferId);
        resolver?.(false);
      });
    });
  }

  async function handleTabTransferRequest(event: TauriEvent<TabTransferRequest>) {
    const request = event.payload;
    const transfer = outgoingTabTransfers.get(request.transferId);
    if (!transfer || transfer.sourceWindowLabel !== request.sourceWindowLabel) return;

    transfer.receiverRequested = true;
    if (transfer.detachTimer) {
      clearTimeout(transfer.detachTimer);
      transfer.detachTimer = null;
    }

    const currentTab = tabs.find((tab) => tab.id === transfer.tab.id);
    if (!currentTab) return;

    try {
      await emitTo(request.targetWindowLabel, tabTransferDeliveryEvent, {
        transferId: transfer.transferId,
        sourceWindowLabel: transfer.sourceWindowLabel,
        tab: transfer.tab,
        undoHistory: transfer.undoHistory,
        dropIndex: request.dropIndex
      } satisfies TabTransferDelivery);
    } catch (error) {
      console.error('Failed to deliver tab transfer:', error);
    }
  }

  async function handleTabTransferDelivery(event: TauriEvent<TabTransferDelivery>) {
    const delivery = event.payload;
    try {
      if (!insertTransferredTab(delivery)) return;
      await emitTo(delivery.sourceWindowLabel, tabTransferAcceptedEvent, {
        transferId: delivery.transferId,
        targetWindowLabel: getCurrentEditorWindowLabel()
      } satisfies TabTransferAccepted);
      pendingIncomingTransferResolvers.get(delivery.transferId)?.(true);
    } catch (error) {
      console.error('Failed to receive tab transfer:', error);
      pendingIncomingTransferResolvers.get(delivery.transferId)?.(false);
    }
  }

  async function removeTransferredTabFromSource(tabId: string) {
    if (!tabs.some((tab) => tab.id === tabId)) return;

    if (tabs.length === 1 && hasTauriRuntime()) {
      try {
        await getCurrentWindow().destroy();
      } catch (error) {
        console.error('Failed to close empty tab window:', error);
      }
      return;
    }

    closeTabWithoutPrompt(tabId);
  }

  async function handleTabTransferAccepted(event: TauriEvent<TabTransferAccepted>) {
    const accepted = event.payload;
    const transfer = outgoingTabTransfers.get(accepted.transferId);
    if (!transfer) return;

    transfer.handledInCurrentWindow = true;
    if (transfer.detachTimer) clearTimeout(transfer.detachTimer);
    if (transfer.expiryTimer) clearTimeout(transfer.expiryTimer);
    outgoingTabTransfers.delete(transfer.transferId);
    await removeTransferredTabFromSource(transfer.tab.id);
  }

  async function createDetachedTabWindow(transfer: OutgoingTabTransfer) {
    if (
      !hasTauriRuntime()
      || transfer.receiverRequested
      || transfer.handledInCurrentWindow
      || !outgoingTabTransfers.has(transfer.transferId)
    ) {
      return;
    }

    const label = `editor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const searchParams = new URLSearchParams({
      [tabTransferIdQueryKey]: transfer.transferId,
      [tabTransferSourceQueryKey]: transfer.sourceWindowLabel
    });
    const hasScreenPosition = transfer.screenX !== 0 || transfer.screenY !== 0;
    const detachedWindow = new WebviewWindow(label, {
      url: `${window.location.origin}/?${searchParams.toString()}`,
      title: getDisplayFileName(transfer.tab),
      width: 800,
      height: 600,
      ...(hasScreenPosition
        ? { x: Math.round(transfer.screenX - 120), y: Math.round(transfer.screenY - 16) }
        : {}),
      visible: false,
      decorations: false,
      shadow: true
    });

    void detachedWindow.once('tauri://error', (creationEvent) => {
      console.error('Failed to create detached tab window:', creationEvent.payload);
    });
  }

  function cleanupOutgoingTabTransfer(transfer: OutgoingTabTransfer) {
    if (transfer.detachTimer) clearTimeout(transfer.detachTimer);
    if (transfer.expiryTimer) clearTimeout(transfer.expiryTimer);
    outgoingTabTransfers.delete(transfer.transferId);
    if (tabDragPreview?.transferId === transfer.transferId) tabDragPreview = null;
  }

  function suppressDraggedTabClick(tabId: string) {
    suppressedTabClickId = tabId;
    setTimeout(() => {
      if (suppressedTabClickId === tabId) suppressedTabClickId = null;
    }, 0);
  }

  function finishTabPointerDrag(event: PointerEvent, cancelled: boolean) {
    const pointerDrag = pendingPointerTabDrag;
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    pendingPointerTabDrag = null;

    const pointerTarget = event.currentTarget as HTMLElement;
    if (pointerTarget.hasPointerCapture(event.pointerId)) {
      pointerTarget.releasePointerCapture(event.pointerId);
    }
    if (!pointerDrag.transferId) return;

    event.preventDefault();
    suppressDraggedTabClick(pointerDrag.tabId);
    const transfer = outgoingTabTransfers.get(pointerDrag.transferId);
    draggedTabId = null;
    tabDragPreview = null;
    if (!transfer) {
      clearTabDropTarget();
      return;
    }

    transfer.screenX = event.screenX || pointerDrag.lastScreenX;
    transfer.screenY = event.screenY || pointerDrag.lastScreenY;
    if (cancelled) {
      transfer.handledInCurrentWindow = true;
      cleanupOutgoingTabTransfer(transfer);
      clearTabDropTarget();
      return;
    }

    const dockPoint = getTabDockPointFromClient(event.clientX, event.clientY);
    if (dockPoint) {
      updateTabDropTarget(dockPoint.clientX);
      const nextDropIndex = tabDropIndex ?? tabs.length;
      transfer.handledInCurrentWindow = true;
      reorderTabWithinCurrentWindow(transfer.tab.id, nextDropIndex);
      cleanupOutgoingTabTransfer(transfer);
      clearTabDropTarget();
      return;
    }

    transfer.hasLeftDock = true;
    clearTabDropTarget();
    if (!hasTauriRuntime()) {
      cleanupOutgoingTabTransfer(transfer);
      return;
    }

    broadcastTabPointerEvent(tabPointerDragDropEvent, transfer);
    transfer.detachTimer = setTimeout(() => {
      transfer.detachTimer = null;
      void createDetachedTabWindow(transfer);
    }, tabDetachTargetClaimDelayMs);
  }

  function handleTabPointerUp(event: PointerEvent) {
    finishTabPointerDrag(event, false);
  }

  function handleTabPointerCancel(event: PointerEvent) {
    finishTabPointerDrag(event, true);
  }

  function handleForeignTabPointerMove(event: TauriEvent<TabPointerDragPayload>) {
    const pointer = event.payload;
    if (pointer.sourceWindowLabel === getCurrentEditorWindowLabel()) return;
    foreignTabDragTransferId = pointer.transferId;
    updateTabDragPreview(
      pointer.transferId,
      pointer,
      pointer.screenX - window.screenX,
      pointer.screenY - window.screenY
    );
    const dockPoint = getTabDockPointFromScreen(pointer.screenX, pointer.screenY);
    if (dockPoint) {
      updateTabDropTarget(dockPoint.clientX);
    } else {
      clearTabDropTarget();
    }
  }

  function handleForeignTabPointerDrop(event: TauriEvent<TabPointerDragPayload>) {
    const pointer = event.payload;
    if (pointer.sourceWindowLabel === getCurrentEditorWindowLabel()) return;
    if (foreignTabDragTransferId === pointer.transferId) {
      foreignTabDragTransferId = null;
    }

    if (tabDragPreview?.transferId === pointer.transferId) tabDragPreview = null;
    const dockPoint = getTabDockPointFromScreen(pointer.screenX, pointer.screenY);
    if (!dockPoint) {
      clearTabDropTarget();
      return;
    }

    updateTabDropTarget(dockPoint.clientX);
    const nextDropIndex = tabDropIndex ?? tabs.length;
    clearTabDropTarget();
    void requestIncomingTabTransfer(pointer, nextDropIndex);
  }

  function handleTabClick(tabId: string) {
    if (suppressedTabClickId === tabId) {
      suppressedTabClickId = null;
      return;
    }
    activateTab(tabId);
  }

  function ensureTabTransferListeners(): Promise<UnlistenFn[]> {
    if (tabTransferListenersPromise) return tabTransferListenersPromise;
    const eventWindow = getCurrentWindow();
    tabTransferListenersPromise = Promise.all([
      eventWindow.listen<TabTransferRequest>(tabTransferRequestEvent, handleTabTransferRequest),
      eventWindow.listen<TabTransferDelivery>(tabTransferDeliveryEvent, handleTabTransferDelivery),
      eventWindow.listen<TabTransferAccepted>(tabTransferAcceptedEvent, handleTabTransferAccepted),
      eventWindow.listen<TabPointerDragPayload>(tabPointerDragMoveEvent, handleForeignTabPointerMove),
      eventWindow.listen<TabPointerDragPayload>(tabPointerDragDropEvent, handleForeignTabPointerDrop)
    ]);
    return tabTransferListenersPromise;
  }

  $effect(() => {
    if (!isBrowser || !hasTauriRuntime() || isSettingsWindow) return;

    let disposed = false;
    const listeners = ensureTabTransferListeners();
    return () => {
      disposed = true;
      void listeners.then((unlisteners) => {
        if (!disposed) return;
        unlisteners.forEach((unlisten) => unlisten());
      });
      for (const transfer of outgoingTabTransfers.values()) {
        if (transfer.detachTimer) clearTimeout(transfer.detachTimer);
        if (transfer.expiryTimer) clearTimeout(transfer.expiryTimer);
      }
      outgoingTabTransfers.clear();
      receivedTabTransferIds.clear();
      for (const resolve of pendingIncomingTransferResolvers.values()) {
        resolve(false);
      }
      pendingIncomingTransferResolvers.clear();
    };
  });
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
      undoWindowBudget.remove(tabId);
      undoHistories.delete(tabId);
      const blankTab = createEditorTab();
      resetUndoHistoryForTab(blankTab);
      tabs = [blankTab];
      loadTabIntoEditor(blankTab);
      return;
    }

    const nextTabs = tabs.filter((tab) => tab.id !== tabId);
    undoWindowBudget.remove(tabId);
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

  $effect(() => {
    if (!isBrowser || !tabListEl) return;

    const tabList = tabListEl;
    const resizeObserver = new ResizeObserver(updateTabStripMetrics);
    resizeObserver.observe(tabList);
    const frame = requestAnimationFrame(updateTabStripMetrics);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  });

  $effect(() => {
    if (!isBrowser) return;
    void tabs.length;
    const nextActiveTabId = activeTabId;
    const frame = requestAnimationFrame(() => {
      scrollTabIntoView(nextActiveTabId);
      updateTabStripMetrics();
    });
    return () => cancelAnimationFrame(frame);
  });

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

  $effect(() => {
    if (!isBrowser) return;
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtlLocale(locale) ? 'rtl' : 'ltr';
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

    const savedLanguagePreference = localStorage.getItem(languagePreferenceKey);
    if (savedLanguagePreference === 'system' || isAppLocale(savedLanguagePreference)) {
      languagePreference = savedLanguagePreference;
    }
    systemLocale = resolveSystemLocale(navigator.languages);

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
    renderAutoPairAllowedFollowingStrings = parseAutoPairAllowedFollowingStrings(
      localStorage.getItem(renderAutoPairAllowedFollowingStringsPreferenceKey)
    );
    renderAutoSymbolSubstitution = localStorage.getItem('pref_render_auto_symbol_substitution') !== 'false';
    renderPreserveIndentOnEnter = localStorage.getItem('pref_render_preserve_indent_on_enter') !== 'false';
    delimitedTableHighlightHeader = localStorage.getItem('pref_delimited_table_highlight_header') !== 'false';
    delimitedTableShowRowIndices = localStorage.getItem('pref_delimited_table_show_row_indices') !== 'false';
    delimitedTableAnimateReorder = localStorage.getItem('pref_delimited_table_animate_reorder') !== 'false';
    delimitedTableReorderDurationMs = normalizeDelimitedTableReorderDuration(
      localStorage.getItem('pref_delimited_table_reorder_duration_ms')
    );
    documentFeatureSettings = parseDocumentFeatureSettingsValue(localStorage.getItem(documentFeaturePreferenceKey));
    markdownRenderSettings = parseMarkdownRenderSettingsValue(localStorage.getItem(markdownRenderPreferenceKey));

    renderFontFamily = localStorage.getItem('pref_render_font_family') || 'nanum-gothic';

    const loadColors = (isDark: boolean): ThemeColors => {
      const prefix = isDark ? 'pref_dark_' : 'pref_light_';
      const defaults = getSystemDefaultColors(isDark);

      // Migration from old keys (if new key doesn't exist but old key does, use old key once, or just fallback to default)
      const savedCodeBg = localStorage.getItem(`${prefix}codeBg`)
        || (isDark && systemIsDark ? localStorage.getItem('pref_color_hl_code_bg') : null);
      const codeBg = !isDark && savedCodeBg?.toLowerCase() === previousLightCodeBgDefault
        ? defaults.codeBg
        : savedCodeBg || defaults.codeBg;
      const savedCodeText = localStorage.getItem(`${prefix}codeText`)
        || (isDark && systemIsDark ? localStorage.getItem('pref_color_hl_code_text') : null);
      const codeText = isDark && savedCodeText && previousDarkCodeTextDefaults.has(savedCodeText.toLowerCase())
        ? defaults.codeText
        : savedCodeText || defaults.codeText;

      return {
        codeBg,
        codeText,
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
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem(languagePreferenceKey, languagePreference); });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem('pref_theme_mode', themeMode); });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem('pref_source_font_size', sourceFontSize.toString()); });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem('pref_render_font_size', renderFontSize.toString()); });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem('pref_tab_size', tabSize.toString()); });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem('pref_render_auto_pair_editing', renderAutoPairEditing ? 'true' : 'false'); });
  $effect(() => {
    if (isBrowser && canPersistPreferences) {
      localStorage.setItem(renderAutoPairAllowedFollowingStringsPreferenceKey, JSON.stringify(renderAutoPairAllowedFollowingStrings));
    }
  });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem('pref_render_auto_symbol_substitution', renderAutoSymbolSubstitution ? 'true' : 'false'); });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem('pref_render_preserve_indent_on_enter', renderPreserveIndentOnEnter ? 'true' : 'false'); });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem('pref_delimited_table_highlight_header', delimitedTableHighlightHeader ? 'true' : 'false'); });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem('pref_delimited_table_show_row_indices', delimitedTableShowRowIndices ? 'true' : 'false'); });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem('pref_delimited_table_animate_reorder', delimitedTableAnimateReorder ? 'true' : 'false'); });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem('pref_delimited_table_reorder_duration_ms', delimitedTableReorderDurationMs.toString()); });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem(documentFeaturePreferenceKey, JSON.stringify(documentFeatureSettings)); });
  $effect(() => { if (isBrowser && canPersistPreferences) localStorage.setItem(markdownRenderPreferenceKey, JSON.stringify(markdownRenderSettings)); });
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
      activeSettingsView = 'general';
      getCurrentWindow().onCloseRequested((event) => {
        event.preventDefault();
        getCurrentWindow().hide();
      });
    } else {
      let unlistenClose: (() => void) | undefined;
      getCurrentWindow().onCloseRequested(async (event) => {
        event.preventDefault();

        if (isHandlingCloseRequest) return;
        isHandlingCloseRequest = true;
        try {
          const canClose = await shouldCloseEditorWindow();
          if (!canClose) return;

          try {
            const editorWindows = (await WebviewWindow.getAll())
              .filter((window) => window.label !== 'settings' && window.label !== label);
            if (editorWindows.length === 0) {
              const settingsWin = await WebviewWindow.getByLabel('settings');
              if (settingsWin) {
                await settingsWin.destroy();
              }
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

  async function shouldCloseEditorWindow(): Promise<boolean> {
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

    const closeSaveButtons = getCloseSaveButtons();
    let result: string;
    try {
      result = await message(t('dialog.saveChanges.prompt', { fileName: getDisplayFileName(tab) }), {
        title: t('dialog.saveChanges.title'),
        kind: "warning",
        buttons: closeSaveButtons
      });
    } catch (err: any) {
      errorMsg = localizeError('error.unexpected', err);
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
      errorMsg = localizeError('error.saveFile', err);
      return false;
    } finally {
      isLoading = false;
    }
  }

  function applySavedFile(tabId: string, savedFile: SavedFile) {
    const nextFileName = getFileNameFromPath(savedFile.path);
    markTabHistorySaved(tabId);
    updateTabById(tabId, {
      filePath: savedFile.path,
      fileName: nextFileName,
      encoding: savedFile.encoding,
      isDirty: false
    });

    if (tabId === activeTabId) {
      filePath = savedFile.path;
      fileName = nextFileName;
      fileEncoding = savedFile.encoding;
      isDirty = false;
    }
  }

  async function writeTabContent(tabId: string, targetPath: string) {
    syncActiveTabState();
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) return;

    await invoke("write_file_content", {
      path: targetPath,
      content: tab.fileContent,
      encoding: tab.encoding
    });
    applySavedFile(tabId, { path: targetPath, encoding: tab.encoding });
  }

  async function saveTabFile(tabId: string): Promise<boolean> {
    syncActiveTabState();
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) return false;

    if (tab.filePath) {
      await writeTabContent(tabId, tab.filePath);
      return true;
    }

    const savedFile = await invoke<SavedFile | null>("save_file_dialog", {
      defaultName: getSuggestedSaveFileName(tab),
      content: tab.fileContent,
      encoding: null,
      filters: getSaveFileDialogFilters(locale)
    });
    if (!savedFile) return false;

    applySavedFile(tabId, savedFile);
    return true;
  }

  async function saveCurrentFile(): Promise<boolean> {
    return saveTabFile(activeTabId);
  }

  async function saveCurrentFileAs(): Promise<boolean> {
    syncActiveTabState();
    const tab = getActiveTab();
    if (!tab) return false;

    const savedFile = await invoke<SavedFile | null>("save_file_dialog", {
      defaultName: getSuggestedSaveFileName(tab),
      content: tab.fileContent,
      encoding: tab.filePath ? tab.encoding : null,
      filters: getSaveFileDialogFilters(locale)
    });
    if (!savedFile) {
      return false;
    }

    applySavedFile(activeTabId, savedFile);
    return true;
  }

  // storage 변경 감지 핸들러 (창 간 실시간 동기화)
  function handleStorageChange(e: StorageEvent) {
    if (!e.key) return;
    if (e.key === languagePreferenceKey && e.newValue && (e.newValue === 'system' || isAppLocale(e.newValue))) languagePreference = e.newValue;
    if (e.key === 'pref_theme_mode' && e.newValue && (e.newValue === 'system' || e.newValue === 'light' || e.newValue === 'dark')) themeMode = e.newValue;
    if (e.key === 'pref_source_font_size' && e.newValue) sourceFontSize = parseInt(e.newValue, 10);
    if (e.key === 'pref_render_font_size' && e.newValue) renderFontSize = parseInt(e.newValue, 10);
    if (e.key === 'pref_tab_size' && e.newValue) tabSize = parseInt(e.newValue, 10);
    if (e.key === 'pref_render_auto_pair_editing' && e.newValue) renderAutoPairEditing = e.newValue !== 'false';
    if (e.key === renderAutoPairAllowedFollowingStringsPreferenceKey) {
      renderAutoPairAllowedFollowingStrings = parseAutoPairAllowedFollowingStrings(e.newValue);
    }
    if (e.key === 'pref_render_auto_symbol_substitution' && e.newValue) renderAutoSymbolSubstitution = e.newValue !== 'false';
    if (e.key === 'pref_render_preserve_indent_on_enter' && e.newValue) renderPreserveIndentOnEnter = e.newValue !== 'false';
    if (e.key === 'pref_delimited_table_highlight_header' && e.newValue) delimitedTableHighlightHeader = e.newValue !== 'false';
    if (e.key === 'pref_delimited_table_show_row_indices' && e.newValue) delimitedTableShowRowIndices = e.newValue !== 'false';
    if (e.key === 'pref_delimited_table_animate_reorder' && e.newValue) delimitedTableAnimateReorder = e.newValue !== 'false';
    if (e.key === 'pref_delimited_table_reorder_duration_ms' && e.newValue) {
      delimitedTableReorderDurationMs = normalizeDelimitedTableReorderDuration(e.newValue);
    }
    if (e.key === documentFeaturePreferenceKey) documentFeatureSettings = parseDocumentFeatureSettingsValue(e.newValue);
    if (e.key === markdownRenderPreferenceKey) markdownRenderSettings = parseMarkdownRenderSettingsValue(e.newValue);
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

  function getCurrentSettingsSnapshot(): AppSettingsSnapshot {
    return {
      general: {
        language: languagePreference,
        theme: themeMode
      },
      source: {
        fontSize: sourceFontSize
      },
      render: {
        fontSize: renderFontSize,
        indentWidth: tabSize,
        fontFamily: renderFontFamily,
        editing: {
          autoPair: renderAutoPairEditing,
          autoPairAllowedFollowingStrings: [...renderAutoPairAllowedFollowingStrings],
          autoSymbols: renderAutoSymbolSubstitution,
          preserveIndent: renderPreserveIndentOnEnter
        },
        colors: {
          light: { ...lightColors },
          dark: { ...darkColors }
        },
        formats: {
          features: normalizeDocumentFeatureSettings(documentFeatureSettings),
          markdown: normalizeMarkdownRenderSettings(markdownRenderSettings),
          table: {
            highlightHeader: delimitedTableHighlightHeader,
            showRowIndices: delimitedTableShowRowIndices,
            animateReorder: delimitedTableAnimateReorder,
            reorderDurationMs: delimitedTableReorderDurationMs
          }
        }
      }
    };
  }

  function applySettingsSnapshot(settings: AppSettingsSnapshot) {
    languagePreference = settings.general.language;
    themeMode = settings.general.theme;
    sourceFontSize = settings.source.fontSize;
    renderFontSize = settings.render.fontSize;
    tabSize = settings.render.indentWidth;
    renderFontFamily = settings.render.fontFamily;
    renderAutoPairEditing = settings.render.editing.autoPair;
    renderAutoPairAllowedFollowingStrings = [...settings.render.editing.autoPairAllowedFollowingStrings];
    renderAutoSymbolSubstitution = settings.render.editing.autoSymbols;
    renderPreserveIndentOnEnter = settings.render.editing.preserveIndent;
    lightColors = { ...settings.render.colors.light };
    darkColors = { ...settings.render.colors.dark };
    documentFeatureSettings = normalizeDocumentFeatureSettings(settings.render.formats.features);
    markdownRenderSettings = normalizeMarkdownRenderSettings(settings.render.formats.markdown);
    delimitedTableHighlightHeader = settings.render.formats.table.highlightHeader;
    delimitedTableShowRowIndices = settings.render.formats.table.showRowIndices;
    delimitedTableAnimateReorder = settings.render.formats.table.animateReorder;
    delimitedTableReorderDurationMs = normalizeDelimitedTableReorderDuration(
      settings.render.formats.table.reorderDurationMs
    );
  }

  function getSettingsImportErrorMessage(reason: SettingsImportErrorReason): string {
    const keys: Record<SettingsImportErrorReason, TranslationKey> = {
      invalid_json: 'settings.transfer.error.invalidJson',
      invalid_structure: 'settings.transfer.error.invalidStructure',
      unsupported_format: 'settings.transfer.error.unsupportedFormat',
      file_too_large: 'settings.transfer.error.fileTooLarge'
    };
    return t(keys[reason]);
  }

  async function handleExportSettings() {
    if (isSettingsTransferBusy) return;
    isSettingsTransferBusy = true;
    settingsTransferStatus = null;
    try {
      const savedFile = await invoke<SavedFile | null>('save_file_dialog', {
        defaultName: 'text-pad-settings.json',
        content: serializeSettingsFile(getCurrentSettingsSnapshot(), installedAppVersion),
        encoding: 'utf8',
        filters: [{ name: t('settings.transfer.jsonFilter'), extensions: ['json'] }]
      });
      if (savedFile) {
        settingsTransferStatus = {
          kind: 'success',
          message: t('settings.transfer.exportSuccess')
        };
      }
    } catch (error) {
      settingsTransferStatus = {
        kind: 'error',
        message: localizeError('error.saveFile', error)
      };
    } finally {
      isSettingsTransferBusy = false;
    }
  }

  async function handleImportSettings() {
    if (isSettingsTransferBusy) return;
    isSettingsTransferBusy = true;
    settingsTransferStatus = null;
    try {
      const openedFile = await invoke<OpenedFile | null>('open_file_dialog', {
        filters: [{ name: t('settings.transfer.jsonFilter'), extensions: ['json'] }]
      });
      if (!openedFile) return;

      const result = parseSettingsFile(openedFile.content, getCurrentSettingsSnapshot());
      if (!result.ok) {
        settingsTransferStatus = {
          kind: 'error',
          message: getSettingsImportErrorMessage(result.reason)
        };
        return;
      }

      applySettingsSnapshot(result.settings);
      await tick();
      settingsTransferStatus = result.newerVersion
        ? { kind: 'warning', message: t('settings.transfer.importNewer', { count: result.applied }) }
        : result.skipped > 0
          ? { kind: 'warning', message: t('settings.transfer.importPartial', { count: result.applied, skipped: result.skipped }) }
          : { kind: 'success', message: t('settings.transfer.importSuccess', { count: result.applied }) };
    } catch (error) {
      settingsTransferStatus = {
        kind: 'error',
        message: localizeError('error.readFile', error)
      };
    } finally {
      isSettingsTransferBusy = false;
    }
  }


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

  function getRenderLineTop(lineIndex: number): number {
    return renderLineLayout.getLineTop(lineIndex);
  }

  function getRenderLineHeight(lineIndex: number): number {
    return renderLineLayout.getLineHeight(lineIndex);
  }

  function parseDelimitedTableWithinBudget(
    content: string,
    separator: DelimitedTableSeparator
  ): DelimitedTableDocument | null {
    return parseDelimitedTableWithinCellLimit(content, separator, MAX_INTERACTIVE_TABLE_CELLS);
  }

  // 반응형 상태
  let lineStartOffsets = $derived(textOffsetIndex.lineStartOffsets);
  let isEnhancedDocumentWithinBudget = $derived(
    fileContent.length <= MAX_ENHANCED_RENDER_CHARS
    && lineStartOffsets.length <= MAX_ENHANCED_RENDER_LINES
  );
  let fencedCodeBlocks = $derived(
    isRenderMode && isEnhancedDocumentWithinBudget
      ? getFencedCodeBlockRanges(
          fencedCodeBlockCache,
          fileContent,
          lineStartOffsets,
          latestContentChange
        )
      : []
  );
  let lineCount = $derived(lineStartOffsets.length);
  let charCount = $derived(fileContent.length);
  let textareaDisplayContent = $derived(textOffsetIndex.textareaValue);
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
  let renderedLineMeasurementContext = $derived([
    renderWrapContentWidth.toFixed(3),
    measuredLineHeight.toFixed(3),
    currentFontSize,
    currentRenderFontFamilyCSS,
    activeColors.renderFontWeight,
    tabSize,
    filePath || fileName,
    JSON.stringify(documentFeatureSettings),
    JSON.stringify(markdownRenderSettings)
  ].join('|'));
  let renderLineLayout = $derived(getEditorLineLayout(editorLineLayoutCache, {
    content: fileContent,
    lineStartOffsets,
    contentWidth: renderWrapContentWidth,
    fencedCodeRanges: fencedCodeBlocks,
    wrapEnabled: isRenderMode && isEnhancedDocumentWithinBudget,
    measurements: renderedLineHeightMeasurements,
    measurementContext: renderedLineMeasurementContext,
    measuredLineHeight,
    fencedCodeHorizontalPadding,
    measureTextEndWidth: measureEditorTextEndWidth,
    measureTextWidth: measureEditorTextWidth,
    getListContinuationIndent: getMeasuredListContinuationIndent,
    change: latestContentChange
  }));
  let shouldShowNativeRenderText = $derived(isRenderMode && isEnhancedDocumentWithinBudget && isRenderWrapSettling);
  let shouldRenderHighlightLayer = $derived(isRenderMode && isEnhancedDocumentWithinBudget && !shouldShowNativeRenderText);

  function syncRenderedLineHeightMeasurements(entries: ResizeObserverEntry[]) {
    const hasCurrentMeasurements = renderedLineHeightMeasurements.content === fileContent
      && renderedLineHeightMeasurements.context === renderedLineMeasurementContext;
    let nextHeights = hasCurrentMeasurements ? renderedLineHeightMeasurements.heights : {};
    let hasChanged = false;

    for (const entry of entries) {
      const lineElement = entry.target as HTMLElement;
      const lineIndex = Number(lineElement.dataset.lineIndex);
      if (!Number.isFinite(lineIndex)) continue;

      const observedHeight = entry.borderBoxSize[0]?.blockSize
        ?? lineElement.getBoundingClientRect().height;
      const height = Math.max(measuredLineHeight, observedHeight);
      const previousHeight = nextHeights[lineIndex];
      if (previousHeight !== undefined && Math.abs(previousHeight - height) <= 0.25) {
        continue;
      }

      if (!hasChanged) {
        nextHeights = { ...nextHeights };
        hasChanged = true;
      }
      nextHeights[lineIndex] = height;
    }

    if (!hasChanged) return;
    renderedLineHeightMeasurements = {
      content: fileContent,
      context: renderedLineMeasurementContext,
      heights: nextHeights
    };
    void tick().then(() => {
      syncSteadyEditorCaretPosition();
      scheduleRenderedSelectionHighlight();
    });
  }

  function observeRenderedLine(node: HTMLElement) {
    if (!isBrowser) return;

    renderedLineResizeObserver ??= new ResizeObserver(syncRenderedLineHeightMeasurements);
    renderedLineResizeObserver.observe(node);

    return {
      destroy() {
        renderedLineResizeObserver?.unobserve(node);
      }
    };
  }

  // 가상화 범위 계산
  let startLine = $derived(Math.max(
    0,
    renderLineLayout.findLineIndex(scrollTop - editorTopPadding) - virtualLineOverscan
  ));
  let endLine = $derived(Math.min(
    lineCount - 1,
    renderLineLayout.findLineIndex(scrollTop + clientHeight - editorTopPadding) + virtualLineOverscan
  ));

  // 렌더 모드 텍스트 및 가상화 파싱 라인 생성
  let activeDocumentFormat = $derived(getDocumentFormatForContent(fileContent, filePath || fileName));
  let isActiveDocumentRenderEnabled = $derived(
    isEnhancedDocumentWithinBudget
    && isDocumentFormatRenderEnabled(activeDocumentFormat, documentFeatureSettings)
  );
  let isActiveDocumentEditEnabled = $derived(isDocumentFormatEditEnabled(activeDocumentFormat, documentFeatureSettings));
  let activeDelimitedTableSeparator = $derived<DelimitedTableSeparator | null>(
    activeDocumentFormat.id === 'csv' ? ',' : activeDocumentFormat.id === 'tsv' ? '\t' : null
  );
  let activeDelimitedTableDocument = $derived(
    activeDelimitedTableSeparator && isRenderMode && isActiveDocumentRenderEnabled
      ? parseDelimitedTableWithinBudget(fileContent, activeDelimitedTableSeparator)
      : null
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
    renderEnabled: isActiveDocumentRenderEnabled,
    featureSettings: documentFeatureSettings,
    markdownSettings: markdownRenderSettings,
    renderCache: documentRenderCache,
    contentChange: latestContentChange
  }));
  let parsedLines = $derived(documentRender.lines);


  function getTokenTextLength(token: Token): number {
    if (token.children?.length) {
      return token.children.reduce((length, child) => length + getTokenTextLength(child), 0);
    }
    return token.text?.length ?? 0;
  }

  interface RenderListTokenParts {
    prefixTokens: Token[];
    bodyTokens: Token[];
  }

  function getListRenderTokenParts(tokens: Token[], prefixLength: number): RenderListTokenParts | null {
    if (prefixLength === 0) {
      return { prefixTokens: [], bodyTokens: tokens };
    }

    const prefixTokens: Token[] = [];
    let remaining = prefixLength;
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      const tokenLength = getTokenTextLength(token);
      if (tokenLength <= remaining) {
        prefixTokens.push(token);
        remaining -= tokenLength;
        if (remaining === 0) {
          return { prefixTokens, bodyTokens: tokens.slice(index + 1) };
        }
        continue;
      }

      if (token.children?.length) return null;
      const tokenText = token.text ?? '';
      const tokenStart = token.start;
      const prefixText = tokenText.slice(0, remaining);
      const bodyText = tokenText.slice(remaining);
      if (prefixText) {
        prefixTokens.push({
          ...token,
          text: prefixText,
          end: tokenStart === undefined ? token.end : tokenStart + remaining
        });
      }
      const bodyToken: Token = {
        ...token,
        text: bodyText,
        start: tokenStart === undefined ? token.start : tokenStart + remaining
      };
      return {
        prefixTokens,
        bodyTokens: bodyText ? [bodyToken, ...tokens.slice(index + 1)] : tokens.slice(index + 1)
      };
    }

    return remaining === 0 ? { prefixTokens, bodyTokens: [] } : null;
  }

  let renderListLineLayouts = $derived(
    renderLineLayout.listLayouts.slice(startLine, endLine + 1)
  );

  const syntaxDiagnosticDelayMs = 500;

  $effect(() => {
    const content = fileContent;
    const pathOrName = filePath || fileName;
    const format = activeDocumentFormat;
    const featureSettings = normalizeDocumentFeatureSettings(documentFeatureSettings);
    const requestLocale = locale;
    const requestId = ++documentDiagnosticRequestId;
    documentDiagnosticWorkerClient?.cancel();

    if (
      !isEnhancedDocumentWithinBudget
      || !format.validatesSyntax
      || !isDocumentFormatRenderEnabled(format, featureSettings)
    ) {
      documentDiagnostic = null;
      return;
    }

    const timer = setTimeout(() => {
      if (!documentDiagnosticWorkerClient) {
        documentDiagnostic = getDocumentDiagnostic(content, {
          pathOrName,
          featureSettings,
          locale: requestLocale
        });
        return;
      }

      void documentDiagnosticWorkerClient.diagnose({
        requestId,
        content,
        pathOrName,
        featureSettings,
        locale: requestLocale
      }).then((response) => {
        if (response.requestId === documentDiagnosticRequestId) {
          documentDiagnostic = response.diagnostic;
        }
      }).catch((error) => {
        if (error instanceof DocumentDiagnosticCancelledError) return;
        if (requestId !== documentDiagnosticRequestId) return;
        console.error('Document diagnostic worker failed:', error);
        documentDiagnostic = getDocumentDiagnostic(content, {
          pathOrName,
          featureSettings,
          locale: requestLocale
        });
      });
    }, syntaxDiagnosticDelayMs);

    return () => {
      clearTimeout(timer);
      documentDiagnosticWorkerClient?.cancel();
    };
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
    editorTextWidthCache.set(text, width);
    return width;
  }

  function getIndentGuideLeft(indentIndex: number): number {
    const indentPrefix = ' '.repeat(Math.max(0, indentIndex) * tabSize);
    return (editorHorizontalPadding / 2) + measureEditorPlainTextWidth(indentPrefix);
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

  function openFile(openedFile: OpenedFile, replaceCleanUntitled = true) {
    const openedTab = createEditorTab({
      filePath: openedFile.path,
      fileName: getFileNameFromPath(openedFile.path),
      fileContent: openedFile.content,
      encoding: openedFile.encoding,
      isDirty: false
    });
    const activeTab = getActiveTab();

    if (replaceCleanUntitled && activeTab && isCleanUntitledTab(activeTab)) {
      replaceActiveTabWith(openedTab);
    } else {
      addTab(openedTab);
    }
  }

  async function openDroppedFiles(paths: string[]) {
    if (!paths.length || isSettingsWindow) return;

    try {
      isLoading = true;
      errorMsg = null;
      syncActiveTabState();
      const openedFiles = await invoke<OpenedFile[]>("open_file_paths", { paths });
      for (const openedFile of openedFiles) {
        openFile(openedFile, false);
      }
    } catch (err: any) {
      errorMsg = localizeError('error.readFile', err);
    } finally {
      isLoading = false;
    }
  }

  $effect(() => {
    if (!isBrowser || !hasTauriRuntime() || isSettingsWindow) return;

    let isDisposed = false;
    let unlistenDragDrop: UnlistenFn | undefined;
    getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === 'drop') {
        void openDroppedFiles(event.payload.paths);
      }
    }).then((unlisten) => {
      if (isDisposed) {
        unlisten();
      } else {
        unlistenDragDrop = unlisten;
      }
    }).catch((err) => {
      console.error('Failed to listen for dropped files:', err);
    });

    return () => {
      isDisposed = true;
      if (unlistenDragDrop) unlistenDragDrop();
    };
  });

  async function loadStartupFiles() {
    if (hasLoadedStartupFiles || !hasTauriRuntime() || isSettingsWindow) return;
    hasLoadedStartupFiles = true;

    try {
      const startupFiles = await invoke<OpenedFile[]>("get_startup_files");
      if (!startupFiles.length) return;

      isLoading = true;
      errorMsg = null;
      syncActiveTabState();
      for (const startupFile of startupFiles) {
        openFile(startupFile);
      }
    } catch (err: any) {
      errorMsg = localizeError('error.readFile', err);
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
      await Promise.all([
        appWindow.setTitle(getCurrentWindowTitle()),
        appWindow.show()
      ]);
      await appWindow.setFocus();
    } catch (err) {
      console.error('Failed to show main window:', err);
    } finally {
      requestAnimationFrame(focusEditorOnStartup);
    }
  }

  function showTransientStatus(messageText: string, durationMs = 4_000) {
    transientStatusMessage = messageText;
    if (transientStatusTimer) {
      clearTimeout(transientStatusTimer);
    }
    transientStatusTimer = setTimeout(() => {
      transientStatusMessage = null;
      transientStatusTimer = null;
    }, durationMs);
  }

  async function refreshInstalledAppVersion() {
    installedAppVersion = await getInstalledAppVersion();
  }

  function getUpdatePromptText(update: Update): string {
    const releaseNotes = update.body?.trim();
    const notes = releaseNotes
      ? `\n\n${t('update.releaseNotes', {
          notes: `${releaseNotes.slice(0, 600)}${releaseNotes.length > 600 ? '\n…' : ''}`
        })}`
      : '';
    return t('update.availablePrompt', {
      version: update.version,
      currentVersion: update.currentVersion,
      notes
    });
  }

  async function installAvailableAppUpdate(update: Update) {
    if (isInstallingUpdate) {
      showTransientStatus(t('update.installing'));
      return;
    }

    isInstallingUpdate = true;
    try {
      const canRestart = await shouldCloseEditorWindow();
      if (!canRestart) {
        showTransientStatus(t('update.cancelled'));
        return;
      }

      let downloadedBytes = 0;
      let contentLength: number | undefined;
      const handleDownloadEvent = (event: DownloadEvent) => {
        if (event.event === 'Started') {
          contentLength = event.data.contentLength;
          showTransientStatus(t('update.downloading'), 120_000);
        } else if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength;
          if (contentLength && contentLength > 0) {
            const percent = Math.min(100, Math.round((downloadedBytes / contentLength) * 100));
            showTransientStatus(t('update.downloadingProgress', { percent }), 120_000);
          }
        } else if (event.event === 'Finished') {
          showTransientStatus(t('update.restarting'), 120_000);
        }
      };

      await installAppUpdate(update, handleDownloadEvent);
    } catch (err) {
      if (availableAppUpdate === update) {
        availableAppUpdate = null;
      }
      await closeAppUpdate(update);
      const detail = err instanceof Error ? err.message : String(err);
      console.error('Failed to update application:', err);
      showTransientStatus(t('update.failed', { detail }), 7_000);
    } finally {
      isInstallingUpdate = false;
    }
  }

  async function promptToInstallAppUpdate(update: Update) {
    const shouldInstall = await ask(getUpdatePromptText(update), {
      title: t('update.title'),
      kind: 'info',
      okLabel: t('update.install'),
      cancelLabel: t('update.later')
    });

    if (!shouldInstall) {
      showTransientStatus(t('update.postponed'));
      return;
    }

    await installAvailableAppUpdate(update);
  }

  async function checkForUpdates(source: 'startup' | 'manual') {
    const isManualCheck = source === 'manual';
    if (isCheckingForUpdate || isInstallingUpdate) {
      if (isManualCheck) {
        showTransientStatus(isInstallingUpdate ? t('update.installing') : t('update.checking'));
      }
      return;
    }

    isCheckingForUpdate = true;
    if (isManualCheck) {
      showTransientStatus(t('update.checking'), 20_000);
    }

    try {
      const update = availableAppUpdate ?? await checkForAppUpdate();
      if (!update) {
        if (isManualCheck) {
          showTransientStatus(t('update.latest', { version: installedAppVersion }));
        }
        return;
      }

      availableAppUpdate = update;
      if (isManualCheck) {
        await promptToInstallAppUpdate(update);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('Failed to check for application update:', err);
      if (isManualCheck) {
        showTransientStatus(t('update.failed', { detail }), 7_000);
      }
    } finally {
      isCheckingForUpdate = false;
    }
  }

  function scheduleStartupUpdateCheck() {
    if (hasCheckedForUpdateOnStartup || !hasTauriRuntime() || isSettingsWindow) return;
    hasCheckedForUpdateOnStartup = true;
    startupUpdateTimer = setTimeout(() => {
      startupUpdateTimer = null;
      void checkForUpdates('startup');
    }, 1_000);
  }

  function handleManualUpdateCheck() {
    closeAllDropdown();
    void checkForUpdates('manual');
  }

  function handleAvailableUpdateInstall() {
    closeAllDropdown();
    if (!availableAppUpdate) return;
    void installAvailableAppUpdate(availableAppUpdate);
  }

  function handleAboutDialogOpen() {
    closeAllDropdown();
    isAboutDialogOpen = true;
    void refreshInstalledAppVersion();
  }

  async function receiveStartupTabTransfer(): Promise<boolean> {
    if (!startupTabTransferMetadata) return true;

    try {
      await ensureTabTransferListeners();
      const received = await requestIncomingTabTransfer(startupTabTransferMetadata, 0);
      if (received) {
        const url = new URL(window.location.href);
        url.searchParams.delete(tabTransferIdQueryKey);
        url.searchParams.delete(tabTransferSourceQueryKey);
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      }
      return received;
    } catch (error) {
      console.error('Failed to initialize detached tab window:', error);
      return false;
    }
  }

  async function initializeMainWindowAfterStartup() {
    if (getCurrentEditorWindowLabel() !== 'main') {
      void invoke('setup_editor_window_wheel').catch((error) => {
        console.error('Failed to initialize horizontal wheel for editor window:', error);
      });
    }
    const receivedStartupTransfer = await receiveStartupTabTransfer();
    if (startupTabTransferMetadata && !receivedStartupTransfer) {
      await getCurrentWindow().destroy().catch(() => {});
      return;
    }
    if (!startupTabTransferMetadata) {
      await loadStartupFiles();
    }
    await showMainWindowAfterStartup();
    void refreshInstalledAppVersion();
    scheduleStartupUpdateCheck();
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
    const title = getCurrentWindowTitle();
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

  function clearRenderedSelectionHighlight() {
    hasRenderedSelectionHighlight = false;
    if (!supportsRenderedSelectionHighlight) return;
    CSS.highlights.delete(renderedSelectionHighlightName);
  }

  function getTextNodeBoundary(
    root: HTMLElement,
    targetOffset: number,
    preferNextTextNode = false
  ): { node: Text; offset: number } | null {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let remainingOffset = Math.max(0, targetOffset);
    let lastNonEmptyTextNode: Text | null = null;
    let textNode = walker.nextNode() as Text | null;

    while (textNode) {
      const textLength = textNode.data.length;
      if (textLength === 0) {
        textNode = walker.nextNode() as Text | null;
        continue;
      }

      lastNonEmptyTextNode = textNode;
      if (remainingOffset < textLength || (!preferNextTextNode && remainingOffset === textLength)) {
        return { node: textNode, offset: remainingOffset };
      }
      remainingOffset -= textLength;
      textNode = walker.nextNode() as Text | null;
    }

    return lastNonEmptyTextNode
      ? { node: lastNonEmptyTextNode, offset: lastNonEmptyTextNode.data.length }
      : null;
  }

  function getVisibleRenderedSelectionRanges(selection: EditorSelection): Range[] {
    if (!editorViewportEl || selection.start === selection.end) return [];

    const ranges: Range[] = [];
    for (let lineIndex = startLine; lineIndex <= endLine; lineIndex += 1) {
      const lineStart = lineStartOffsets[lineIndex] ?? 0;
      const lineText = getLineTextForLayout(fileContent, lineStartOffsets, lineIndex);
      const lineEnd = lineStart + lineText.length;
      const selectedStart = Math.max(selection.start, lineStart);
      const selectedEnd = Math.min(selection.end, lineEnd);
      if (selectedEnd <= selectedStart) continue;

      const lineContent = editorViewportEl.querySelector(
        `.backdrop-line[data-line-index="${lineIndex}"] .line-content`
      ) as HTMLElement | null;
      if (!lineContent) continue;

      const startBoundary = getTextNodeBoundary(lineContent, selectedStart - lineStart);
      const endBoundary = getTextNodeBoundary(lineContent, selectedEnd - lineStart);
      if (!startBoundary || !endBoundary) continue;

      const range = document.createRange();
      range.setStart(startBoundary.node, startBoundary.offset);
      range.setEnd(endBoundary.node, endBoundary.offset);
      ranges.push(range);
    }

    return ranges;
  }

  function syncRenderedSelectionHighlight() {
    if (
      !supportsRenderedSelectionHighlight
      || !isRenderMode
      || !shouldRenderHighlightLayer
      || !hasEditorSelection
      || !textareaEl
    ) {
      clearRenderedSelectionHighlight();
      return;
    }

    const ranges = getVisibleRenderedSelectionRanges(getTextareaSelectionInContent());
    if (ranges.length === 0) {
      clearRenderedSelectionHighlight();
      return;
    }

    CSS.highlights.set(renderedSelectionHighlightName, new Highlight(...ranges));
    hasRenderedSelectionHighlight = true;
  }

  function scheduleRenderedSelectionHighlight() {
    if (!supportsRenderedSelectionHighlight) return;
    if (renderedSelectionHighlightFrame !== null) {
      cancelAnimationFrame(renderedSelectionHighlightFrame);
    }

    renderedSelectionHighlightFrame = requestAnimationFrame(() => {
      renderedSelectionHighlightFrame = null;
      syncRenderedSelectionHighlight();
    });
  }

  function getFencedCodeLineCaret(lineStart: number): number {
    const lineEnd = getLineEndOffset(fileContent, lineStart);
    return lineStart + getLeadingWhitespace(fileContent.slice(lineStart, lineEnd)).length;
  }

  function getFirstFencedCodeContentCaret(block: FencedCodeBlockRange): number {
    const hasContentLine = block.closingLineStart === undefined
      ? block.contentStart > block.openingLineEnd
      : block.contentStart < block.closingLineStart;
    return hasContentLine
      ? getFencedCodeLineCaret(block.contentStart)
      : getCaretAfterFencedCodeBlock(block)
        ?? getCaretBeforeFencedCodeBlock(block)
        ?? block.openingLineEnd;
  }

  function getLastFencedCodeContentCaret(block: FencedCodeBlockRange): number | null {
    if (block.closingLineStart === undefined) return null;

    const previousLine = getPreviousLineBounds(fileContent, block.closingLineStart);
    return previousLine && previousLine.start > block.openingLineStart
      ? previousLine.end
      : null;
  }

  function getCaretBeforeFencedCodeBlock(block: FencedCodeBlockRange): number | null {
    return getPreviousLineBounds(fileContent, block.openingLineStart)?.end ?? null;
  }

  function getCaretAfterFencedCodeBlock(block: FencedCodeBlockRange): number | null {
    if (
      block.closingLineEnd === undefined
      || block.afterBlockStart === undefined
      || block.afterBlockStart <= block.closingLineEnd
    ) return null;

    return getFencedCodeLineCaret(block.afterBlockStart);
  }

  function getMarkdownHeadingMarkerRange(offset: number): { start: number; end: number } | null {
    if (activeDocumentFormat.id !== 'markdown' || !markdownRenderSettings.hideHeadingMarkers) return null;

    const lineIndex = findLineIndexForOffset(offset);
    const lineStart = lineStartOffsets[lineIndex] ?? 0;
    const lineEnd = getLineEndOffset(fileContent, lineStart);
    const insideFencedCode = fencedCodeBlocks.some((block) => (
      lineStart >= block.openingLineStart
      && lineStart <= (block.closingLineStart ?? Number.POSITIVE_INFINITY)
    ));
    if (insideFencedCode) return null;

    const line = fileContent.slice(lineStart, lineEnd);
    const match = line.match(/^([ \t]{0,3})(#{1,6})([ \t]+)/u);
    if (!match) return null;
    const start = lineStart + (match[1]?.length ?? 0);
    const end = start + (match[2]?.length ?? 0) + (match[3]?.length ?? 0);
    return offset >= start && offset <= end ? { start, end } : null;
  }

  function getSafeRenderedCaretOffset(offset: number, direction: -1 | 0 | 1): number {
    const headingMarker = getMarkdownHeadingMarkerRange(offset);
    if (headingMarker && offset > headingMarker.start && offset < headingMarker.end) {
      return direction < 0 ? headingMarker.start : headingMarker.end;
    }

    for (const block of fencedCodeBlocks) {
      if (offset >= block.openingLineStart && offset <= block.openingLineEnd) {
        return direction < 0
          ? getCaretBeforeFencedCodeBlock(block) ?? getFirstFencedCodeContentCaret(block)
          : getFirstFencedCodeContentCaret(block);
      }

      if (
        block.closingLineStart !== undefined
        && block.closingLineEnd !== undefined
        && offset >= block.closingLineStart
        && offset <= block.closingLineEnd
      ) {
        if (direction < 0) {
          return getLastFencedCodeContentCaret(block)
            ?? getCaretBeforeFencedCodeBlock(block)
            ?? getCaretAfterFencedCodeBlock(block)
            ?? offset;
        }
        return getCaretAfterFencedCodeBlock(block)
          ?? getLastFencedCodeContentCaret(block)
          ?? offset;
      }
    }

    const listLineIndex = findLineIndexForOffset(offset);
    const listLayout = getRenderListLineLayout(listLineIndex);
    if (listLayout) {
      const bodyStart = getRenderListBodyStart(listLineIndex, listLayout);
      if (offset < bodyStart) return bodyStart;
    }

    return offset;
  }

  function shouldBlockPartialFencedCodeSelectionEdit(start: number, end: number): boolean {
    if (start === end) return false;

    return fencedCodeBlocks.some((block) => {
      if (
        block.closingBoundaryStart === undefined
        || block.closingLineEnd === undefined
        || block.afterBlockStart === undefined
      ) return false;

      const touchesOpeningBoundary = start < block.contentStart && end > block.openingLineStart;
      const touchesClosingBoundary = start < block.afterBlockStart && end > block.closingBoundaryStart;
      const coversWholeBlock = start <= block.openingLineStart && end >= block.closingLineEnd;
      return (touchesOpeningBoundary || touchesClosingBoundary) && !coversWholeBlock;
    });
  }

  function updateCursorPosition() {
    if (!textareaEl) return;
    const isCollapsed = textareaEl.selectionStart === textareaEl.selectionEnd;
    let { start: pos } = getTextareaSelectionInContent();
    const previousCaretOffset = caretOffset;
    if (isRenderMode && isActiveDocumentRenderEnabled && isCollapsed) {
      const safePosition = getSafeRenderedCaretOffset(pos, pendingRenderCaretMovementDirection);
      if (safePosition !== pos) {
        setTextareaSelectionFromContent(safePosition, safePosition);
        pos = safePosition;
      }
    }
    pendingRenderCaretMovementDirection = 0;
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
    scheduleRenderedSelectionHighlight();
  }

  function updateEditorStateForSnapshot(
    snapshot: EditorSnapshot,
    suppliedChange?: TextChange | null,
    suppliedOffsetIndex?: TextOffsetIndex
  ) {
    const contentChange = suppliedChange === undefined
      ? getTextChange(fileContent, snapshot.content)
      : suppliedChange;
    latestContentChange = contentChange;
    textOffsetIndex = suppliedOffsetIndex
      ?? (contentChange ? createTextOffsetIndex(snapshot.content) : getTextOffsetIndex(snapshot.content));
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

  function applyEditorSnapshot(
    snapshot: EditorSnapshot,
    selectionAlreadyApplied = false,
    change?: TextChange | null,
    offsetIndex?: TextOffsetIndex
  ) {
    updateEditorStateForSnapshot(snapshot, change, offsetIndex);

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
    options: {
      mergeKey?: string | null;
      selectionAlreadyApplied?: boolean;
      keepRenderCaretVisible?: boolean;
      syncRenderCaretAfterUpdate?: boolean;
      change?: TextChange | null;
      offsetIndex?: TextOffsetIndex;
    } = {}
  ) {
    const change = options.change === undefined
      ? getTextChange(before.content, after.content)
      : options.change;
    const offsetIndex = options.offsetIndex
      ?? (change ? createTextOffsetIndex(after.content) : getTextOffsetIndex(after.content));
    const history = getActiveUndoHistory();
    history.record(before, after, { mergeKey: options.mergeKey ?? null, change });
    enforceUndoWindowBudget();

    if (
      options.syncRenderCaretAfterUpdate
      && options.selectionAlreadyApplied
      && isRenderMode
      && isActiveDocumentRenderEnabled
    ) {
      updateEditorStateForSnapshot(after, change, offsetIndex);
      void tick().then(() => {
        updateCursorPosition();
        syncActiveTabState();
        if (options.keepRenderCaretVisible) {
          keepEditorCaretVisibleDuringEdit();
        } else {
          syncEditorCaretVisibilityForCurrentMode();
        }
      });
      return;
    }
    applyEditorSnapshot(after, options.selectionAlreadyApplied ?? false, change, offsetIndex);
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
    const inputResult = getSnapshotFromTextareaInput(
      before,
      getTextOffsetIndex(before.content),
      target.value,
      target.selectionStart,
      target.selectionEnd
    );
    const inputType = pendingInput?.inputType ?? 'input';
    const mergeKey = getNativeInputMergeKey(inputType, before, pendingInput?.isComposing ?? isComposingEditorText);

    commitEditorEdit(before, inputResult.snapshot, {
      mergeKey,
      selectionAlreadyApplied: true,
      syncRenderCaretAfterUpdate: true,
      change: inputResult.change,
      offsetIndex: inputResult.offsetIndex
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

    if (isRenderMode && isActiveDocumentRenderEnabled && textareaEl) {
      const { start, end } = getTextareaSelectionInContent();
      if (shouldBlockPartialFencedCodeSelectionEdit(start, end)) {
        event.preventDefault();
        pendingNativeInput = null;
        return;
      }
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

  $effect(() => {
    void [
      isRenderMode,
      shouldRenderHighlightLayer,
      hasEditorSelection,
      fileContent,
      startLine,
      endLine,
      scrollTop,
      scrollLeft,
      editorViewportWidth,
      measuredLineHeight,
      currentFontSize,
      currentRenderFontFamilyCSS,
      activeColors.renderFontWeight,
      tabSize
    ];
    scheduleRenderedSelectionHighlight();
  });

  onDestroy(() => {
    documentDiagnosticWorkerClient?.dispose();
    renderedLineResizeObserver?.disconnect();
    renderedLineResizeObserver = null;
    if (renderedSelectionHighlightFrame !== null) {
      cancelAnimationFrame(renderedSelectionHighlightFrame);
    }
    if (startupUpdateTimer) {
      clearTimeout(startupUpdateTimer);
      startupUpdateTimer = null;
    }
    if (transientStatusTimer) {
      clearTimeout(transientStatusTimer);
      transientStatusTimer = null;
    }
    if (availableAppUpdate && !isInstallingUpdate) {
      void closeAppUpdate(availableAppUpdate);
      availableAppUpdate = null;
    }
    clearRenderedSelectionHighlight();
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

  interface RenderLineIndentResult {
    text: string;
    mapRelativeOffset: (offset: number) => number;
  }

  function getEditorIndentColumns(indent: string): number {
    let columns = 0;
    for (const char of indent) {
      if (char === '\t') {
        columns += editorIndentUnit.length - (columns % editorIndentUnit.length);
      } else {
        columns += 1;
      }
    }
    return columns;
  }

  function getEditorIndentLevel(indent: string): number {
    return Math.floor(getEditorIndentColumns(indent) / editorIndentUnit.length);
  }

  function getRenderOutdentCount(indent: string): number {
    if (indent.startsWith('\t')) return 1;
    return Math.min(indent.match(/^ {1,4}/)?.[0].length ?? 0, editorIndentUnit.length);
  }

  function getRenderLineIndentResult(lineText: string, outdent: boolean): RenderLineIndentResult {
    const marker = getListMarkerAtStart(lineText);
    const oldIndent = marker?.indent ?? getLeadingWhitespace(lineText);
    const removeCount = outdent ? getRenderOutdentCount(oldIndent) : 0;
    if (outdent && removeCount === 0) {
      return {
        text: lineText,
        mapRelativeOffset: (offset) => offset
      };
    }

    const nextIndent = outdent
      ? oldIndent.slice(removeCount)
      : `${editorIndentUnit}${oldIndent}`;
    const oldBodyStart = marker
      ? oldIndent.length + marker.marker.length
      : oldIndent.length;
    const nextMarker = marker
      ? getListMarkerForIndentLevel(
          getEditorIndentLevel(nextIndent),
          marker.spacing,
          marker.separator === 'unordered' ? 'unordered' : 'ordered'
        )
      : '';
    const nextBodyStart = nextIndent.length + nextMarker.length;
    const nextText = `${nextIndent}${nextMarker}${lineText.slice(oldBodyStart)}`;

    return {
      text: nextText,
      mapRelativeOffset: (offset) => {
        if (offset <= oldIndent.length) {
          return outdent
            ? Math.max(0, offset - removeCount)
            : offset + editorIndentUnit.length;
        }

        if (marker && offset < oldBodyStart) {
          const markerOffset = offset - oldIndent.length;
          return nextIndent.length + Math.min(markerOffset, nextMarker.length);
        }

        return nextBodyStart + (offset - oldBodyStart);
      }
    };
  }

  function getRenderListLineLayout(lineIndex: number): RenderListLineLayout | null {
    return renderLineLayout.listLayouts[lineIndex] ?? null;
  }

  function getRenderListBodyStart(lineIndex: number, layout: RenderListLineLayout): number {
    return (lineStartOffsets[lineIndex] ?? 0) + layout.prefixLength;
  }

  function getRenderListBodyColumnWidth(layout: RenderListLineLayout): number {
    return Math.max(1, measureEditorTextWidth(`${layout.marker.indent}${layout.marker.marker}`));
  }

  function getRenderListLineStyle(layout: RenderListLineLayout): string {
    return `--list-prefix-width: ${getRenderListBodyColumnWidth(layout)}px;`;
  }

  function handleRenderListBoundaryArrowLeft(event: KeyboardEvent): boolean {
    if (!textareaEl || event.isComposing || event.key !== 'ArrowLeft') return false;
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false;

    const { start, end } = getTextareaSelectionInContent();
    if (start !== end) return false;

    const lineIndex = findLineIndexForOffset(start);
    const layout = getRenderListLineLayout(lineIndex);
    if (!layout || layout.ownerLineIndex === lineIndex || layout.prefixLength === 0) return false;
    if (start !== getRenderListBodyStart(lineIndex, layout)) return false;

    const previousLine = getPreviousLineBounds(fileContent, lineStartOffsets[lineIndex] ?? 0);
    if (!previousLine) return false;

    event.preventDefault();
    closeActiveUndoGroup();
    setTextareaSelectionFromContent(previousLine.end, previousLine.end);
    updateCursorPosition();
    keepEditorCaretVisibleDuringEdit();
    return true;
  }

  function handleRenderListMarkerBackspace(event: KeyboardEvent): boolean {
    if (!textareaEl || event.isComposing || event.key !== 'Backspace') return false;
    if (event.ctrlKey || event.altKey || event.metaKey) return false;

    const { start, end } = getTextareaSelectionInContent();
    if (start !== end) return false;

    const lineStart = getLineStartOffset(fileContent, start);
    const lineEnd = getLineEndOffset(fileContent, start);
    const edit = getListMarkerBackspaceEdit(
      fileContent.slice(lineStart, lineEnd),
      start - lineStart
    );
    if (!edit) return false;

    event.preventDefault();
    const nextCaret = lineStart + edit.caret;
    commitRenderEditorEdit(
      `${fileContent.slice(0, lineStart)}${edit.text}${fileContent.slice(lineEnd)}`,
      { start: nextCaret, end: nextCaret }
    );
    return true;
  }

  function handleRenderListContinuationBackspace(event: KeyboardEvent): boolean {
    if (!textareaEl || event.isComposing || event.key !== 'Backspace') return false;
    if (event.ctrlKey || event.altKey || event.metaKey) return false;

    const { start, end } = getTextareaSelectionInContent();
    if (start !== end) return false;

    const lineIndex = findLineIndexForOffset(start);
    const layout = getRenderListLineLayout(lineIndex);
    if (!layout || layout.ownerLineIndex === lineIndex) return false;
    if (start !== getRenderListBodyStart(lineIndex, layout)) return false;

    const lineStart = lineStartOffsets[lineIndex] ?? 0;
    const previousLine = getPreviousLineBounds(fileContent, lineStart);
    if (!previousLine) return false;

    event.preventDefault();
    const nextContent = `${fileContent.slice(0, previousLine.end)}${fileContent.slice(start)}`;
    commitRenderEditorEdit(nextContent, {
      start: previousLine.end,
      end: previousLine.end
    });
    return true;
  }

  function getLineIndentOffsetDelta(
    offset: number,
    absoluteLineStart: number,
    originalLine: string,
    result: RenderLineIndentResult,
    moveFromLineStart: boolean
  ): number {
    if (offset < absoluteLineStart) return 0;
    if (offset === absoluteLineStart && !moveFromLineStart) return 0;

    const absoluteLineEnd = absoluteLineStart + originalLine.length;
    const totalDelta = result.text.length - originalLine.length;
    if (offset >= absoluteLineEnd) return totalDelta;

    const relativeOffset = offset - absoluteLineStart;
    return result.mapRelativeOffset(relativeOffset) - relativeOffset;
  }

  function handleRenderTabIndent(event: KeyboardEvent): boolean {
    if (!textareaEl || event.isComposing) return false;
    if (event.key !== 'Tab') return false;
    if (event.ctrlKey || event.altKey || event.metaKey) return false;

    event.preventDefault();

    const { start, end } = getTextareaSelectionInContent();
    const bounds = getSelectedLineBounds(fileContent, start, end);

    const moveFromLineStart = start === end;
    let startDelta = 0;
    let endDelta = 0;
    const nextLineContent = transformSelectedLines(
      fileContent,
      bounds.start,
      bounds.end,
      (lineText, absoluteLineStart) => {
        const result = getRenderLineIndentResult(lineText, event.shiftKey);
        startDelta += getLineIndentOffsetDelta(
          start,
          absoluteLineStart,
          lineText,
          result,
          moveFromLineStart
        );
        endDelta += getLineIndentOffsetDelta(
          end,
          absoluteLineStart,
          lineText,
          result,
          moveFromLineStart
        );
        return result.text;
      }
    );

    if (nextLineContent === fileContent) return true;

    commitRenderEditorEdit(nextLineContent, {
      start: start + startDelta,
      end: end + endDelta
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

  function getNextLineStartOffset(text: string, lineEnd: number): number | null {
    if (lineEnd >= text.length) return null;
    if (text.startsWith('\r\n', lineEnd)) return lineEnd + 2;
    if (text[lineEnd] === '\n' || text[lineEnd] === '\r') return lineEnd + 1;
    return null;
  }


  function getLineEndingLabel(text: string): string {
    const lineEndings = new Set<string>();
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === '\r') {
        if (text[index + 1] === '\n') {
          lineEndings.add('CRLF');
          index += 1;
        } else {
          lineEndings.add('CR');
        }
      } else if (text[index] === '\n') {
        lineEndings.add('LF');
      }
    }
    return lineEndings.size > 0 ? [...lineEndings].join('/') : 'LF';
  }

  function getTextEncodingLabel(encoding: TextEncoding): string {
    switch (encoding) {
      case 'utf8Bom':
        return 'UTF-8 BOM';
      case 'utf16Le':
        return 'UTF-16 LE';
      case 'utf16Be':
        return 'UTF-16 BE';
      default:
        return 'UTF-8';
    }
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

  function handleRenderFencedCodeSelectionEdit(event: KeyboardEvent): boolean {
    if (!textareaEl || event.isComposing) return false;
    if (event.key !== 'Backspace' && event.key !== 'Delete' && event.key !== 'Enter') return false;

    const { start, end } = getTextareaSelectionInContent();
    if (!shouldBlockPartialFencedCodeSelectionEdit(start, end)) return false;

    event.preventDefault();
    return true;
  }

  function handleRenderFencedCodeBlockBackspace(event: KeyboardEvent): boolean {
    if (!textareaEl || event.isComposing || event.key !== 'Backspace') return false;

    const { start, end } = getTextareaSelectionInContent();
    if (start !== end) return false;

    const lineStart = getLineStartOffset(fileContent, start);
    if (!/^[ \t]*$/.test(fileContent.slice(lineStart, start))) return false;

    const block = fencedCodeBlocks.find((candidate) => (
      candidate.closingLineStart !== undefined
      && candidate.closingLineEnd !== undefined
      && candidate.afterBlockStart === lineStart
      && candidate.afterBlockStart > candidate.closingLineEnd
    ));
    const closingLineStart = block?.closingLineStart;
    const closingLineEnd = block?.closingLineEnd;
    if (!block || closingLineStart === undefined || closingLineEnd === undefined) return false;

    const openingLine = fileContent.slice(block.openingLineStart, block.openingLineEnd);
    const closingLine = fileContent.slice(closingLineStart, closingLineEnd);
    const openingFence = openingLine.match(/^([ \t]*)(`{3,})/);
    const closingFence = closingLine.match(/^([ \t]*)(`{3,})([ \t]*)$/);
    if (!openingFence?.[2] || !closingFence?.[2]) return false;

    const openingFenceStart = block.openingLineStart + openingFence[1].length;
    const openingFenceEnd = openingFenceStart + openingFence[2].length;
    const closingFenceStart = closingLineStart + closingFence[1].length;
    const closingFenceEnd = closingFenceStart + closingFence[2].length;
    const openingRemovedBacktickCount = openingFence[2].length - 2;
    const nextContent = `${fileContent.slice(0, openingFenceStart)}\`\`${fileContent.slice(openingFenceEnd, closingFenceStart)}\`\`${fileContent.slice(closingFenceEnd)}`;

    event.preventDefault();
    const nextCaret = closingFenceStart - openingRemovedBacktickCount + 2;
    commitRenderEditorEdit(nextContent, { start: nextCaret, end: nextCaret });
    return true;
  }

  function handleRenderFencedCodeBoundaryDeletion(event: KeyboardEvent): boolean {
    if (!textareaEl || event.isComposing) return false;
    if (event.key !== 'Backspace' && event.key !== 'Delete') return false;

    const { start, end } = getTextareaSelectionInContent();
    if (start !== end) return false;

    const crossesProtectedBoundary = fencedCodeBlocks.some((block) => {
      if (event.key === 'Backspace') {
        return block.contentStart > block.openingLineEnd && start === block.contentStart;
      }

      if (block.closingBoundaryStart !== undefined && start === block.closingBoundaryStart) {
        return true;
      }

      const previousLine = getPreviousLineBounds(fileContent, block.openingLineStart);
      return previousLine?.end === start;
    });
    if (!crossesProtectedBoundary) return false;

    event.preventDefault();
    return true;

  }

  function getPreviousListMarker(
    text: string,
    lineStart: number,
    currentMarker: ListMarker
  ): ListMarker | null {
    const previousLineBounds = getPreviousLineBounds(text, lineStart);
    if (!previousLineBounds) return null;

    const previousMarker = getListMarkerAtStart(
      text.slice(previousLineBounds.start, previousLineBounds.end)
    );
    if (
      !previousMarker
      || previousMarker.indent !== currentMarker.indent
      || previousMarker.separator !== currentMarker.separator
    ) return null;

    return previousMarker;
  }

  function getMeasuredListContinuationIndent(marker: ListMarker): string {
    const fallbackIndent = getListContinuationIndent(marker, tabSize);
    const indentWidth = measureEditorTextWidth(marker.indent);
    const bodyStartWidth = measureEditorTextWidth(`${marker.indent}${marker.marker}`);
    const spaceWidth = measureEditorPlainTextWidth(' ');
    if (spaceWidth <= 0 || bodyStartWidth <= indentWidth) return fallbackIndent;

    const additionalSpaceCount = Math.max(
      1,
      Math.round((bodyStartWidth - indentWidth) / spaceWidth)
    );
    return `${marker.indent}${' '.repeat(additionalSpaceCount)}`;
  }

  function getListContinuationOwner(
    text: string,
    lineStart: number,
    lineText: string
  ): { marker: ListMarker; lineStart: number } | null {
    if (getListMarkerAtStart(lineText)) return null;

    const continuationIndent = getLeadingWhitespace(lineText);
    if (continuationIndent.length === 0) return null;

    const continuationColumns = getEditorIndentColumns(continuationIndent);
    let previousLineBounds = getPreviousLineBounds(text, lineStart);
    while (previousLineBounds) {
      const previousLine = text.slice(previousLineBounds.start, previousLineBounds.end);
      if (/^[ \t]*$/.test(previousLine)) return null;

      const previousMarker = getListMarkerAtStart(previousLine);
      if (previousMarker) {
        if (getMeasuredListContinuationIndent(previousMarker) === continuationIndent) {
          return { marker: previousMarker, lineStart: previousLineBounds.start };
        }
        if (getEditorIndentColumns(previousMarker.indent) < continuationColumns) return null;
      } else if (getEditorIndentColumns(getLeadingWhitespace(previousLine)) < continuationColumns) {
        return null;
      }

      previousLineBounds = getPreviousLineBounds(text, previousLineBounds.start);
    }

    return null;
  }

  function commitRenderNextListItem(
    event: KeyboardEvent,
    start: number,
    end: number,
    currentLineEnd: number,
    ownerLineStart: number,
    currentMarker: ListMarker
  ): boolean {
    const previousMarker = getPreviousListMarker(fileContent, ownerLineStart, currentMarker);
    const nextLabel = getNextListMarkerLabel(currentMarker.label, previousMarker?.label ?? null);
    if (!nextLabel) return false;

    const nextMarker = formatListMarker(nextLabel, currentMarker.separator, currentMarker.spacing);
    const insertText = `${getPreferredNewline(fileContent, start)}${currentMarker.indent}${nextMarker}`;
    const followingLineStart = getNextLineStartOffset(fileContent, currentLineEnd);
    const renumberedContent = followingLineStart === null
      ? fileContent
      : renumberFollowingListMarkerSequence(
          fileContent,
          followingLineStart,
          currentMarker,
          previousMarker?.label ?? null,
          nextLabel,
          editorIndentUnit.length
        );

    event.preventDefault();
    commitRenderEditorEdit(`${renumberedContent.slice(0, start)}${insertText}${renumberedContent.slice(end)}`, {
      start: start + insertText.length,
      end: start + insertText.length
    });
    return true;
  }

  function handleRenderExitEmptyListEnter(event: KeyboardEvent): boolean {
    if (!textareaEl || event.isComposing) return false;
    if (event.key !== 'Enter') return false;
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false;

    const { start, end } = getTextareaSelectionInContent();
    if (start !== end) return false;

    const lineStart = getLineStartOffset(fileContent, start);
    const lineEnd = getLineEndOffset(fileContent, start);
    const currentMarker = getListMarkerAtStart(fileContent.slice(lineStart, lineEnd));
    if (!currentMarker) return false;

    const markerStart = lineStart + currentMarker.indent.length;
    const markerEnd = markerStart + currentMarker.marker.length;
    if (start !== lineEnd || markerEnd !== lineEnd) return false;

    event.preventDefault();
    commitRenderEditorEdit(`${fileContent.slice(0, markerStart)}${fileContent.slice(markerEnd)}`, {
      start: markerStart,
      end: markerStart
    });
    return true;
  }

  function handleRenderContinueListEnter(event: KeyboardEvent): boolean {
    if (!textareaEl || event.isComposing) return false;
    if (event.key !== 'Enter') return false;
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false;

    const { start, end } = getTextareaSelectionInContent();
    if (start !== end) return false;

    const lineStart = getLineStartOffset(fileContent, start);
    const lineEnd = getLineEndOffset(fileContent, start);
    const currentMarker = getListMarkerAtStart(fileContent.slice(lineStart, lineEnd));
    if (!currentMarker) return false;

    const markerEnd = lineStart + currentMarker.indent.length + currentMarker.marker.length;
    if (start < markerEnd) return false;

    return commitRenderNextListItem(event, start, end, lineEnd, lineStart, currentMarker);
  }

  function handleRenderListContinuationEnter(event: KeyboardEvent): boolean {
    if (!textareaEl || event.isComposing) return false;
    if (event.key !== 'Enter') return false;
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false;

    const { start, end } = getTextareaSelectionInContent();
    if (start !== end) return false;

    const lineStart = getLineStartOffset(fileContent, start);
    const lineEnd = getLineEndOffset(fileContent, start);
    const currentLine = fileContent.slice(lineStart, lineEnd);
    const owner = getListContinuationOwner(fileContent, lineStart, currentLine);
    if (!owner) return false;

    const continuationIndent = getLeadingWhitespace(currentLine);
    if (start < lineStart + continuationIndent.length) return false;

    return commitRenderNextListItem(event, start, end, lineEnd, owner.lineStart, owner.marker);
  }

  function handleRenderListSoftBreakEnter(event: KeyboardEvent): boolean {
    if (!textareaEl || event.isComposing) return false;
    if (event.key !== 'Enter' || !event.shiftKey) return false;
    if (event.ctrlKey || event.altKey || event.metaKey) return false;

    const { start, end } = getTextareaSelectionInContent();
    if (start !== end) return false;

    const lineStart = getLineStartOffset(fileContent, start);
    const lineEnd = getLineEndOffset(fileContent, start);
    const currentMarker = getListMarkerAtStart(fileContent.slice(lineStart, lineEnd));
    if (!currentMarker) return false;

    const markerEnd = lineStart + currentMarker.indent.length + currentMarker.marker.length;
    if (start < markerEnd) return false;

    const continuationIndent = getMeasuredListContinuationIndent(currentMarker);
    const insertText = `${getPreferredNewline(fileContent, start)}${continuationIndent}`;

    event.preventDefault();
    commitRenderEditorEdit(`${fileContent.slice(0, start)}${insertText}${fileContent.slice(end)}`, {
      start: start + insertText.length,
      end: start + insertText.length
    });
    return true;
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

    const { start, end } = getTextareaSelectionInContent();
    if (start !== end) return false;

    if (renderAutoClosingCharacters.has(event.key) && fileContent[start] === event.key) {
      event.preventDefault();
      closeActiveUndoGroup();
      const nextCaret = start + event.key.length;
      setTextareaSelectionFromContent(nextCaret, nextCaret);
      updateCursorPosition();
      keepEditorCaretVisibleDuringEdit();
      return true;
    }

    if (!canInsertAutoPairAt(fileContent, start, renderAutoPairAllowedFollowingStrings)) return false;

    if (
      event.key === '`'
      && start >= 2
      && fileContent.slice(start - 2, start) === '``'
      && fileContent[start] !== '`'
    ) {
      const lineStart = getLineStartOffset(fileContent, start);
      const lineIndent = fileContent.slice(lineStart, start - 2);
      if (/^[ \t]*$/.test(lineIndent)) {
        event.preventDefault();

        const newline = getPreferredNewline(fileContent, start);
        const replacementStart = start - 2;
        const codeBlock = `\`\`\`${newline}${lineIndent}${newline}${lineIndent}\`\`\`${newline}${lineIndent}`;
        const nextContent = `${fileContent.slice(0, replacementStart)}${codeBlock}${fileContent.slice(end)}`;
        const nextCaret = replacementStart + 3 + newline.length + lineIndent.length;
        commitRenderEditorEdit(nextContent, {
          start: nextCaret,
          end: nextCaret
        });
        return true;
      }
    }

    const closingChar = renderAutoClosingPairs[event.key];
    if (!closingChar) return false;

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
    if (handleRenderListBoundaryArrowLeft(event)) return;
    if (handleRenderListSoftBreakEnter(event)) return;
    if (handleRenderExitEmptyListEnter(event)) return;
    if (handleRenderContinueListEnter(event)) return;
    if (handleRenderListContinuationEnter(event)) return;
    if (handleRenderPreserveIndentEnter(event)) return;
    if (handleRenderListMarkerBackspace(event)) return;
    if (handleRenderListContinuationBackspace(event)) return;
    if (handleRenderEmptyIndentedLineBackspace(event)) return;
    if (handleRenderTabIndent(event)) return;
    if (handleRenderIndentBackspace(event)) return;
    if (handleRenderAutoPairBackspace(event)) return;
    if (handleRenderAutoSubstitutionSpace(event)) return;
    handleRenderAutoPairInput(event);
  }

  function handleEditorKeyDown(event: KeyboardEvent) {
    if (editorMovementKeys.has(event.key)) {
      pendingRenderCaretMovementDirection = event.key === 'ArrowLeft'
        || event.key === 'ArrowUp'
        || event.key === 'Home'
        || event.key === 'PageUp'
        ? -1
        : 1;
      closeActiveUndoGroup();
    }

    if (!isRenderMode) return;
    if (handleRenderFencedCodeSelectionEdit(event)) return;
    if (handleRenderFencedCodeBlockBackspace(event)) return;
    if (handleRenderFencedCodeBoundaryDeletion(event)) return;
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
      const openedFile = await invoke<OpenedFile | null>("open_file_dialog", {
        filters: getOpenFileDialogFilters(locale)
      });

      if (openedFile) {
        openFile(openedFile);
      }
    } catch (err: any) {
      errorMsg = localizeError('error.readFile', err);
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

  async function handleTitlebarMouseDown(event: MouseEvent) {
    if (!hasTauriRuntime() || event.buttons !== 1 || event.detail > 2) return;
    event.preventDefault();
    const appWindow = getCurrentWindow();

    if (event.detail === 2) {
      await appWindow.toggleMaximize().catch((err) => {
        console.error('Failed to toggle the window maximized state:', err);
      });
      await refreshWindowMaximizedState();
      return;
    }

    await appWindow.startDragging().catch((err) => {
      console.error('Failed to start dragging the window:', err);
    });
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
          title: t('settings.windowTitle'),
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
        await message(localizeError('error.openSettings', err));
      } catch {}
      console.error('Failed to open settings window:', err);
    }
  }

  // 메뉴 제어
  function toggleDropdown(menu: 'file' | 'edit' | 'help', event: MouseEvent) {
    event.stopPropagation();
    if (openDropdown === menu) {
      openDropdown = null;
    } else {
      openDropdown = menu;
    }
  }

  function handleMouseEnter(menu: 'file' | 'edit' | 'help') {
    if (openDropdown !== null) {
      openDropdown = menu;
    }
  }

  function closeAllDropdown() {
    openDropdown = null;
    isTabOverflowMenuOpen = false;
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
    if (isRenderMode && isActiveDocumentRenderEnabled && shouldBlockPartialFencedCodeSelectionEdit(start, end)) {
      closeAllDropdown();
      return;
    }
    const now = new Date();

    const timeStr = now.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
    const dateStr = now.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' });

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
    if (isRenderMode && isActiveDocumentRenderEnabled && shouldBlockPartialFencedCodeSelectionEdit(start, end)) {
      closeAllDropdown();
      return;
    }

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
      if (isRenderMode && isActiveDocumentRenderEnabled && shouldBlockPartialFencedCodeSelectionEdit(start, end)) {
        closeAllDropdown();
        return;
      }

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
    if (isRenderMode && isActiveDocumentRenderEnabled) {
      const blocksProtectedBoundary = start === end && fencedCodeBlocks.some((block) => (
        block.closingBoundaryStart === start
        || getPreviousLineBounds(fileContent, block.openingLineStart)?.end === start
      ));
      if (blocksProtectedBoundary || shouldBlockPartialFencedCodeSelectionEdit(start, end)) {
        closeAllDropdown();
        return;
      }
    }

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
      ? getCurrentWindow().listen<number>("native-horizontal-wheel", (event: TauriEvent<number>) => {
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
    if (isAboutDialogOpen) return;

    const key = e.key.toLowerCase();

    if (e.key === 'Escape') {
      closeAllDropdown();
      const transfer = getActiveOutgoingTabTransfer();
      if (pendingPointerTabDrag || transfer) e.preventDefault();
      pendingPointerTabDrag = null;
      draggedTabId = null;
      foreignTabDragTransferId = null;
      tabDragPreview = null;
      if (transfer) {
        transfer.handledInCurrentWindow = true;
        cleanupOutgoingTabTransfer(transfer);
      }
      clearTabDropTarget();
    } else if (!isSettingsWindow && e.ctrlKey && key === 'z') {
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

  function getMarkdownHeadingLineStyle(level: MarkdownHeadingLevel | undefined): string {
    if (!level) return '';
    const style = markdownRenderSettings.headings[level];
    return `--markdown-heading-size: ${style.sizePercent}%; --markdown-heading-weight: ${style.fontWeight};`;
  }

  function getTokenClass(token: Token): string {
    const classes = [`hl-${token.type}`];
    if (token.hiddenSyntax) {
      classes.push('hl-syntax-hidden');
    }
    if (token.type === 'boolean') {
      if (token.text === 'true') {
        classes.push('hl-boolean-true');
      } else if (token.text === 'false') {
        classes.push('hl-boolean-false');
      }
    }
    if (token.type === 'keyword') {
      const normalized = (token.text || '').trim().toLowerCase();
      if (normalized) classes.push(`hl-keyword-${normalized}`);
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

    const lineElements = editorViewportEl.querySelectorAll<HTMLElement>('.backdrop-line');
    let nearestLine: HTMLElement | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const lineElement of lineElements) {
      const rect = lineElement.getBoundingClientRect();
      if (clientY >= rect.top && clientY < rect.bottom) return lineElement;

      const distance = clientY < rect.top ? rect.top - clientY : clientY - rect.bottom;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestLine = lineElement;
      }
    }

    return nearestLine;
  }



  function getRenderedCaretRectAtBoundary(
    lineElement: HTMLElement,
    boundary: RenderedTextBoundary
  ): DOMRect | null {
    const range = document.createRange();
    range.setStart(boundary.node, boundary.offset);
    range.collapse(true);
    let rect: DOMRect | null = range.getClientRects()[0] ?? null;
    if (rect && rect.height <= 0) rect = null;

    if (!rect && boundary.offset < boundary.node.data.length) {
      range.setEnd(boundary.node, boundary.offset + 1);
      rect = range.getClientRects()[0] ?? null;
      if (rect && rect.height <= 0) rect = null;
    } else if (!rect && boundary.offset > 0) {
      range.setStart(boundary.node, boundary.offset - 1);
      range.setEnd(boundary.node, boundary.offset);
      const rects = range.getClientRects();
      const previousRect = rects[rects.length - 1];
      if (previousRect && previousRect.height > 0) {
        rect = new DOMRect(previousRect.right, previousRect.top, 0, previousRect.height);
      }
    }

    if (!rect) return null;

    const lineRect = lineElement.getBoundingClientRect();
    const rowIndex = Math.max(0, Math.round((rect.top - lineRect.top) / measuredLineHeight));
    return new DOMRect(
      rect.left,
      lineRect.top + rowIndex * measuredLineHeight,
      1,
      measuredLineHeight
    );
  }



  function getRenderedCaretRectFromLineText(
    lineElement: HTMLElement,
    lineText: string,
    offsetInLine: number
  ): DOMRect | null {
    const lineContent = lineElement.querySelector<HTMLElement>('.line-content');
    if (!lineContent) return null;

    const targetOffset = clamp(offsetInLine, 0, lineText.length);
    const listBody = lineContent.querySelector<HTMLElement>('.list-item-body');
    const listBodyStart = Number(lineContent.dataset.listBodyStart);
    if (
      listBody
      && Number.isFinite(listBodyStart)
      && targetOffset === listBodyStart
      && lineText.length === listBodyStart
    ) {
      const bodyRect = listBody.getBoundingClientRect();
      const lineRect = lineElement.getBoundingClientRect();
      return new DOMRect(bodyRect.left, lineRect.top, 1, measuredLineHeight);
    }
    if (lineText.length === 0) {
      const lineRect = lineElement.getBoundingClientRect();
      const lineContentRect = lineContent.getBoundingClientRect();
      const lineContentStyle = getComputedStyle(lineContent);
      const paddingLeft = Number.parseFloat(lineContentStyle.paddingLeft) || 0;
      return new DOMRect(
        lineContentRect.width > 0 ? lineContentRect.left + paddingLeft : lineRect.left + getEditorTextPaddingLeft(),
        lineRect.top,
        1,
        measuredLineHeight
      );
    }

    const boundary = getTextNodeBoundary(lineContent, targetOffset, true);
    return boundary ? getRenderedCaretRectAtBoundary(lineElement, boundary) : null;
  }

  function getRenderedLineTextOffsetAtPoint(
    lineElement: HTMLElement,
    lineText: string,
    clientX: number,
    clientY: number
  ): number {
    if (lineText.length === 0) return 0;
    const lineContent = lineElement.querySelector<HTMLElement>('.line-content');
    if (!lineContent) return 0;
    const listBodyStart = Number(lineContent.dataset.listBodyStart);
    const clampToListBody = (offset: number) => Number.isFinite(listBodyStart)
      ? Math.max(listBodyStart, offset)
      : offset;


    const nativeOffset = getNativeCaretTextOffsetAtPoint(
      lineContent,
      lineText.length,
      clientX,
      clientY
    );
    if (nativeOffset !== null) return clampToListBody(nativeOffset);

    const boundaries = createRenderedTextBoundaryIndex(lineContent, lineText.length);
    return clampToListBody(findClosestRenderedTextOffset(
      lineText.length,
      clientX,
      clientY,
      Math.max(editorViewportWidth, 1),
      (offset) => {
        const boundary = boundaries.getBoundary(offset);
        return boundary ? getRenderedCaretRectAtBoundary(lineElement, boundary) : null;
      }
    ));
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

  function getInlineCodeDelimiterCaretOffsetAtPoint(
    lineElement: HTMLElement,
    clientX: number,
    clientY: number
  ): number | null {
    const lineContent = lineElement.querySelector<HTMLElement>('.line-content');
    if (!lineContent) return null;

    const hiddenSyntaxElements = lineElement.querySelectorAll<HTMLElement>('.hl-syntax-hidden');
    for (const element of hiddenSyntaxElements) {
      const rect = element.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        continue;
      }

      const codeElement = element.parentElement;
      if (!codeElement?.classList.contains('hl-code')) continue;

      const delimiters = Array.from(codeElement.children)
        .filter((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains('hl-syntax-hidden'));
      if (delimiters[0] !== element && delimiters[delimiters.length - 1] !== element) continue;

      const prefixRange = document.createRange();
      prefixRange.selectNodeContents(lineContent);
      prefixRange.setEndBefore(element);
      const delimiterStart = prefixRange.toString().length;
      return delimiters[0] === element
        ? delimiterStart + (element.textContent?.length ?? 0)
        : delimiterStart;
    }

    return null;
  }

  function getHiddenHeadingMarkerCaretOffsetAtPoint(
    lineElement: HTMLElement,
    clientX: number,
    clientY: number
  ): number | null {
    const marker = lineElement.querySelector<HTMLElement>('.hl-heading-marker.hl-syntax-hidden');
    if (!marker) return null;
    const rect = marker.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return null;
    }
    const end = Number(marker.dataset.tokenEnd);
    return Number.isFinite(end) ? end : null;
  }

  function getRenderedCaretOffsetAtPoint(clientX: number, clientY: number): number | null {
    const lineElement = getRenderedLineElementAtPoint(clientY);
    if (!lineElement) return null;

    const lineIndex = Number(lineElement.dataset.lineIndex);
    if (!Number.isFinite(lineIndex)) return null;

    const lineStart = lineStartOffsets[lineIndex] ?? 0;
    const lineText = getLineTextForLayout(fileContent, lineStartOffsets, lineIndex);
    const headingMarkerOffset = getHiddenHeadingMarkerCaretOffsetAtPoint(lineElement, clientX, clientY);
    if (headingMarkerOffset !== null) return headingMarkerOffset;
    const inlineCodeDelimiterOffset = getInlineCodeDelimiterCaretOffsetAtPoint(lineElement, clientX, clientY);
    if (inlineCodeDelimiterOffset !== null) return lineStart + inlineCodeDelimiterOffset;

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
    const beforeContent = fileContent;
    const nextContent = `${beforeContent.slice(0, start)}${nextValue}${beforeContent.slice(end)}`;
    latestContentChange = getTextChange(beforeContent, nextContent);
    textOffsetIndex = createTextOffsetIndex(nextContent);
    fileContent = nextContent;
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
      <aside class="settings-sidebar" aria-label={t('settings.sidebarLabel')}>
        <button
          type="button"
          class="sidebar-item"
          class:active={activeSettingsView === 'general'}
          onclick={() => activeSettingsView = 'general'}
        >
          <Settings size={16} class="tab-icon"/> {t('settings.general')}
        </button>

        <div class="sidebar-tree-group">
          <button
            type="button"
            class="sidebar-group"
            aria-expanded={isSourceSettingsExpanded}
            onclick={() => isSourceSettingsExpanded = !isSourceSettingsExpanded}
          >
            <ChevronDown size={14} class={isSourceSettingsExpanded ? 'tree-chevron' : 'tree-chevron collapsed'}/>
            <FileCode2 size={16} class="tab-icon"/> {t('settings.sourceMode')}
          </button>
          {#if isSourceSettingsExpanded}
            <button
              type="button"
              class="sidebar-item tree-child"
              class:active={activeSettingsView === 'sourceAppearance'}
              onclick={() => activeSettingsView = 'sourceAppearance'}
            >
              <PaintRoller size={15} class="tab-icon"/> {t('settings.appearance')}
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
            <PaintRoller size={16} class="tab-icon"/> {t('settings.renderMode')}
          </button>
          {#if isRenderSettingsExpanded}
            <button
              type="button"
              class="sidebar-item tree-child"
              class:active={activeSettingsView === 'renderAppearance'}
              onclick={() => activeSettingsView = 'renderAppearance'}
            >
              <PaintRoller size={15} class="tab-icon"/> {t('settings.appearance')}
            </button>
            <button
              type="button"
              class="sidebar-item tree-child"
              class:active={activeSettingsView === 'renderEditing'}
              onclick={() => activeSettingsView = 'renderEditing'}
            >
              <PenLine size={15} class="tab-icon"/> {t('settings.editing')}
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
                  {:else if category.id === 'subtitle'}
                    <FileText size={15} class="tab-icon"/>
                  {:else}
                    <Code2 size={15} class="tab-icon"/>
                  {/if}
                  {t(category.labelKey)}
                </button>
                {#if expandedFormatCategories[category.id]}
                  {#each getDocumentFormatsForCategory(category) as format}
                    <button
                      type="button"
                      class="sidebar-item tree-grandchild"
                      class:active={activeSettingsView === getDocumentFormatSettingsView(format.id)}
                      onclick={() => activeSettingsView = getDocumentFormatSettingsView(format.id)}
                    >
                      <FileCode2 size={14} class="tab-icon"/> {t(format.labelKey)}
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
        {#if activeSettingsView === 'general'}
          <div class="settings-section">
            <h4 class="section-title">{t('settings.languageSection')}</h4>
            <div class="settings-row">
              <label for="language-select-window">{t('settings.languageLabel')}</label>
              <select id="language-select-window" bind:value={languagePreference} class="tab-size-select language-select">
                <option value="system">{t('settings.systemLanguage', { language: getLanguageNativeName(systemLocale) })}</option>
                {#each supportedLanguages as language}
                  <option value={language.code}>{language.nativeName}</option>
                {/each}
              </select>
            </div>
            <p class="settings-category-note">{t('settings.languageDescription')}</p>
          </div>
          <div class="settings-section">
            <h4 class="section-title">{t('settings.transfer.title')}</h4>
            <p class="settings-category-note">{t('settings.transfer.description')}</p>
            <div class="settings-transfer-actions">
              <button
                type="button"
                class="settings-transfer-button"
                disabled={isSettingsTransferBusy}
                onclick={() => void handleImportSettings()}
              >
                <Upload size={15} aria-hidden="true"/>
                {t('settings.transfer.import')}
              </button>
              <button
                type="button"
                class="settings-transfer-button"
                disabled={isSettingsTransferBusy}
                onclick={() => void handleExportSettings()}
              >
                <Download size={15} aria-hidden="true"/>
                {t('settings.transfer.export')}
              </button>
            </div>
            {#if settingsTransferStatus}
              <p
                class="settings-transfer-status"
                class:warning={settingsTransferStatus.kind === 'warning'}
                class:error={settingsTransferStatus.kind === 'error'}
                role={settingsTransferStatus.kind === 'error' ? 'alert' : 'status'}
                aria-live="polite"
              >
                {settingsTransferStatus.message}
              </p>
            {/if}
          </div>
        {:else if activeSettingsView === 'sourceAppearance'}
          <div class="settings-section">
            <h4 class="section-title">{t('settings.fontSettings')}</h4>
            <div class="settings-row">
              <label for="source-font-size-input-window">{t('settings.fontSize')}</label>
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
            <h4 class="section-title">{t('settings.displayAndFont')}</h4>
            <div class="settings-row">
              <label for="render-font-size-input-window">{t('settings.fontSize')}</label>
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
              <label for="tab-size-select-window">{t('settings.indentWidth')}</label>
              <select id="tab-size-select-window" bind:value={tabSize} class="tab-size-select">
                <option value={2}>2</option>
                <option value={4}>4</option>
                <option value={8}>8</option>
              </select>
            </div>

            <div class="settings-row">
              <label for="render-font-family-select-window">{t('settings.renderFont')}</label>
              <select id="render-font-family-select-window" bind:value={renderFontFamily} class="tab-size-select" style="width: 195px; text-align-last: center;">
                <optgroup label={t('settings.fontGroupDefault')}>
                  <option value="nanum-gothic">나눔고딕</option>
                  <option value="notepad">{t('settings.defaultFont')}</option>
                </optgroup>
                <optgroup label={t('settings.fontGroupMonospace')}>
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
              <h4 class="section-title">{t('settings.themeColors')}</h4>

              <div class="theme-edit-toggle">
                <button
                  class="theme-toggle-btn"
                  class:active={editingTheme === 'light'}
                  onclick={() => editingTheme = 'light'}
                >
                  <Sun size={16} class="tab-icon"/> {t('settings.themeLight')}
                </button>
                <button
                  class="theme-toggle-btn"
                  class:active={editingTheme === 'dark'}
                  onclick={() => editingTheme = 'dark'}
                >
                  <Moon size={16} class="tab-icon"/> {t('settings.themeDark')}
                </button>
              </div>
            </div>

            {#if editingTheme === 'dark'}
              {@render colorSettingRow('color-render-bg-window-dark', t('settings.color.renderBackground'), darkColors, 'renderBg')}
              {@render colorSettingRow('color-render-text-window-dark', t('settings.color.renderText'), darkColors, 'renderText')}

              <div class="settings-row color-row">
                <label for="render-font-weight-window-dark">{t('settings.fontWeight')}</label>
                <select id="render-font-weight-window-dark" bind:value={darkColors.renderFontWeight} class="tab-size-select" style="width: 140px;">
                  <option value="300">{t('settings.weightLight')}</option>
                  <option value="400">{t('settings.weightNormal')}</option>
                  <option value="500">{t('settings.weightMedium')}</option>
                  <option value="600">{t('settings.weightSemiBold')}</option>
                  <option value="700">{t('settings.weightBold')}</option>
                </select>
              </div>

              {@render colorSettingRow('color-hl-code-bg-window-dark', t('settings.color.codeBackground'), darkColors, 'codeBg')}
              {@render colorSettingRow('color-hl-code-text-window-dark', t('settings.color.codeText'), darkColors, 'codeText')}
              {@render colorSettingRow('color-hl-key-strong-window-dark', t('settings.color.keyStrong'), darkColors, 'keyStrong')}
              {@render colorSettingRow('color-hl-key-medium-window-dark', t('settings.color.keyMedium'), darkColors, 'keyMedium')}
              {@render colorSettingRow('color-hl-key-light-window-dark', t('settings.color.keyLight'), darkColors, 'keyLight')}
              {@render colorSettingRow('color-hl-string-window-dark', t('settings.color.string'), darkColors, 'string')}
              {@render colorSettingRow('color-hl-number-window-dark', t('settings.color.number'), darkColors, 'number')}
              {@render colorSettingRow('color-hl-list-marker-window-dark', t('settings.color.listMarker'), darkColors, 'listMarker')}
              {@render colorSettingRow('color-hl-comment-window-dark', t('settings.color.comment'), darkColors, 'comment')}
              {@render colorSettingRow('color-hl-paren-window-dark', t('settings.color.parenthesis'), darkColors, 'paren')}
              {@render colorSettingRow('color-hl-bracket-window-dark', t('settings.color.bracket'), darkColors, 'bracket')}
              {@render colorSettingRow('color-hl-brace-window-dark', t('settings.color.brace'), darkColors, 'brace')}
              {@render colorSettingRow('color-indent-guide-window-dark', t('settings.color.indentGuide'), darkColors, 'guide')}
            {:else}
              {@render colorSettingRow('color-render-bg-window-light', t('settings.color.renderBackground'), lightColors, 'renderBg')}
              {@render colorSettingRow('color-render-text-window-light', t('settings.color.renderText'), lightColors, 'renderText')}

              <div class="settings-row color-row">
                <label for="render-font-weight-window-light">{t('settings.fontWeight')}</label>
                <select id="render-font-weight-window-light" bind:value={lightColors.renderFontWeight} class="tab-size-select" style="width: 140px;">
                  <option value="300">{t('settings.weightLight')}</option>
                  <option value="400">{t('settings.weightNormal')}</option>
                  <option value="500">{t('settings.weightMedium')}</option>
                  <option value="600">{t('settings.weightSemiBold')}</option>
                  <option value="700">{t('settings.weightBold')}</option>
                </select>
              </div>

              {@render colorSettingRow('color-hl-code-bg-window-light', t('settings.color.codeBackground'), lightColors, 'codeBg')}
              {@render colorSettingRow('color-hl-code-text-window-light', t('settings.color.codeText'), lightColors, 'codeText')}
              {@render colorSettingRow('color-hl-key-strong-window-light', t('settings.color.keyStrong'), lightColors, 'keyStrong')}
              {@render colorSettingRow('color-hl-key-medium-window-light', t('settings.color.keyMedium'), lightColors, 'keyMedium')}
              {@render colorSettingRow('color-hl-key-light-window-light', t('settings.color.keyLight'), lightColors, 'keyLight')}
              {@render colorSettingRow('color-hl-string-window-light', t('settings.color.string'), lightColors, 'string')}
              {@render colorSettingRow('color-hl-number-window-light', t('settings.color.number'), lightColors, 'number')}
              {@render colorSettingRow('color-hl-list-marker-window-light', t('settings.color.listMarker'), lightColors, 'listMarker')}
              {@render colorSettingRow('color-hl-comment-window-light', t('settings.color.comment'), lightColors, 'comment')}
              {@render colorSettingRow('color-hl-paren-window-light', t('settings.color.parenthesis'), lightColors, 'paren')}
              {@render colorSettingRow('color-hl-bracket-window-light', t('settings.color.bracket'), lightColors, 'bracket')}
              {@render colorSettingRow('color-hl-brace-window-light', t('settings.color.brace'), lightColors, 'brace')}
              {@render colorSettingRow('color-indent-guide-window-light', t('settings.color.indentGuide'), lightColors, 'guide')}
            {/if}

            <div class="settings-action-row">
              <button class="reset-colors-btn" onclick={resetColorsToDefault}>
                {t('settings.resetColors')}
              </button>
            </div>
          </div>
        {:else if activeSettingsView === 'renderEditing'}
          <div class="settings-section">
            <h4 class="section-title">{t('settings.autoInput')}</h4>
            <label class="settings-check-row" for="render-auto-pair-editing-window">
              <input
                id="render-auto-pair-editing-window"
                class="settings-checkbox"
                type="checkbox"
                bind:checked={renderAutoPairEditing}
              />
              <span class="settings-check-copy">
                <span class="settings-check-title">{t('settings.autoPair.title')}</span>
                <span class="settings-check-description">{t('settings.autoPair.description')}</span>
              </span>
            </label>
            <div
              class="auto-pair-following-settings"
              class:disabled={!renderAutoPairEditing}
              aria-disabled={!renderAutoPairEditing}
            >
              <div class="auto-pair-following-heading">
                <span class="settings-check-title">{t('settings.autoPair.followingTitle')}</span>
                <span class="settings-check-description">{t('settings.autoPair.followingDescription')}</span>
              </div>
              <div class="auto-pair-following-list" role="list">
                <span class="auto-pair-following-chip fixed" role="listitem">
                  <span>{t('settings.autoPair.whitespace')}</span>
                  <span class="auto-pair-following-fixed-label">{t('settings.autoPair.alwaysAllowed')}</span>
                </span>
                {#each renderAutoPairAllowedFollowingStrings as value (value)}
                  <span class="auto-pair-following-chip" role="listitem">
                    <code>{value}</code>
                    <button
                      type="button"
                      class="auto-pair-following-remove"
                      aria-label={t('settings.autoPair.removeFollowingString', { value })}
                      title={t('settings.autoPair.removeFollowingString', { value })}
                      disabled={!renderAutoPairEditing}
                      onclick={() => removeRenderAutoPairAllowedFollowingString(value)}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </span>
                {/each}
              </div>
              <div class="auto-pair-following-add-row">
                <input
                  id="render-auto-pair-allowed-following-string-window"
                  class="auto-pair-following-input"
                  type="text"
                  maxlength={maximumAutoPairAllowedFollowingStringLength}
                  autocomplete="off"
                  aria-label={t('settings.autoPair.followingInputLabel')}
                  placeholder={t('settings.autoPair.followingPlaceholder')}
                  disabled={!renderAutoPairEditing || renderAutoPairAllowedFollowingStrings.length >= maximumAutoPairAllowedFollowingStringCount}
                  bind:value={renderAutoPairAllowedFollowingStringDraft}
                  onkeydown={handleRenderAutoPairAllowedFollowingStringKeydown}
                />
                <button
                  type="button"
                  class="auto-pair-following-add"
                  disabled={!renderAutoPairEditing || !canAddRenderAutoPairAllowedFollowingString}
                  onclick={addRenderAutoPairAllowedFollowingString}
                >
                  <Plus size={13} aria-hidden="true" />
                  {t('settings.autoPair.addFollowingString')}
                </button>
              </div>
            </div>
            <label class="settings-check-row" for="render-auto-symbol-substitution-window">
              <input
                id="render-auto-symbol-substitution-window"
                class="settings-checkbox"
                type="checkbox"
                bind:checked={renderAutoSymbolSubstitution}
              />
              <span class="settings-check-copy">
                <span class="settings-check-title">{t('settings.autoSymbols.title')}</span>
                <span class="settings-check-description">{t('settings.autoSymbols.description')}</span>
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
                <span class="settings-check-title">{t('settings.preserveIndent.title')}</span>
                <span class="settings-check-description">{t('settings.preserveIndent.description')}</span>
              </span>
            </label>
          </div>
        {:else if activeSettingsCategory}
          <div class="settings-section">
            <div class="settings-format-module">
              <div class="settings-format-heading">
                <h4 class="section-title">{t(activeSettingsCategory.labelKey)}</h4>
                <span class="settings-check-description">{t(activeSettingsCategory.descriptionKey)}</span>
              </div>
              <div class="settings-category-formats" aria-label={t('settings.categoryFormats', { category: t(activeSettingsCategory.labelKey) })}>
                {#each getDocumentFormatsForCategory(activeSettingsCategory) as format}
                  <span class="settings-format-chip">{t(format.labelKey)}</span>
                {/each}
              </div>
            </div>

            {#if activeSettingsCategory.id === 'table'}
              <div class="settings-format-module">
                <h5 class="settings-subsection-title">{t('settings.table.display')}</h5>
                <label class="settings-check-row" for="delimited-table-highlight-header-window">
                  <input
                    id="delimited-table-highlight-header-window"
                    class="settings-checkbox"
                    type="checkbox"
                    bind:checked={delimitedTableHighlightHeader}
                  />
                  <span class="settings-check-copy">
                    <span class="settings-check-title">{t('settings.table.highlightHeader.title')}</span>
                    <span class="settings-check-description">{t('settings.table.highlightHeader.description')}</span>
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
                    <span class="settings-check-title">{t('settings.table.rowNumbers.title')}</span>
                    <span class="settings-check-description">{t('settings.table.rowNumbers.description')}</span>
                  </span>
                </label>
              </div>

              <div class="settings-format-module">
                <h5 class="settings-subsection-title">{t('settings.table.reorderSection')}</h5>
                <label class="settings-check-row" for="delimited-table-reorder-animation-window">
                  <input
                    id="delimited-table-reorder-animation-window"
                    class="settings-checkbox"
                    type="checkbox"
                    bind:checked={delimitedTableAnimateReorder}
                  />
                  <span class="settings-check-copy">
                    <span class="settings-check-title">{t('settings.table.reorder.title')}</span>
                    <span class="settings-check-description">{t('settings.table.reorder.description')}</span>
                  </span>
                </label>
                <label
                  class="settings-duration-row"
                  class:disabled={!delimitedTableAnimateReorder}
                  for="delimited-table-reorder-duration-window"
                >
                  <span>{t('settings.table.reorder.duration')}</span>
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
                {t('settings.categoryNote')}
              </p>
            {/if}
          </div>
        {:else if activeSettingsFormat}
          <div class="settings-section">
            <div class="settings-format-module">
              <div class="settings-format-heading">
                <h4 class="section-title">{t(activeSettingsFormat.labelKey)}</h4>
                <span class="settings-check-description">
                  {activeSettingsFormat.extensions.length > 0 ? activeSettingsFormat.extensions.map((extension) => `.${extension}`).join(', ') : t('settings.noExtension')}
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
                  <span class="settings-check-title">{t('settings.renderDisplay.title')}</span>
                  <span class="settings-check-description">{t(activeSettingsFormat.renderDescriptionKey)}</span>
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
                  <span class="settings-check-title">{t('settings.renderEditing.title')}</span>
                  <span class="settings-check-description">{t(activeSettingsFormat.editDescriptionKey)}</span>
                </span>
              </label>
            </div>

            {#if activeSettingsFormat.id === 'markdown'}
              <div class="settings-format-module">
                <h5 class="settings-subsection-title">{t('settings.markdown.headings')}</h5>
                <label class="settings-check-row" for="markdown-hide-heading-markers-window">
                  <input
                    id="markdown-hide-heading-markers-window"
                    class="settings-checkbox"
                    type="checkbox"
                    checked={markdownRenderSettings.hideHeadingMarkers}
                    onchange={(event) => markdownRenderSettings = { ...markdownRenderSettings, hideHeadingMarkers: (event.currentTarget as HTMLInputElement).checked }}
                  />
                  <span class="settings-check-copy">
                    <span class="settings-check-title">{t('settings.markdown.hideMarkers.title')}</span>
                    <span class="settings-check-description">{t('settings.markdown.hideMarkers.description')}</span>
                  </span>
                </label>
                <label class="settings-check-row" for="markdown-heading-dividers-window">
                  <input
                    id="markdown-heading-dividers-window"
                    class="settings-checkbox"
                    type="checkbox"
                    checked={markdownRenderSettings.showHeadingDividers}
                    onchange={(event) => markdownRenderSettings = { ...markdownRenderSettings, showHeadingDividers: (event.currentTarget as HTMLInputElement).checked }}
                  />
                  <span class="settings-check-copy">
                    <span class="settings-check-title">{t('settings.markdown.dividers.title')}</span>
                    <span class="settings-check-description">{t('settings.markdown.dividers.description')}</span>
                  </span>
                </label>

                <div class="markdown-heading-settings" aria-label={t('settings.markdown.headings')}>
                  {#each markdownHeadingLevels as level}
                    <div class="markdown-heading-setting-row">
                      <span class="markdown-heading-setting-label">{t('settings.markdown.level', { level })}</span>
                      <label for={`markdown-heading-${level}-size-window`}>{t('settings.markdown.sizePercent')}</label>
                      <input
                        id={`markdown-heading-${level}-size-window`}
                        class="font-size-num markdown-heading-size-input"
                        type="number"
                        min="80"
                        max="145"
                        step="1"
                        value={markdownRenderSettings.headings[level].sizePercent}
                        onchange={(event) => setMarkdownHeadingStyle(level, 'sizePercent', Number((event.currentTarget as HTMLInputElement).value))}
                      />
                      <span class="markdown-heading-unit">%</span>
                      <label for={`markdown-heading-${level}-weight-window`}>{t('settings.fontWeight')}</label>
                      <select
                        id={`markdown-heading-${level}-weight-window`}
                        class="tab-size-select markdown-heading-weight-select"
                        value={markdownRenderSettings.headings[level].fontWeight}
                        onchange={(event) => setMarkdownHeadingStyle(level, 'fontWeight', (event.currentTarget as HTMLSelectElement).value as MarkdownHeadingStyle['fontWeight'])}
                      >
                        <option value="400">400</option>
                        <option value="500">500</option>
                        <option value="600">600</option>
                        <option value="700">700</option>
                        <option value="800">800</option>
                      </select>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
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
        aria-hidden="true"
        onmousedown={handleTitlebarMouseDown}
      >
        <img class="titlebar-app-image" src="/favicon.png" alt="" draggable="false" />
      </div>

      <div
        class="titlebar-tabs"
        class:tab-drop-active={isTabDockDropTarget}
        bind:this={titlebarTabsEl}
        role="presentation"
      >
        <div
          class="tab-list-shell"
          style={`--minimum-tab-width: ${minimumTabWidth}px; --preferred-tab-width: ${preferredTabWidth}px; --tab-list-preferred-width: ${tabListPreferredWidth}px;`}
        >
          <div
            class="tab-list"
            role="tablist"
            aria-label={t('window.openTabs')}
            bind:this={tabListEl}
            onscroll={updateTabStripMetrics}
            onwheel={handleTabListWheel}
          >
            {#each tabs as tab (tab.id)}
              <div
                class="tab-item"
                class:active={tab.id === activeTabId}
                class:dirty={tab.isDirty}
                class:dragging={tab.id === draggedTabId}
                data-tab-id={tab.id}
              >
                <button
                  type="button"
                  class="tab-select"
                  role="tab"
                  aria-selected={tab.id === activeTabId}
                  draggable="false"
                  onpointerdown={(event) => handleTabPointerDown(event, tab.id)}
                  onpointermove={handleTabPointerMove}
                  onpointerup={handleTabPointerUp}
                  onpointercancel={handleTabPointerCancel}
                  title={tab.filePath || getDisplayFileName(tab)}
                  onclick={() => handleTabClick(tab.id)}
                >
                  {#if tab.isDirty}
                    <span class="tab-dirty-dot" aria-hidden="true"></span>
                  {/if}
                  <span class="tab-title">{getDisplayFileName(tab)}</span>
                </button>
                <button
                  type="button"
                  class="tab-close-btn"
                  aria-label={t('window.closeTab', { fileName: getDisplayFileName(tab) })}
                  title={t('window.closeTabTitle')}
                  onclick={(event) => handleCloseTab(tab.id, event)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            {/each}
          </div>
          {#if isTabStripOverflowing}
            <div class="tab-scroll-indicator" aria-hidden="true">
              <div
                class="tab-scroll-thumb"
                style={`width: ${tabScrollThumbWidth}px; transform: translateX(${tabScrollThumbLeft}px);`}
              ></div>
            </div>
          {/if}
          {#if isTabDockDropTarget}
            <div
              class="tab-drop-indicator"
              style={`transform: translateX(${tabDropIndicatorLeft}px);`}
            ></div>
          {/if}
        </div>
        <div class="tab-strip-actions">
          <button
            type="button"
            class="tab-add-btn"
            aria-label={t('window.newTab')}
            title={t('window.newTab')}
            onclick={handleAddTab}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
          <div class="tab-overflow-menu-container">
            <button
              type="button"
              class="tab-overflow-btn"
              class:active={isTabOverflowMenuOpen}
              class:unavailable={!isTabStripOverflowing}
              aria-label={t('window.openTabs')}
              title={t('window.openTabs')}
              aria-haspopup="menu"
              aria-expanded={isTabStripOverflowing && isTabOverflowMenuOpen}
              aria-hidden={!isTabStripOverflowing}
              tabindex={isTabStripOverflowing ? 0 : -1}
              disabled={!isTabStripOverflowing}
              onclick={toggleTabOverflowMenu}
            >
              <ChevronDown size={16} aria-hidden="true" />
            </button>
            {#if isTabStripOverflowing && isTabOverflowMenuOpen}
              <div class="tab-overflow-menu" role="menu" aria-label={t('window.openTabs')}>
                {#each hiddenTabs as tab (tab.id)}
                  <button
                    type="button"
                    class="tab-overflow-item"
                    class:active={tab.id === activeTabId}
                    role="menuitemradio"
                    aria-checked={tab.id === activeTabId}
                    title={tab.filePath || getDisplayFileName(tab)}
                    onclick={() => selectTabFromOverflowMenu(tab.id)}
                  >
                    {#if tab.isDirty}
                      <span class="tab-dirty-dot" aria-hidden="true"></span>
                    {/if}
                    <span class="tab-overflow-title">{getDisplayFileName(tab)}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
        <div
          class="titlebar-drag-region"
          aria-hidden="true"
          onmousedown={handleTitlebarMouseDown}
        ></div>
      </div>

      <div class="window-control-group" aria-label={t('window.controls')}>
        <button
          type="button"
          class="window-control-btn"
          aria-label={t('window.minimize')}
          title={t('window.minimizeTitle')}
          onclick={handleWindowMinimize}
        >
          <Minus size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          class="window-control-btn"
          aria-label={isWindowMaximized ? t('window.restore') : t('window.maximize')}
          title={isWindowMaximized ? t('window.restoreTitle') : t('window.maximizeTitle')}
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
          aria-label={t('window.close')}
          title={t('window.closeTitle')}
          onclick={handleWindowClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>

    {#if tabDragPreview}
      <div
        class="tab-drag-preview"
        data-tab-drag-preview
        aria-hidden="true"
        style={`width: ${tabDragPreview.previewWidth}px; transform: translate3d(${tabDragPreview.left}px, ${tabDragPreview.top}px, 0);`}
      >
        <div class="tab-drag-preview-content">
          {#if tabDragPreview.previewIsDirty}
            <span class="tab-dirty-dot"></span>
          {/if}
          <span class="tab-title">{tabDragPreview.previewTitle}</span>
        </div>
        <span class="tab-drag-preview-close"><X size={14} aria-hidden="true" /></span>
      </div>
    {/if}

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
            {t('menu.file')}
          </button>
          {#if openDropdown === 'file'}
            <div class="dropdown-menu" onclick={(e) => e.stopPropagation()}>
              <button class="dropdown-item" onclick={handleNewFile}>
                <span class="item-label">{t('menu.newTab')}</span>
                <span class="shortcut-label">Ctrl+N</span>
              </button>
              <button class="dropdown-item" onclick={handleOpenFile}>
                <span class="item-label">{t('menu.open')}</span>
                <span class="shortcut-label">Ctrl+O</span>
              </button>
              <button class="dropdown-item" onclick={handleSaveFile}>
                <span class="item-label">{t('menu.save')}</span>
                <span class="shortcut-label">Ctrl+S</span>
              </button>
              <button class="dropdown-item" onclick={handleSaveAsFile}>
                <span class="item-label">{t('menu.saveAs')}</span>
                <span class="shortcut-label">Ctrl+Shift+S</span>
              </button>
              <div class="menu-divider"></div>
              <button class="dropdown-item" onclick={handleExit}>
                <span class="item-label">{t('menu.exit')}</span>
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
            {t('menu.edit')}
          </button>
          {#if openDropdown === 'edit'}
            <div class="dropdown-menu" onclick={(e) => e.stopPropagation()}>
              <button class="dropdown-item" onclick={handleUndo} disabled={!canUndoActiveTab()}>
                <span class="item-label">{t('menu.undo')}</span>
                <span class="shortcut-label">Ctrl+Z</span>
              </button>
              <button class="dropdown-item" onclick={handleRedo} disabled={!canRedoActiveTab()}>
                <span class="item-label">{t('menu.redo')}</span>
                <span class="shortcut-label">Ctrl+Y</span>
              </button>
              <div class="menu-divider"></div>
              <button class="dropdown-item" onclick={handleCut} disabled={!fileContent}>
                <span class="item-label">{t('menu.cut')}</span>
                <span class="shortcut-label">Ctrl+X</span>
              </button>
              <button class="dropdown-item" onclick={handleCopy} disabled={!fileContent}>
                <span class="item-label">{t('menu.copy')}</span>
                <span class="shortcut-label">Ctrl+C</span>
              </button>
              <button class="dropdown-item" onclick={handlePaste}>
                <span class="item-label">{t('menu.paste')}</span>
                <span class="shortcut-label">Ctrl+V</span>
              </button>
              <button class="dropdown-item" onclick={handleDelete} disabled={!fileContent}>
                <span class="item-label">{t('menu.delete')}</span>
                <span class="shortcut-label">Del</span>
              </button>
              <div class="menu-divider"></div>
              <button class="dropdown-item" onclick={handleSelectAll}>
                <span class="item-label">{t('menu.selectAll')}</span>
                <span class="shortcut-label">Ctrl+A</span>
              </button>
              <button class="dropdown-item" onclick={insertDateTime}>
                <span class="item-label">{t('menu.dateTime')}</span>
                <span class="shortcut-label">F5</span>
              </button>
            </div>
          {/if}
        </div>

        <div class="menu-item-container">
          <button
            class="menu-trigger"
            class:active={openDropdown === 'help'}
            onclick={(e) => toggleDropdown('help', e)}
            onmouseenter={() => handleMouseEnter('help')}
          >
            {t('menu.help')}
          </button>
          {#if openDropdown === 'help'}
            <div class="dropdown-menu help-menu">
              <button
                class="dropdown-item"
                onclick={handleManualUpdateCheck}
                disabled={isCheckingForUpdate || isInstallingUpdate}
              >
                <span class="item-label">
                  {isInstallingUpdate ? t('update.menuInstalling') : isCheckingForUpdate ? t('update.menuChecking') : t('update.menuCheck')}
                </span>
              </button>
              <div class="menu-divider"></div>
              <button class="dropdown-item" onclick={handleAboutDialogOpen}>
                <span class="item-label">{t('menu.about')}</span>
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

      <!-- 우측 업데이트, 테마, 렌더 모드 및 설정 버튼 -->
      <div class="menu-right">
        {#if availableAppUpdate}
          <button
            type="button"
            class="available-update-button"
            onclick={handleAvailableUpdateInstall}
            disabled={isCheckingForUpdate || isInstallingUpdate}
            aria-label={`${t('update.install')} ${availableAppUpdate.version}`}
            title={`${t('update.install')} ${availableAppUpdate.version}`}
          >
            <Download size={14} aria-hidden="true" />
            <span>{t('update.install')}</span>
            <span class="available-update-version">{availableAppUpdate.version}</span>
          </button>
        {/if}

        <button
          class="theme-mode-toggle"
          onclick={() => {
            if (themeMode === 'system') themeMode = systemIsDark ? 'light' : 'dark';
            else themeMode = themeMode === 'light' ? 'dark' : 'light';
          }}
          title={t('toolbar.changeTheme')}
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
          title={isRenderMode ? t('toolbar.switchToSource') : t('toolbar.switchToRender')}
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
          title={t('toolbar.settings')}
        >
          <Settings size={18} />
        </button>
      </div>
    </nav>

    <!-- 편집 공간 -->
    <main
      class="editor-area"
      class:render-mode={isRenderMode && isEnhancedDocumentWithinBudget}
      class:render-selection-active={isRenderMode && isEnhancedDocumentWithinBudget && hasEditorSelection}
      class:render-custom-selection={isRenderMode && supportsRenderedSelectionHighlight && shouldRenderHighlightLayer && hasRenderedSelectionHighlight}
      class:render-wrap-settling={isRenderMode && isEnhancedDocumentWithinBudget && isRenderWrapSettling}
      class:render-native-text-visible={shouldShowNativeRenderText}
    >
      <div class="editor-container">
        {#if shouldShowDelimitedTableEditor && activeDelimitedTableDocument}
          <DelimitedTableEditor
            document={activeDelimitedTableDocument}
            formatLabel={t(activeDocumentFormat.labelKey)}
            locale={locale}
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
        {#if isRenderMode && isEnhancedDocumentWithinBudget}
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
                  {@const listLayout = renderListLineLayouts[idx] ?? null}
                  {@const listTokenParts = listLayout ? getListRenderTokenParts(line?.tokens ?? [], listLayout.prefixLength) : null}
                  {#if line}
                    <div
                      use:observeRenderedLine
                      class="backdrop-line"
                      data-line-index={lineIdx}
                      class:list-item-line={listLayout !== null}
                      class:diagnostic-line={documentDiagnostic?.line === lineIdx + 1}
                      class:configuration-rule-line={line.lineKind === 'rule'}
                      class:configuration-negated-rule-line={line.lineKind === 'negated-rule'}
                      class:configuration-section-line={line.lineKind === 'section'}
                      class:translation-source-line={line.lineKind === 'translation-source'}
                      class:translation-target-line={line.lineKind === 'translation-target'}
                      class:translation-empty-line={line.lineKind === 'translation-empty'}
                      class:subject-line={line.lineKind === 'subject'}
                      class:fenced-code-line={line.fencedCodePosition !== undefined}
                      class:fenced-code-start={line.fencedCodePosition === 'start'}
                      class:fenced-code-middle={line.fencedCodePosition === 'middle'}
                      class:fenced-code-end={line.fencedCodePosition === 'end'}
                      class:markdown-heading-line={line.headingLevel !== undefined}
                      class:markdown-heading-divider={line.headingLevel !== undefined && line.headingLevel <= 2 && markdownRenderSettings.showHeadingDividers}
                      class:styled-text-geometry={line.headingLevel !== undefined}
                      style="position: absolute; top: {getRenderLineTop(lineIdx) + editorTopPadding}px; left: 0; width: {getEditorTextBoxWidth()}px; min-height: {measuredLineHeight}px; line-height: {measuredLineHeight}px; font-size: {currentFontSize}pt; tab-size: {tabSize}; -moz-tab-size: {tabSize}; {getMarkdownHeadingLineStyle(line.headingLevel)} {listLayout ? getRenderListLineStyle(listLayout) : ''}"
                    >
                      {#each Array(line.indentLevel) as _, i}
                        <span class="guide-line" style="left: {getIndentGuideLeft(i)}px;"></span>
                      {/each}
                      {#if listLayout && listTokenParts}
                        <span class="line-content list-item-content" data-list-body-start={listLayout.prefixLength}>
                          <span class="list-item-prefix">
                            {#each listTokenParts.prefixTokens as token}
                              {@render renderToken(token)}
                            {/each}
                          </span>
                          <span class="list-item-body">
                            {#each listTokenParts.bodyTokens as token}
                              {@render renderToken(token)}
                            {/each}
                          </span>
                        </span>
                      {:else}
                        <span class="line-content">
                          {#each line.tokens as token}
                            {@render renderToken(token)}
                          {/each}
                        </span>
                      {/if}
                    </div>
                  {/if}
                {/each}
              </div>
            </div>
          {/if}

          <textarea
            bind:this={textareaEl}
            class="editor-textarea"
            style="font-size: {currentFontSize}pt; line-height: {measuredLineHeight}px; tab-size: {tabSize}; -moz-tab-size: {tabSize}; caret-color: {isRenderMode && isActiveDocumentRenderEnabled && !shouldShowNativeRenderText ? 'transparent' : steadyEditorCaretVisible ? 'transparent' : 'var(--text-color)'}; cursor: {isRenderMode && isEnhancedDocumentWithinBudget ? editorCursorStyle : 'text'};"
            wrap={isRenderMode && isEnhancedDocumentWithinBudget ? 'soft' : 'off'}
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
            dir="auto"
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
      <div class="status-left" aria-live="polite">
        {#if transientStatusMessage}
          <span class="status-message">{transientStatusMessage}</span>
        {/if}
        {#if filePath}
          <span class="file-path" class:with-status={!!transientStatusMessage} title={filePath}>{filePath}</span>
        {/if}
      </div>
      <div class="status-right">
        {#if isRenderMode && !isEnhancedDocumentWithinBudget}
          <span class="status-item" title={t('status.largeFileRawHint')}>
            {t('status.largeFileRaw')}
          </span>
        {/if}
        {#if shouldShowDocumentSyntaxStatus}
          <span
            class="status-item"
            class:status-error={!!documentDiagnostic}
            title={documentDiagnostic?.message || t('diagnostic.noProblems', { format: t(activeDocumentFormat.labelKey) })}
          >
            {#if documentDiagnostic}
              {t('diagnostic.errorStatus', { format: t(activeDocumentFormat.labelKey), line: documentDiagnostic.line, column: documentDiagnostic.column })}
            {:else}
              {t('diagnostic.okStatus', { format: t(activeDocumentFormat.labelKey) })}
            {/if}
          </span>
        {/if}
        <span class="status-item">{t('status.lineColumn', { line: cursorLine, column: cursorCol })}</span>
        <span class="status-item">100%</span>
        <span class="status-item">{getLineEndingLabel(fileContent)}</span>
        <span class="status-item">{getTextEncodingLabel(fileEncoding)}</span>
      </div>
    </footer>

    <AboutDialog
      open={isAboutDialogOpen}
      version={installedAppVersion}
      locale={locale}
      onclose={() => isAboutDialogOpen = false}
    />
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
    --color-hl-code-bg: #e2e8f0;
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
    --color-hl-code-text: #94a3b8;
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
    font-family: 'Cascadia Mono', 'Cascadia Code', Consolas, 'D2Coding', 'Nanum Gothic Coding', monospace;
    font-size: inherit;
    line-height: inherit;
    color: var(--color-hl-code-text);
    border-radius: 2px;
  }
  :global(.hl-string) {
    color: var(--color-hl-string);
  }
  :global(.hl-number) {
    color: var(--color-hl-number);
  }
  :global(.hl-list-marker),
  :global(.hl-heading-marker) {
    color: var(--color-hl-list-marker);
  }
  :global(.hl-section) {
    color: var(--color-hl-key-strong);
    font-weight: 700;
  }
  :global(.hl-operator) {
    color: var(--text-muted);
  }
  :global(.hl-timestamp) {
    color: var(--color-hl-key-medium);
    font-variant-numeric: tabular-nums;
  }
  :global(.hl-keyword) {
    color: var(--color-hl-list-marker);
    font-weight: 700;
  }
  :global(.hl-keyword-error),
  :global(.hl-keyword-fatal) {
    color: #dc2626;
  }
  :global(.hl-keyword-warn),
  :global(.hl-keyword-warning) {
    color: #d97706;
  }
  :global(.hl-link) {
    color: var(--color-hl-key-medium);
    text-decoration: underline;
  }
  :global(.hl-strong) {
    font-weight: 700;
  }
  :global(.hl-emphasis) {
    font-style: italic;
  }
  :global(.hl-quote-marker) {
    color: var(--color-hl-list-marker);
    font-weight: 700;
  }
  :global(.hl-key) {
    color: var(--color-hl-key-medium);
  }
  :global(.hl-pattern) {
    color: var(--color-hl-key-strong);
  }
  :global(.hl-attribute) {
    color: var(--color-hl-key-medium);
    font-weight: 600;
  }
  :global(.hl-owner) {
    color: var(--color-hl-string);
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, currentColor 35%, transparent);
    text-underline-offset: 0.12em;
  }
  :global(.hl-tag) {
    color: var(--color-hl-key-strong);
    font-weight: 650;
  }
  :global(.hl-directive) {
    color: var(--color-hl-key-medium);
    font-weight: 600;
  }
  :global(.hl-hash) {
    color: var(--color-hl-string);
    font-variant-numeric: tabular-nums;
  }
  :global(.hl-host) {
    color: var(--color-hl-key-medium);
    text-decoration: underline dotted color-mix(in srgb, currentColor 40%, transparent);
    text-underline-offset: 0.14em;
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

  :global(.hl-syntax-hidden) {
    color: transparent;
    -webkit-text-fill-color: transparent;
    text-shadow: none;
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
    overflow: visible;
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

  .tab-list-shell {
    position: relative;
    z-index: 1;
    flex: 0 1 var(--tab-list-preferred-width);
    width: var(--tab-list-preferred-width);
    min-width: 0;
    height: 32px;
  }

  .tab-list {
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: 2px;
    width: 100%;
    height: 32px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    overscroll-behavior-x: contain;
  }

  .tab-list::-webkit-scrollbar {
    width: 0;
    height: 0;
  }

  .tab-item {
    display: flex;
    align-items: center;
    flex: 0 1 var(--preferred-tab-width);
    min-width: var(--minimum-tab-width);
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

  .tab-item.dragging {
    opacity: 0.55;
  }

  .tab-item.dragging .tab-select {
    cursor: grabbing;
  }

  .tab-drag-preview {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 10000;
    display: flex;
    align-items: center;
    height: 32px;
    color: var(--text-color);
    background-color: var(--bg-tab-active);
    border: 1px solid var(--tab-border-color);
    border-radius: 7px;
    box-sizing: border-box;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22), 0 2px 6px rgba(0, 0, 0, 0.14);
    opacity: 0.96;
    overflow: hidden;
    pointer-events: none;
    will-change: transform;
  }

  .tab-drag-preview-content {
    display: flex;
    align-items: center;
    gap: 7px;
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 8px 0 12px;
    font-family: var(--font-ui);
    font-size: 0.78rem;
  }

  .tab-drag-preview-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
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
    cursor: grab;
    outline: none;
    touch-action: none;
  }

  .tab-select:focus-visible,
  .tab-close-btn:focus-visible,
  .tab-add-btn:focus-visible,
  .tab-overflow-btn:focus-visible,
  .tab-overflow-item:focus-visible {
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
  .tab-add-btn,
  .tab-overflow-btn {
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
  .tab-add-btn:hover,
  .tab-overflow-btn:hover,
  .tab-overflow-btn.active {
    background-color: var(--bg-tab-button-hover);
  }

  .tab-add-btn {
    margin-bottom: 3px;
  }

  .tab-strip-actions {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: flex-end;
    gap: 2px;
    flex-shrink: 0;
  }

  .tab-overflow-menu-container {
    position: relative;
    width: 28px;
    height: 28px;
    margin-bottom: 3px;
  }

  .tab-overflow-btn {
    height: 28px;
  }

  .tab-overflow-btn.unavailable {
    visibility: hidden;
    pointer-events: none;
  }

  .tab-overflow-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    display: flex;
    flex-direction: column;
    min-width: 210px;
    max-width: 300px;
    max-height: 260px;
    padding: 4px;
    overflow-y: auto;
    background-color: var(--bg-dropdown);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    box-shadow: var(--shadow-menu);
    box-sizing: border-box;
    z-index: 120;
  }

  .tab-overflow-item {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: 30px;
    padding: 5px 9px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-color);
    font-family: var(--font-ui);
    font-size: 0.78rem;
    text-align: left;
    cursor: pointer;
    outline: none;
  }

  .tab-overflow-item:hover,
  .tab-overflow-item.active {
    background-color: var(--bg-menu-hover);
  }

  .tab-overflow-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-scroll-indicator {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 3;
    height: 2px;
    overflow: hidden;
    pointer-events: none;
  }

  .tab-scroll-thumb {
    height: 2px;
    border-radius: 999px;
    background-color: var(--text-muted);
    opacity: 0.55;
    will-change: transform;
  }
  .tab-drop-indicator {
    position: absolute;
    top: 4px;
    bottom: 3px;
    left: 0;
    z-index: 4;
    width: 2px;
    border-radius: 999px;
    background-color: var(--accent-color);
    box-shadow: 0 0 0 1px var(--bg-color);
    pointer-events: none;
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
    gap: 0.1rem;
  }

  .available-update-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    height: 24px;
    padding: 0 0.5rem;
    margin-right: 0.25rem;
    border: 1px solid var(--accent-color);
    border-radius: 5px;
    background-color: transparent;
    color: var(--accent-color);
    font-family: var(--font-ui);
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    transition: background-color 0.1s, color 0.1s;
  }

  .available-update-button:hover:not(:disabled) {
    background-color: var(--accent-color);
    color: white;
  }

  .available-update-button:focus-visible {
    outline: 2px solid var(--accent-color);
    outline-offset: 1px;
  }

  .available-update-button:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .available-update-version {
    font-size: 0.68rem;
    font-variant-numeric: tabular-nums;
    opacity: 0.78;
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

  .dropdown-menu.help-menu {
    min-width: 190px;
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

  .backdrop-line.markdown-heading-line .line-content {
    font-size: var(--markdown-heading-size, 100%);
    font-weight: var(--markdown-heading-weight, 600);
  }

  .backdrop-line.markdown-heading-divider {
    box-shadow: inset 0 -1px color-mix(in srgb, var(--color-render-text, var(--text-color)) 18%, transparent);
  }

  .backdrop-line.configuration-section-line {
    background-color: color-mix(in srgb, var(--color-hl-key-medium) 7%, transparent);
    box-shadow: inset 3px 0 color-mix(in srgb, var(--color-hl-key-medium) 45%, transparent);
  }

  .backdrop-line.configuration-negated-rule-line {
    background-color: color-mix(in srgb, #d97706 5%, transparent);
    box-shadow: inset 3px 0 color-mix(in srgb, #d97706 48%, transparent);
  }

  .backdrop-line.translation-source-line {
    box-shadow: inset 3px 0 color-mix(in srgb, var(--color-hl-key-medium) 38%, transparent);
  }

  .backdrop-line.translation-target-line {
    background-color: color-mix(in srgb, #16a34a 4%, transparent);
    box-shadow: inset 3px 0 color-mix(in srgb, #16a34a 42%, transparent);
  }

  .backdrop-line.translation-empty-line {
    background-color: color-mix(in srgb, #d97706 7%, transparent);
    box-shadow: inset 3px 0 color-mix(in srgb, #d97706 55%, transparent);
  }

  .backdrop-line.subject-line {
    background-color: color-mix(in srgb, var(--color-hl-key-strong) 6%, transparent);
    box-shadow: inset 3px 0 color-mix(in srgb, var(--color-hl-key-strong) 48%, transparent);
    font-weight: 650;
  }

  .backdrop-line.fenced-code-line {
    isolation: isolate;
  }

  .backdrop-line.fenced-code-line .line-content {
    position: relative;
    z-index: 1;
    display: block;
    width: 100%;
    padding-inline: 12px;
    box-sizing: border-box;
  }

  .backdrop-line.fenced-code-line .guide-line {
    transform: translateX(12px);
  }

  .backdrop-line.fenced-code-line::before {
    content: '';
    position: absolute;
    z-index: 0;
    top: 0;
    right: 12px;
    bottom: -1px;
    left: 12px;
    box-sizing: border-box;
    background-color: var(--color-hl-code-bg);
    pointer-events: none;
  }

  .backdrop-line.fenced-code-start::before {
    top: calc(100% - 12px);
    bottom: 0;
    border-radius: 6px 6px 0 0;
  }

  .backdrop-line.fenced-code-end::before {
    bottom: auto;
    height: 12px;
    border-radius: 0 0 6px 6px;
  }

  .backdrop-line.fenced-code-line :global(.hl-code) {
    background-color: transparent;
    border-radius: 0;
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

  .backdrop-line.list-item-line {
    white-space: normal;
  }

  .list-item-content {
    display: grid;
    grid-template-columns: var(--list-prefix-width) minmax(0, 1fr);
    align-items: start;
    width: 100%;
    min-width: 0;
  }

  .list-item-prefix {
    grid-column: 1;
    white-space: pre;
  }

  .list-item-body {
    grid-column: 2;
    min-width: 0;
    min-height: 1lh;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    word-break: keep-all;
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

  :global(::highlight(render-selection)) {
    background-color: rgba(96, 165, 250, 0.28);
  }

  .render-mode.render-custom-selection .editor-textarea::selection {
    background: transparent;
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

  .auto-pair-following-settings {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    margin: -0.1rem 0 0.15rem 26px;
    padding: 0.65rem 0.75rem;
    border-left: 2px solid var(--border-color);
    background: var(--bg-window);
  }

  .auto-pair-following-settings.disabled {
    opacity: 0.55;
  }

  .auto-pair-following-heading {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .auto-pair-following-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .auto-pair-following-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    max-width: 100%;
    min-height: 24px;
    padding: 0.1rem 0.2rem 0.1rem 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--bg-editor);
    color: var(--text-color);
    font-size: 0.76rem;
  }

  .auto-pair-following-chip.fixed {
    gap: 0.4rem;
    padding-right: 0.5rem;
  }

  .auto-pair-following-chip code {
    overflow-wrap: anywhere;
    font-family: "Cascadia Mono", Consolas, monospace;
    font-size: 0.76rem;
  }

  .auto-pair-following-fixed-label {
    color: var(--text-muted);
    font-size: 0.68rem;
  }

  .auto-pair-following-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .auto-pair-following-remove:hover:not(:disabled) {
    background: var(--bg-menu-hover);
    color: var(--text-color);
  }

  .auto-pair-following-add-row {
    display: flex;
    gap: 0.4rem;
    max-width: 360px;
  }

  .auto-pair-following-input {
    flex: 1;
    min-width: 0;
    height: 28px;
    box-sizing: border-box;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    outline: none;
    background: var(--bg-editor);
    color: var(--text-color);
    font-family: var(--font-ui);
    font-size: 0.78rem;
  }

  .auto-pair-following-input:focus {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 1px var(--accent-color);
  }

  .auto-pair-following-add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    min-width: 62px;
    height: 28px;
    padding: 0 0.55rem;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-editor);
    color: var(--text-color);
    font-family: var(--font-ui);
    font-size: 0.76rem;
    cursor: pointer;
  }

  .auto-pair-following-add:hover:not(:disabled) {
    background: var(--bg-menu-hover);
  }

  .auto-pair-following-add:disabled,
  .auto-pair-following-remove:disabled,
  .auto-pair-following-input:disabled {
    cursor: not-allowed;
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

  .markdown-heading-settings {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .markdown-heading-setting-row {
    display: grid;
    grid-template-columns: 72px 82px 58px 18px 88px minmax(92px, 120px);
    align-items: center;
    gap: 0.45rem;
    color: var(--text-color);
    font-size: 0.78rem;
  }

  .markdown-heading-setting-label {
    font-weight: 600;
  }

  .markdown-heading-size-input {
    width: 58px;
  }

  .markdown-heading-unit {
    color: var(--text-muted);
  }

  .markdown-heading-weight-select {
    width: 100%;
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

  .settings-transfer-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .settings-transfer-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    min-height: 30px;
    padding: 0.35rem 0.75rem;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-window);
    color: var(--text-color);
    font-family: var(--font-ui);
    font-size: 0.8rem;
    cursor: pointer;
  }

  .settings-transfer-button:hover:not(:disabled) {
    background: var(--bg-menu-hover);
  }

  .settings-transfer-button:focus-visible {
    outline: 2px solid var(--accent-color);
    outline-offset: 2px;
  }

  .settings-transfer-button:disabled {
    cursor: wait;
    opacity: 0.55;
  }

  .settings-transfer-status {
    margin: 0;
    color: #16753c;
    font-size: 0.78rem;
    line-height: 1.4;
  }

  .settings-transfer-status.warning {
    color: #946200;
  }

  .settings-transfer-status.error {
    color: var(--error-text, #b91c1c);
  }
  :global(.theme-dark) .settings-transfer-status {
    color: #86efac;
  }

  :global(.theme-dark) .settings-transfer-status.warning {
    color: #fde68a;
  }

  :global(.theme-dark) .settings-transfer-status.error {
    color: #fca5a5;
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

  .status-message {
    flex-shrink: 0;
    color: var(--text-color);
    padding-left: 0.25rem;
  }

  .file-path.with-status {
    margin-left: 0.5rem;
    padding-left: 0.5rem;
    border-left: 1px solid var(--border-color);
    color: var(--text-muted);
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


