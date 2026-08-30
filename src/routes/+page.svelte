<script lang="ts">
  import { ask, message } from "@tauri-apps/plugin-dialog";
  import { ChevronDown, Copy, Minus, Square, Plus, X } from "@lucide/svelte";
  import {
    configurableDocumentFormatCategories,
    configurableDocumentFormats,
    createDefaultDocumentFeatureSettings,
    createDocumentRenderCache,
    defaultNewDocumentFormatId,
    getDocumentDiagnostic,
    getDocumentFormatById,
    getDocumentFormatForContent,
    getNewDocumentInitialContent,
    getSuggestedFileExtensionForContent,
    isDocumentFormatEditEnabled,
    isDocumentFormatRenderEnabled,
    normalizeDocumentFeatureSettings,
    getOpenFileDialogFilters,
    parseDocumentForRender,
    getSaveFileDialogFilters
  } from "$lib/document-formats";
  import type { DocumentDiagnostic, DocumentFeatureSettings, DocumentFormatCategory, DocumentFormatId } from "$lib/document-formats";
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
    activateEditorTab as activateEditorSessionTab,
    createEditorSession,
    getActiveEditorTab,
    getActiveEditorTabIndex,
    setEditorSessionTabs,
    updateEditorTab,
    type EditorTab,
    type EditorTabUpdates,
    type TextEncoding
  } from "$lib/editor-session";
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
    type MarkdownRenderSettings
  } from "$lib/markdown-settings";
  import { onDestroy, tick, untrack } from "svelte";
  import AboutDialog from "$lib/AboutDialog.svelte";
  import EditorMenuBar from "$lib/EditorMenuBar.svelte";
  import SettingsWindow from "$lib/SettingsWindow.svelte";
  import {
    getLanguageNativeName,
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
  import { EditorCommandPipeline } from "$lib/editor-command-pipeline";
  import { getEditorDuplicationEdit } from "$lib/editor-duplication";
  import { getArrowSubstitutionSpaceEdit } from "$lib/arrow-substitution";
  import {
    canInsertMarkdownHeadingReplacementMarker,
    getMarkdownHeadingSpaceEdit
  } from "$lib/markdown-heading-edit";
  import { findOpenFileTab } from "$lib/file-tabs";
  import { BoundedLruCache, BoundedRecentSet } from "$lib/bounded-collections";
  import {
    canInsertAutoPairAt,
    createDefaultAutoPairAllowedFollowingStrings
  } from "$lib/auto-pair";
  import { getTextChange, type TextChange } from "$lib/text-change";
  import {
    createEditorLineLayoutCache,
    createFencedCodeBlockCache,
    getEditorLineLayout,
    getFencedCodeBlockRanges,
    getRenderListIndentGuideCount,
    type FencedCodeBlockRange,
    type RenderedLineHeightMeasurements,
    type RenderListLineLayout
  } from "$lib/editor-layout";
  import { getEditorScrollHeight, getRenderWheelScrollDelta } from "$lib/editor-scroll-extent";
  import {
    desktopFiles,
    type OpenedTextFile as OpenedFile,
    type SavedTextFile as SavedFile
  } from "$lib/desktop-file-service";
  import {
    desktopWindows,
    type DesktopEvent as TauriEvent,
    type DesktopUnlisten as UnlistenFn,
    type DesktopWindowHandle
  } from "$lib/desktop-window-service";
  import {
    createBrowserRenderViewportScheduler,
    RenderViewportController
  } from "$lib/render-viewport-controller";
  import {
    createBrowserDocumentDiagnosticWorkerClient,
    DocumentDiagnosticCancelledError
  } from "$lib/document-diagnostic-client";
  import {
    parseSettingsFile,
    serializeSettingsFile,
    type AppSettingsSnapshot,
    type SettingsImportErrorReason,
    type SettingsThemePalette
  } from "$lib/settings-transfer";
  import { SettingsRepository } from "$lib/settings-repository";
  import {
    getColorCodeStyle,
    getColorInputValue,
    getReadableTextColor,
    normalizeHexColor,
    getSystemDefaultColors
  } from "$lib/theme-colors";
  import {
    createRenderedTextBoundaryIndex,
    findClosestRenderedTextOffset,
    getNativeCaretTextOffsetAtPoint,
    type RenderedTextBoundary
  } from "$lib/rendered-text-geometry";

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


  let nextTabId = 1;
  let nextUntitledNumber = 1;
  const invalidFileNameCharsPattern = /[<>:"/\\|?*\x00-\x1F]/g;
  const isBrowser = typeof window !== 'undefined';
  function createBrowserSettingsRepository(): SettingsRepository | null {
    if (!isBrowser) return null;
    try {
      return new SettingsRepository(window.localStorage);
    } catch {
      return null;
    }
  }
  const settingsRepository = createBrowserSettingsRepository();
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
  const openFilesRequestedEvent = 'text-pad-open-files-requested';
  const tabTransferIdQueryKey = 'tabTransferId';
  const tabTransferSourceQueryKey = 'tabTransferSource';
  let systemLocale = $state<AppLocale>(resolveSystemLocale(isBrowser ? navigator.languages : []));
  let languagePreference = $state<LanguagePreference>('system');
  let defaultNewDocumentFormat = $state<DocumentFormatId>(defaultNewDocumentFormatId);
  let locale = $derived<AppLocale>(languagePreference === 'system' ? systemLocale : languagePreference);
  let untitledFileName = $derived(translate(locale, 'app.untitled'));

  function t(key: TranslationKey, values: TranslationValues = {}) {
    return translate(locale, key, values);
  }

  function hasTauriRuntime(): boolean {
    return isBrowser && desktopWindows.isAvailable();
  }

  function getStartupTabTransferMetadata(): TabDragMetadata | null {
    if (!isBrowser) return null;
    const searchParams = new URLSearchParams(window.location.search);
    const transferId = searchParams.get(tabTransferIdQueryKey);
    const sourceWindowLabel = searchParams.get(tabTransferSourceQueryKey);
    return transferId && sourceWindowLabel ? { transferId, sourceWindowLabel } : null;
  }

  function getCurrentEditorWindowLabel(): string {
    return desktopWindows.currentLabel();
  }
  function getInitialIsSettingsWindow(): boolean {
    return desktopWindows.currentLabel() === 'settings';
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

  function getUnsavedDocumentTitle(
    content: string,
    selectedFormatId: DocumentFormatId | null
  ): string {
    return selectedFormatId !== null && content === getNewDocumentInitialContent(selectedFormatId)
      ? untitledFileName
      : getFirstLineTitle(content);
  }

  function getDisplayFileName(
    tab: Pick<EditorTab, 'filePath' | 'fileName' | 'fileContent' | 'selectedDocumentFormatId'>
  ): string {
    return tab.filePath
      ? tab.fileName
      : getUnsavedDocumentTitle(tab.fileContent, tab.selectedDocumentFormatId);
  }

  function getCurrentWindowTitle(): string {
    if (isSettingsWindow) return t('settings.windowTitle');
    const displayName = getDisplayFileName({
      filePath,
      fileName,
      fileContent,
      selectedDocumentFormatId
    });
    return `${isDirty ? '*' : ''}${t('app.windowTitle', { fileName: displayName })}`;
  }

  function getUnsavedFileNameFromContent(
    content: string,
    selectedFormatId: DocumentFormatId | null
  ): string {
    const selectedFormat = getDocumentFormatById(selectedFormatId);
    const suggestedExtension = selectedFormat?.defaultExtension
      ?? getSuggestedFileExtensionForContent(content);
    const firstLineTitle = getUnsavedDocumentTitle(content, selectedFormatId);
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
    return tab.filePath
      ? tab.fileName
      : getUnsavedFileNameFromContent(tab.fileContent, tab.selectedDocumentFormatId);
  }

  function createEditorTab(options: Partial<Pick<EditorTab, 'filePath' | 'fileName' | 'fileContent' | 'selectedDocumentFormatId' | 'encoding' | 'isDirty'>> = {}): EditorTab {
    const nextFilePath = options.filePath ?? null;
    const nextSelectedDocumentFormatId = nextFilePath
      ? null
      : options.selectedDocumentFormatId === undefined
        ? defaultNewDocumentFormat
        : options.selectedDocumentFormatId;
    const nextFileContent = options.fileContent
      ?? (nextSelectedDocumentFormatId ? getNewDocumentInitialContent(nextSelectedDocumentFormatId) : '');
    return {
      id: `tab-${nextTabId++}`,
      filePath: nextFilePath,
      fileName: options.fileName ?? (nextFilePath ? getFileNameFromPath(nextFilePath) : getNextUntitledFileName()),
      fileContent: nextFileContent,
      selectedDocumentFormatId: nextSelectedDocumentFormatId,
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
  let editorActivationGeneration = 0;
  const undoWindowBudget = new EditorUndoWindowBudget(128 * 1024 * 1024);
  undoWindowBudget.touch(initialTab.id);
  let editorSession = $state(createEditorSession(initialTab));
  let tabs = $derived(editorSession.tabs);
  let activeTabId = $derived(editorSession.activeTabId);
  let activeTab = $derived(getActiveEditorTab(editorSession));
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
  let filePath = $derived(activeTab?.filePath ?? null);
  let fileName = $derived(activeTab ? getDisplayFileName(activeTab) : untitledFileName);
  let fileContent = $derived(activeTab?.fileContent ?? '');
  let selectedDocumentFormatId = $derived(activeTab?.selectedDocumentFormatId ?? null);
  let textOffsetIndex = $state.raw<TextOffsetIndex>(createTextOffsetIndex(initialTab.fileContent));
  let latestContentChange = $state.raw<TextChange | null>(null);
  let fileEncoding = $derived<TextEncoding>(activeTab?.encoding ?? 'utf8');
  let isDirty = $derived(activeTab?.isDirty ?? false);
  let isNewDocumentFormatPickerOpen = $state(false);
  let newDocumentFormatTriggerEl = $state<HTMLButtonElement | null>(null);
  let newDocumentFormatPickerEl = $state<HTMLDivElement | null>(null);
  let isLoading = $state<boolean>(false);
  let errorMsg = $state<string | null>(null);
  let isHandlingCloseRequest = false;
  let hasFocusedEditorOnStartup = false;
  let hasShownMainWindowOnStartup = false;
  let hasLoadedStartupFiles = false;
  let hasCheckedForUpdateOnStartup = false;
  let startupUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingInstanceOpenChain: Promise<void> = Promise.resolve();
  let transientStatusTimer: ReturnType<typeof setTimeout> | null = null;
  let isWindowMaximized = $state<boolean>(false);
  let transientStatusMessage = $state<string | null>(null);
  let isCheckingForUpdate = $state<boolean>(false);
  let isInstallingUpdate = $state<boolean>(false);
  let availableAppUpdate = $state.raw<Update | null>(null);
  let isAboutDialogOpen = $state<boolean>(false);
  let installedAppVersion = $state<string>(APP_VERSION_FALLBACK);

  // 커서 상태 추적
  let cursorLine = $derived(activeTab?.cursorLine ?? 1);
  let cursorCol = $derived(activeTab?.cursorCol ?? 1);
  let caretOffset = $derived(activeTab?.caretOffset ?? 0);
  let editorCaretColor = $state<string>('var(--color-render-text, var(--text-color))');
  let editorCursorStyle = $state<string>('text');
  let hasEditorSelection = $state<boolean>(false);
  let hasRenderedSelectionHighlight = $state<boolean>(false);
  let steadyEditorCaretVisible = $state<boolean>(false);
  let steadyEditorCaretCollapsed = $state<boolean>(true);
  let steadyEditorCaretLeft = $state<number>(12);
  let steadyEditorCaretTop = $state<number>(8);
  let steadyEditorCaretHeight = $state<number>(22);
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
  type SettingsTransferStatus = { kind: 'success' | 'warning' | 'error'; message: string };
  let settingsTransferStatus = $state<SettingsTransferStatus | null>(null);
  let isSettingsTransferBusy = $state<boolean>(false);
  let hasCenteredSettingsWindowThisSession = false;

  // 폰트 크기 이원화
  let sourceFontSize = $state<number>(11);
  let renderFontSize = $state<number>(11);

  // 렌더 모드 상태
  let isRenderMode = $state<boolean>(true); // 기본값은 렌더 모드
  let renderAutoPairEditing = $state<boolean>(true);
  let renderAutoPairAllowedFollowingStrings = $state<string[]>(createDefaultAutoPairAllowedFollowingStrings());
  let renderAutoSymbolSubstitution = $state<boolean>(true);
  let renderPreserveIndentOnEnter = $state<boolean>(true);
  let delimitedTableHighlightHeader = $state<boolean>(true);
  let delimitedTableShowRowIndices = $state<boolean>(true);
  let delimitedTableAnimateReorder = $state<boolean>(true);
  let delimitedTableReorderDurationMs = $state<number>(150);
  let documentFeatureSettings = $state<DocumentFeatureSettings>(createDefaultDocumentFeatureSettings());
  let markdownRenderSettings = $state<MarkdownRenderSettings>(createDefaultMarkdownRenderSettings());
  let currentFontSize = $derived(isRenderMode ? renderFontSize : sourceFontSize);
  let tabSize = $state<number>(4);          // 기본 들여쓰기 탭 4칸
  let scrollTop = $derived(activeTab?.scrollTop ?? 0);
  let scrollLeft = $derived(activeTab?.scrollLeft ?? 0);
  let measuredLineHeight = $state<number>(22);
  let clientHeight = $state<number>(500);
  let isRenderWrapSettling = $state<boolean>(false);
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

  type ThemeColors = SettingsThemePalette;

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
  const renderAutoClosingCharacters = new Set(Object.values(renderAutoClosingPairs));

  const editorIndentUnit = '    ';
  const editorHorizontalPadding = 24;
  const fencedCodeHorizontalPadding = 12;
  const editorTopPadding = 8;
  const editorBottomPadding = 8;
  const virtualLineOverscan = 8;
  const editorResizeDebounceMs = 80;
  const renderCaretRevealSettleDelayMs = 200;
  const delimitedTableReorderDurationMinMs = 50;
  const delimitedTableReorderDurationMaxMs = 2000;
  const delimitedTableReorderDurationStepMs = 50;
  const editorMovementKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
  let pendingRenderCaretMovementDirection: -1 | 0 | 1 = 0;
  let markdownHeadingReplacementCaret: number | null = null;

  function getDocumentFormatsForCategory(category: DocumentFormatCategory) {
    return configurableDocumentFormats.filter((format) => category.formatIds.includes(format.id));
  }


  function getActiveTabIndex(): number {
    return getActiveEditorTabIndex(editorSession);
  }

  function getActiveTab(): EditorTab | null {
    return activeTab;
  }

  function updateTabById(tabId: string, updates: EditorTabUpdates) {
    editorSession = updateEditorTab(editorSession, tabId, updates);
  }

  function updateActiveTab(updates: EditorTabUpdates) {
    updateTabById(activeTabId, updates);
  }

  function replaceSessionTabs(nextTabs: EditorTab[], preferredActiveTabId = activeTabId) {
    editorSession = setEditorSessionTabs(editorSession, nextTabs, preferredActiveTabId);
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

  function captureActiveEditorView() {
    if (pendingInlineColorEditBefore) {
      finishInlineColorPickerEdit();
    }

    const tab = getActiveTab();
    if (!tab) return;

    const nextFileName = filePath
      ? fileName
      : getUnsavedDocumentTitle(fileContent, selectedDocumentFormatId);
    const nextIsDirty = getUndoHistoryForTab(tab).isDirty();
    const selection = getCurrentEditorSelection();
    const scrollElement = isRenderMode && isEnhancedDocumentWithinBudget
      ? editorViewportEl
      : textareaEl;

    updateActiveTab({
      fileName: nextFileName,
      isDirty: nextIsDirty,
      scrollTop: scrollElement?.scrollTop ?? tab.scrollTop,
      scrollLeft: scrollElement?.scrollLeft ?? tab.scrollLeft,
      selectionStart: selection.start,
      selectionEnd: selection.end
    });
  }

  function restoreEditorView(tab: EditorTab, activationGeneration: number) {
    editorCursorStyle = 'text';
    clearInlineColorPickerState();

    requestAnimationFrame(() => {
      if (
        !textareaEl
        || editorActivationGeneration !== activationGeneration
        || activeTabId !== tab.id
      ) return;
      const selectionStart = Math.min(tab.selectionStart, fileContent.length);
      const selectionEnd = Math.min(tab.selectionEnd, fileContent.length);

      textareaEl.focus({ preventScroll: true });
      setTextareaSelectionFromContent(selectionStart, selectionEnd);
      if (isRenderMode && isEnhancedDocumentWithinBudget) {
        textareaEl.scrollTop = 0;
        if (editorViewportEl) editorViewportEl.scrollTop = tab.scrollTop;
      } else {
        textareaEl.scrollTop = tab.scrollTop;
      }
      textareaEl.scrollLeft = tab.scrollLeft;
      syncCursorState(false);
    });
  }

  function loadTabIntoEditor(tab: EditorTab) {
    const history = getUndoHistoryForTab(tab);
    const nextIsDirty = history.isDirty();
    const nextTab = nextIsDirty === tab.isDirty
      ? tab
      : { ...tab, isDirty: nextIsDirty };
    if (nextTab !== tab) updateTabById(tab.id, { isDirty: nextTab.isDirty });
    editorSession = activateEditorSessionTab(editorSession, tab.id);
    editorActivationGeneration += 1;
    const activationGeneration = editorActivationGeneration;
    setLastEditorSnapshot(getTabSnapshot(nextTab));
    latestContentChange = null;
    textOffsetIndex = createTextOffsetIndex(nextTab.fileContent);
    isNewDocumentFormatPickerOpen = false;
    enforceUndoWindowBudget();
    errorMsg = null;
    restoreEditorView(nextTab, activationGeneration);
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
    captureActiveEditorView();
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
    void desktopWindows.emit(eventName, getTabPointerPayload(transfer)).catch((error) => {
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
    captureActiveEditorView();
    const sourceIndex = tabs.findIndex((tab) => tab.id === tabId);
    if (sourceIndex === -1) return;

    const nextTabs = reorderTabItems(tabs, sourceIndex, dropIndex);
    if (nextTabs.every((tab, index) => tab.id === tabs[index]?.id)) return;
    replaceSessionTabs(nextTabs);
    requestAnimationFrame(() => scrollTabIntoView(tabId));
  }

  function insertTransferredTab(delivery: TabTransferDelivery): boolean {
    if (receivedTabTransferIds.has(delivery.transferId)) return true;

    captureActiveEditorView();
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
      replaceSessionTabs([receivedTab], receivedTab.id);
    } else {
      replaceSessionTabs(insertTabItem(tabs, receivedTab, delivery.dropIndex));
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

      void desktopWindows.emitTo(metadata.sourceWindowLabel, tabTransferRequestEvent, {
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
      await desktopWindows.emitTo(request.targetWindowLabel, tabTransferDeliveryEvent, {
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
      await desktopWindows.emitTo(delivery.sourceWindowLabel, tabTransferAcceptedEvent, {
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
        await desktopWindows.current().destroy();
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
    const detachedWindow = desktopWindows.create(label, {
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
    const eventWindow = desktopWindows.current();
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
    captureActiveEditorView();
    const nextTab = tabs.find((tab) => tab.id === tabId);
    if (!nextTab) return;
    closeAllDropdown();
    loadTabIntoEditor(nextTab);
  }

  function addTab(tab: EditorTab) {
    captureActiveEditorView();
    resetUndoHistoryForTab(tab);
    replaceSessionTabs([...tabs, tab]);
    closeAllDropdown();
    loadTabIntoEditor(tab);
  }

  function handleAddTab() {
    addTab(createEditorTab());
  }

  function selectNewDocumentFormat(formatId: DocumentFormatId) {
    if (filePath !== null || fileContent.length > 0) return;

    isNewDocumentFormatPickerOpen = false;
    updateActiveTab({ selectedDocumentFormatId: formatId });

    const initialContent = getNewDocumentInitialContent(formatId);
    if (initialContent.length > 0) {
      commitManualEditorEdit(initialContent, { start: 0, end: 0 });
    }
  }

  function toggleNewDocumentFormatPicker() {
    isNewDocumentFormatPickerOpen = !isNewDocumentFormatPickerOpen;
    if (!isNewDocumentFormatPickerOpen) return;

    void tick().then(() => {
      const selectedButton = newDocumentFormatPickerEl
        ?.querySelector<HTMLButtonElement>('.new-document-format-button.active');
      const firstButton = newDocumentFormatPickerEl
        ?.querySelector<HTMLButtonElement>('.new-document-format-button');
      (selectedButton ?? firstButton)?.focus();
    });
  }

  function closeNewDocumentFormatPicker(restoreFocus = true) {
    isNewDocumentFormatPickerOpen = false;
    if (restoreFocus) {
      void tick().then(() => newDocumentFormatTriggerEl?.focus());
    }
  }

  function handleNewDocumentFormatPickerKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeNewDocumentFormatPicker();
  }

  function isCleanUntitledTab(tab: EditorTab): boolean {
    const initialContent = tab.selectedDocumentFormatId
      ? getNewDocumentInitialContent(tab.selectedDocumentFormatId)
      : '';
    return !tab.filePath && !tab.isDirty && tab.fileContent === initialContent;
  }

  function replaceActiveTabWith(tab: EditorTab) {
    captureActiveEditorView();
    const activeIndex = getActiveTabIndex();
    if (activeIndex === -1) {
      addTab(tab);
      return;
    }

    const activeId = tabs[activeIndex].id;
    const nextTab = { ...tab, id: activeId };
    resetUndoHistoryForTab(nextTab);
    replaceSessionTabs(tabs.map((item) => item.id === activeId ? nextTab : item));
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
      replaceSessionTabs([blankTab], blankTab.id);
      loadTabIntoEditor(blankTab);
      return;
    }

    const nextTabs = tabs.filter((tab) => tab.id !== tabId);
    undoWindowBudget.remove(tabId);
    undoHistories.delete(tabId);

    if (activeTabId === tabId) {
      const nextIndex = Math.min(closingIndex, nextTabs.length - 1);
      const nextTab = nextTabs[nextIndex];
      replaceSessionTabs(nextTabs, nextTab.id);
      loadTabIntoEditor(nextTab);
    } else {
      replaceSessionTabs(nextTabs);
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

  // 마운트 시 버전된 설정 스냅샷을 로드하고 이전 개별 키를 한 번만 이관한다.
  $effect(() => {
    if (!isBrowser) return;
    systemLocale = resolveSystemLocale(navigator.languages);
    if (settingsRepository) {
      const loadedSettings = untrack(() => settingsRepository.load(getCurrentSettingsSnapshot(), {
        legacySystemIsDark: systemIsDark
      }));
      applySettingsSnapshot(loadedSettings);
    }

    requestAnimationFrame(() => {
      setTimeout(() => {
        canPersistPreferences = true;
      }, 0);
    });
  });

  // 설정 전체를 한 번 정규화한 뒤 단일 저장 단위로 기록한다.
  $effect(() => {
    if (!isBrowser || !canPersistPreferences || !settingsRepository) return;
    settingsRepository.save(getCurrentSettingsSnapshot());
  });

  // 마운트 시 독립 설정창 감지 및 메인 창 종료 시퀀스
  $effect(() => {
    if (!isBrowser || !hasTauriRuntime()) return;
    const label = desktopWindows.current().label;
    isSettingsWindow = label === 'settings';
    if (isSettingsWindow) {
      desktopWindows.current().onCloseRequested((event) => {
        event.preventDefault();
        desktopWindows.current().hide();
      });
    } else {
      let unlistenClose: (() => void) | undefined;
      desktopWindows.current().onCloseRequested(async (event) => {
        event.preventDefault();

        if (isHandlingCloseRequest) return;
        isHandlingCloseRequest = true;
        try {
          const canClose = await shouldCloseEditorWindow();
          if (!canClose) return;

          try {
            const editorWindows = (await desktopWindows.getAll())
              .filter((window) => window.label !== 'settings' && window.label !== label);
            if (editorWindows.length === 0) {
              const settingsWin = await desktopWindows.getByLabel('settings');
              if (settingsWin) {
                await settingsWin.destroy();
              }
            }
          } catch {}

          await desktopWindows.current().destroy();
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
    captureActiveEditorView();
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
      isWindowMaximized = await desktopWindows.current().isMaximized();
    } catch {}
  }

  $effect(() => {
    if (!isBrowser || !hasTauriRuntime() || isSettingsWindow) return;

    let unlistenResized: UnlistenFn | undefined;
    void refreshWindowMaximizedState();
    desktopWindows.current().onResized(() => {
      void refreshWindowMaximizedState();
    }).then((unlisten) => {
      unlistenResized = unlisten;
    });

    return () => {
      if (unlistenResized) unlistenResized();
    };
  });

  async function confirmCloseTab(tabId: string): Promise<boolean> {
    captureActiveEditorView();
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
      selectedDocumentFormatId: null,
      encoding: savedFile.encoding,
      isDirty: false
    });
  }

  async function writeTabContent(tabId: string, targetPath: string) {
    captureActiveEditorView();
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) return;

    await desktopFiles.writeFileContent({
      path: targetPath,
      content: tab.fileContent,
      encoding: tab.encoding
    });
    applySavedFile(tabId, { path: targetPath, encoding: tab.encoding });
  }

  async function saveTabFile(tabId: string): Promise<boolean> {
    captureActiveEditorView();
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) return false;

    if (tab.filePath) {
      await writeTabContent(tabId, tab.filePath);
      return true;
    }

    const savedFile = await desktopFiles.saveFileDialog({
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
    captureActiveEditorView();
    const tab = getActiveTab();
    if (!tab) return false;

    const savedFile = await desktopFiles.saveFileDialog({
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

  // 완성된 설정 스냅샷만 창 사이에 동기화한다.
  function handleStorageChange(e: StorageEvent) {
    if (!settingsRepository || e.key !== settingsRepository.storageKey) return;
    const settings = settingsRepository.parseStorageValue(e.newValue);
    if (settings) applySettingsSnapshot(settings);
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
        theme: themeMode,
        defaultNewDocumentFormat
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
    defaultNewDocumentFormat = settings.general.defaultNewDocumentFormat;
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
      const savedFile = await desktopFiles.saveFileDialog({
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
      const openedFile = await desktopFiles.openFileDialog([
        { name: t('settings.transfer.jsonFilter'), extensions: ['json'] }
      ]);
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
  const renderViewportController = isBrowser
    ? new RenderViewportController({
        scheduler: createBrowserRenderViewportScheduler(),
        resizeDebounceMs: editorResizeDebounceMs,
        caretRevealSettleDelayMs: renderCaretRevealSettleDelayMs,
        isWrapSettlingEnabled: () => isRenderMode,
        onViewportWidthChange: (width) => {
          editorViewportWidth = width;
        },
        onViewportHeightChange: (height) => {
          clientHeight = height;
        },
        onWrapSettlingChange: (isSettling) => {
          isRenderWrapSettling = isSettling;
        },
        onCaretSync: (revealCaret) => {
          syncSteadyEditorCaretPosition(revealCaret);
        }
      })
    : null;

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
  let renderEditorScrollHeight = $derived(getEditorScrollHeight({
    baseBottomPadding: editorBottomPadding,
    clientHeight,
    renderedContentHeight: renderLineLayout.totalHeight,
    topPadding: editorTopPadding
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
      renderViewportController?.syncCaretAfterLayout();
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
  let selectedDocumentFormat = $derived(
    filePath === null ? getDocumentFormatById(selectedDocumentFormatId) : null
  );
  let activeDocumentFormat = $derived(
    selectedDocumentFormat ?? getDocumentFormatForContent(fileContent, filePath || fileName)
  );
  let shouldShowNewDocumentFormatToolbar = $derived(
    !isSettingsWindow && filePath === null && fileContent.length === 0
  );
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
    formatId: selectedDocumentFormat?.id,
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

  function ensureRenderedCaretLineVisible(offset: number): boolean {
    if (!editorViewportEl || !isRenderMode || !isEnhancedDocumentWithinBudget) return false;

    const lineIndex = findLineIndexForOffset(offset);
    const lineStart = lineStartOffsets[lineIndex] ?? 0;
    const lineEnd = getLineEndOffset(fileContent, lineStart);
    const lineTop = getRenderLineTop(lineIndex) + editorTopPadding;
    const lineBottom = lineTop + getRenderLineHeight(lineIndex);
    const viewportTop = editorViewportEl.scrollTop;
    const viewportBottom = viewportTop + editorViewportEl.clientHeight;
    let nextScrollTop = viewportTop;

    if (lineBottom <= viewportTop) {
      nextScrollTop = Math.max(0, lineTop - editorTopPadding);
    } else if (lineTop >= viewportBottom) {
      const bottomPadding = offset >= lineEnd ? editorBottomPadding : 0;
      nextScrollTop = lineBottom + bottomPadding - editorViewportEl.clientHeight;
    } else {
      return false;
    }

    const maximumScrollTop = Math.max(0, renderEditorScrollHeight - editorViewportEl.clientHeight);
    nextScrollTop = Math.max(0, Math.min(nextScrollTop, maximumScrollTop));
    if (Math.abs(nextScrollTop - viewportTop) <= 0.5) return false;

    steadyEditorCaretVisible = false;
    editorViewportEl.scrollTop = nextScrollTop;
    updateActiveTab({ scrollTop: nextScrollTop });
    requestAnimationFrame(() => syncSteadyEditorCaretPosition());
    return true;
  }

  function syncSteadyEditorCaretPosition(revealCaret = false) {
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
      if (revealCaret && ensureRenderedCaretLineVisible(start)) return;

      const caretRect = getRenderedCaretRectForOffset(start);
      if (!caretRect || !editorViewportEl) {
        steadyEditorCaretVisible = false;
        return;
      }

      const viewportRect = editorViewportEl.getBoundingClientRect();
      let nextScrollTop = editorViewportEl.scrollTop;
      if (caretRect.top < viewportRect.top) {
        nextScrollTop += caretRect.top - viewportRect.top;
      } else if (caretRect.bottom > viewportRect.bottom) {
        nextScrollTop += caretRect.bottom - viewportRect.bottom;
      }
      if (revealCaret && Math.abs(nextScrollTop - editorViewportEl.scrollTop) > 0.5) {
        const maximumScrollTop = Math.max(0, renderEditorScrollHeight - editorViewportEl.clientHeight);
        const clampedScrollTop = Math.max(0, Math.min(nextScrollTop, maximumScrollTop));
        steadyEditorCaretVisible = false;
        editorViewportEl.scrollTop = clampedScrollTop;
        updateActiveTab({ scrollTop: clampedScrollTop });
        requestAnimationFrame(() => syncSteadyEditorCaretPosition());
        return;
      }

      steadyEditorCaretLeft = caretRect.left - viewportRect.left;
      steadyEditorCaretTop = caretRect.top - viewportRect.top + editorViewportEl.scrollTop;
      steadyEditorCaretHeight = Math.max(1, caretRect.height);
      return;
    }

    const lineIndex = Math.max(0, cursorLine - 1);
    const lineStart = lineStartOffsets[lineIndex] ?? 0;
    const linePrefix = fileContent.slice(lineStart, start);
    steadyEditorCaretLeft = 12 + measureEditorTextWidth(linePrefix) - scrollLeft;
    steadyEditorCaretTop = 8 + lineIndex * measuredLineHeight - scrollTop;
    steadyEditorCaretHeight = measuredLineHeight;
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
      renderViewportController?.requestCaretReveal();
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

  // 뷰포트 크기 변경 관찰
  $effect(() => {
    const viewport = editorViewportEl;
    if (!viewport || !renderViewportController) return;

    renderViewportController.connectViewport(
      viewport.clientWidth || editorViewportWidth,
      viewport.clientHeight || clientHeight
    );

    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;

      renderViewportController.observeViewportSize(
        entry.contentRect.width,
        entry.contentRect.height
      );
    });
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      renderViewportController.disconnectViewport();
    };
  });

  function openFile(openedFile: OpenedFile, replaceCleanUntitled = true) {
    const existingTab = findOpenFileTab(tabs, openedFile.path);
    if (existingTab) {
      activateTab(existingTab.id);
      return;
    }

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
      captureActiveEditorView();
      const openedFiles = await desktopFiles.openFilePaths(paths);
      for (const openedFile of openedFiles) {
        openFile(openedFile, false);
      }
    } catch (err: any) {
      errorMsg = localizeError('error.readFile', err);
    } finally {
      isLoading = false;
    }
  }

  async function openPendingInstanceFiles() {
    if (isSettingsWindow) return;

    try {
      const openedFiles = await desktopFiles.takePendingOpenFiles();
      if (!openedFiles.length) return;

      isLoading = true;
      errorMsg = null;
      captureActiveEditorView();
      for (const openedFile of openedFiles) {
        openFile(openedFile, false);
      }
    } catch (err: any) {
      errorMsg = localizeError('error.readFile', err);
    } finally {
      isLoading = false;
    }
  }

  function schedulePendingInstanceFilesOpen() {
    pendingInstanceOpenChain = pendingInstanceOpenChain
      .then(openPendingInstanceFiles)
      .catch((error) => {
        console.error('Failed to open files from another app launch:', error);
      });
  }

  $effect(() => {
    if (!isBrowser || !hasTauriRuntime() || isSettingsWindow) return;

    let isDisposed = false;
    let unlistenOpenRequest: UnlistenFn | undefined;
    desktopWindows.current().listen(openFilesRequestedEvent, schedulePendingInstanceFilesOpen)
      .then((unlisten) => {
        if (isDisposed) {
          unlisten();
        } else {
          unlistenOpenRequest = unlisten;
          schedulePendingInstanceFilesOpen();
        }
      })
      .catch((err) => {
        console.error('Failed to listen for files from another app launch:', err);
      });

    return () => {
      isDisposed = true;
      unlistenOpenRequest?.();
    };
  });

  $effect(() => {
    if (!isBrowser || !hasTauriRuntime() || isSettingsWindow) return;

    let isDisposed = false;
    let unlistenDragDrop: UnlistenFn | undefined;
    desktopWindows.current().onDragDropEvent((event) => {
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
      const startupFiles = await desktopFiles.getStartupFiles();
      if (!startupFiles.length) return;

      isLoading = true;
      errorMsg = null;
      captureActiveEditorView();
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
    const appWindow = desktopWindows.current();

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
      void desktopFiles.setupEditorWindowWheel().catch((error) => {
        console.error('Failed to initialize horizontal wheel for editor window:', error);
      });
    }
    const receivedStartupTransfer = await receiveStartupTabTransfer();
    if (startupTabTransferMetadata && !receivedStartupTransfer) {
      await desktopWindows.current().destroy().catch(() => {});
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
    const appWindow = desktopWindows.current();
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
    if (isLineInsideFencedCodeBlock(lineStart)) return null;

    const line = fileContent.slice(lineStart, lineEnd);
    const match = line.match(/^([ \t]{0,3})(#{1,6})([ \t]+)/u);
    if (!match) return null;
    const start = lineStart + (match[1]?.length ?? 0);
    const end = start + (match[2]?.length ?? 0) + (match[3]?.length ?? 0);
    return offset >= start && offset <= end ? { start, end } : null;
  }

  function getSafeRenderedCaretOffset(offset: number, direction: -1 | 0 | 1): number {
    if (markdownHeadingReplacementCaret === offset) return offset;

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

  function syncCursorState(revealCaret: boolean) {
    if (!textareaEl) return;
    if (!revealCaret) renderViewportController?.cancelCaretReveal();
    const isCollapsed = textareaEl.selectionStart === textareaEl.selectionEnd;
    let selection = getTextareaSelectionInContent();
    let pos = selection.start;
    const previousCaretOffset = caretOffset;
    if (isRenderMode && isActiveDocumentRenderEnabled && isCollapsed) {
      const safePosition = getSafeRenderedCaretOffset(pos, pendingRenderCaretMovementDirection);
      if (safePosition !== pos) {
        setTextareaSelectionFromContent(safePosition, safePosition);
        pos = safePosition;
        selection = { start: safePosition, end: safePosition };
      }
    }
    pendingRenderCaretMovementDirection = 0;
    updateEditorSelectionState();
    const lineIndex = findLineIndexForOffset(pos);
    updateActiveTab({
      selectionStart: selection.start,
      selectionEnd: selection.end,
      caretOffset: pos,
      cursorLine: lineIndex + 1,
      cursorCol: pos - (lineStartOffsets[lineIndex] ?? 0) + 1
    });
    updateEditorCaretColor(pos);
    syncSteadyEditorCaretPosition(revealCaret);
    if (isRenderMode && isCollapsed && pos !== previousCaretOffset && steadyEditorCaretVisible) {
      restartSteadyEditorCaretBlink();
    }
    setLastEditorSnapshot(getCurrentEditorSnapshot());
    scheduleRenderedSelectionHighlight();
  }

  function updateCursorPosition() {
    syncCursorState(true);
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
    if (snapshot.content.length > 0) isNewDocumentFormatPickerOpen = false;
    const nextFileName = filePath
      ? fileName
      : getUnsavedDocumentTitle(snapshot.content, selectedDocumentFormatId);
    const nextIsDirty = getActiveUndoHistory().isDirty();
    updateActiveTab({
      fileName: nextFileName,
      fileContent: snapshot.content,
      isDirty: nextIsDirty,
      selectionStart: snapshot.selection.start,
      selectionEnd: snapshot.selection.end
    });
    errorMsg = null;
    reconcileInlineColorPickerState();
    setLastEditorSnapshot(snapshot);
  }

  function applyEditorSnapshot(
    snapshot: EditorSnapshot,
    selectionAlreadyApplied = false,
    change?: TextChange | null,
    offsetIndex?: TextOffsetIndex
  ) {
    const editedTabId = activeTabId;
    const activationGeneration = editorActivationGeneration;
    updateEditorStateForSnapshot(snapshot, change, offsetIndex);

    if (selectionAlreadyApplied) {
      updateCursorPosition();
      return;
    }

    requestAnimationFrame(() => {
      if (
        !textareaEl
        || activeTabId !== editedTabId
        || editorActivationGeneration !== activationGeneration
      ) return;
      textareaEl.focus({ preventScroll: true });
      setTextareaSelectionFromContent(snapshot.selection.start, snapshot.selection.end, snapshot.content);
      updateCursorPosition();
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
    const editedTabId = activeTabId;
    const activationGeneration = editorActivationGeneration;
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
        if (
          activeTabId !== editedTabId
          || editorActivationGeneration !== activationGeneration
        ) return;
        updateCursorPosition();
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

  function duplicateEditorSelectionOrLine(): boolean {
    if (!textareaEl || document.activeElement !== textareaEl) return false;

    const selection = getTextareaSelectionInContent();
    const edit = getEditorDuplicationEdit(
      fileContent,
      selection,
      getPreferredNewline(fileContent, selection.start)
    );
    commitManualEditorEdit(edit.content, edit.selection, {
      keepRenderCaretVisible: isRenderMode
    });
    return true;
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
    markdownHeadingReplacementCaret = null;
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
    renderViewportController?.dispose();
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

  function isLineInsideFencedCodeBlock(lineStart: number): boolean {
    return fencedCodeBlocks.some((block) => (
      lineStart >= block.openingLineStart
      && lineStart <= (block.closingLineStart ?? Number.POSITIVE_INFINITY)
    ));
  }

  function handleRenderMarkdownHeadingSpace(event: KeyboardEvent): boolean {
    if (activeDocumentFormat.id !== 'markdown' || !isActiveDocumentRenderEnabled) return false;
    if (!textareaEl || event.isComposing || event.key !== ' ') return false;
    if (event.ctrlKey || event.altKey || event.metaKey) return false;

    const { start, end } = getTextareaSelectionInContent();
    if (start !== end || isLineInsideFencedCodeBlock(getLineStartOffset(fileContent, start))) return false;

    const edit = getMarkdownHeadingSpaceEdit(fileContent, start);
    if (!edit) return false;

    event.preventDefault();
    markdownHeadingReplacementCaret = null;
    commitRenderEditorEdit(edit.content, edit.selection);
    return true;
  }

  function prepareRenderMarkdownHeadingReplacementMarker(event: KeyboardEvent) {
    if (
      event.key !== '#'
      || event.isComposing
      || event.ctrlKey
      || event.altKey
      || event.metaKey
      || activeDocumentFormat.id !== 'markdown'
      || !isActiveDocumentRenderEnabled
      || !textareaEl
    ) {
      markdownHeadingReplacementCaret = null;
      return;
    }

    const { start, end } = getTextareaSelectionInContent();
    if (
      start !== end
      || isLineInsideFencedCodeBlock(getLineStartOffset(fileContent, start))
      || !canInsertMarkdownHeadingReplacementMarker(fileContent, start)
    ) {
      markdownHeadingReplacementCaret = null;
      return;
    }

    markdownHeadingReplacementCaret = start + 1;
  }

  function handleRenderAutoSubstitutionSpace(event: KeyboardEvent): boolean {
    if (!renderAutoSymbolSubstitution) return false;
    if (!textareaEl || event.isComposing) return false;
    if (event.key !== ' ') return false;
    if (event.ctrlKey || event.altKey || event.metaKey) return false;

    const { start, end } = getTextareaSelectionInContent();
    if (start !== end || start === 0) return false;

    const edit = getArrowSubstitutionSpaceEdit(fileContent, start);
    if (!edit) return false;

    event.preventDefault();
    commitRenderEditorEdit(edit.content, edit.selection);

    return true;
  }

  const renderEditorCommandPipeline = new EditorCommandPipeline<KeyboardEvent>([
    { id: 'fenced-code-selection-guard', priority: 10, execute: handleRenderFencedCodeSelectionEdit },
    { id: 'fenced-code-block-backspace', priority: 20, execute: handleRenderFencedCodeBlockBackspace },
    { id: 'fenced-code-boundary-deletion-guard', priority: 30, execute: handleRenderFencedCodeBoundaryDeletion },
    { id: 'list-boundary-arrow-left', priority: 40, execute: handleRenderListBoundaryArrowLeft },
    { id: 'list-soft-break-enter', priority: 50, execute: handleRenderListSoftBreakEnter },
    { id: 'empty-list-exit-enter', priority: 60, execute: handleRenderExitEmptyListEnter },
    { id: 'continue-list-enter', priority: 70, execute: handleRenderContinueListEnter },
    { id: 'list-continuation-enter', priority: 80, execute: handleRenderListContinuationEnter },
    { id: 'preserve-indent-enter', priority: 90, execute: handleRenderPreserveIndentEnter },
    { id: 'list-marker-backspace', priority: 100, execute: handleRenderListMarkerBackspace },
    { id: 'list-continuation-backspace', priority: 110, execute: handleRenderListContinuationBackspace },
    { id: 'empty-indented-line-backspace', priority: 120, execute: handleRenderEmptyIndentedLineBackspace },
    { id: 'tab-indent', priority: 130, execute: handleRenderTabIndent },
    { id: 'indent-backspace', priority: 140, execute: handleRenderIndentBackspace },
    { id: 'auto-pair-backspace', priority: 150, execute: handleRenderAutoPairBackspace },
    { id: 'markdown-heading-space', priority: 160, execute: handleRenderMarkdownHeadingSpace },
    { id: 'auto-substitution-space', priority: 170, execute: handleRenderAutoSubstitutionSpace },
    { id: 'auto-pair-input', priority: 180, execute: handleRenderAutoPairInput }
  ]);

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

    if (!isRenderMode) {
      markdownHeadingReplacementCaret = null;
      return;
    }
    prepareRenderMarkdownHeadingReplacementMarker(event);
    renderEditorCommandPipeline.execute(event);
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
      captureActiveEditorView();
      closeAllDropdown();
      const openedFile = await desktopFiles.openFileDialog(getOpenFileDialogFilters(locale));

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
    desktopWindows.current().close().catch(() => {});
  }

  async function handleTitlebarMouseDown(event: MouseEvent) {
    if (!hasTauriRuntime() || event.buttons !== 1 || event.detail > 2) return;
    event.preventDefault();
    const appWindow = desktopWindows.current();

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
    await desktopWindows.current().minimize().catch(() => {});
  }

  async function handleWindowToggleMaximize(event: MouseEvent) {
    event.stopPropagation();
    if (!hasTauriRuntime()) return;
    await desktopWindows.current().toggleMaximize().catch(() => {});
    await refreshWindowMaximizedState();
  }

  function handleWindowClose(event: MouseEvent) {
    event.stopPropagation();
    handleExit();
  }

  // 설정 창 열기 (독립 윈도우)
  async function centerSettingsWindowOverMain(settingsWindow: DesktopWindowHandle) {
    const mainWindow = desktopWindows.current();
    const [mainPosition, mainSize, settingsSize] = await Promise.all([
      mainWindow.outerPosition(),
      mainWindow.outerSize(),
      settingsWindow.outerSize()
    ]);

    const x = Math.round(mainPosition.x + (mainSize.width - settingsSize.width) / 2);
    const y = Math.round(mainPosition.y + (mainSize.height - settingsSize.height) / 2);
    await settingsWindow.setPosition({ x, y });
  }

  async function centerSettingsWindowOnFirstOpen(settingsWindow: DesktopWindowHandle) {
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
      const win = await desktopWindows.getByLabel('settings');
      if (win) {
        await centerSettingsWindowOnFirstOpen(win);
        await win.show();
        await win.setFocus();
      } else {
        const settingsUrl = isBrowser ? window.location.origin + '/' : '/';

        const settingsWin = desktopWindows.create('settings', {
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

    if (isRenderMode && isEnhancedDocumentWithinBudget) {
      if (!editorViewportEl) return;
      renderViewportController?.cancelCaretReveal();
      const renderScrollDelta = getRenderWheelScrollDelta({
        deltaMode: e.deltaMode,
        deltaY: e.deltaY,
        lineHeight: measuredLineHeight,
        pageHeight: editorViewportEl.clientHeight,
        shiftKey: e.shiftKey
      });
      if (renderScrollDelta === 0) return;

      editorViewportEl.scrollTop += renderScrollDelta;
      updateActiveTab({ scrollTop: editorViewportEl.scrollTop });
      e.preventDefault();
      return;
    }

    // deltaX가 존재하면 가로 휠 입력이 있는 것임 (macOS 및 일반 브라우저 환경 등)
    if (e.deltaX !== 0) {
      // 일반 브라우저 환경에서 가로 휠 동작 시 스크롤 속도를 보정하기 위해 배율(x3) 적용
      textareaEl.scrollLeft += e.deltaX * 3;
      updateActiveTab({ scrollLeft: textareaEl.scrollLeft });
      e.preventDefault();
    }
    // Shift 키를 누르고 세로 휠을 돌릴 때 가로 스크롤 매핑
    else if (e.shiftKey && e.deltaY !== 0) {
      textareaEl.scrollLeft += e.deltaY;
      updateActiveTab({ scrollLeft: textareaEl.scrollLeft });
      e.preventDefault();
    }
  }

  // 스크롤 갱신 핸들러
  function handleScroll(e: Event) {
    if (isRenderMode && isEnhancedDocumentWithinBudget) return;
    const target = e.target as HTMLTextAreaElement;
    updateActiveTab({ scrollTop: target.scrollTop, scrollLeft: target.scrollLeft });
    syncSteadyEditorCaretPosition();
  }

  function handleEditorViewportScroll(e: Event) {
    if (!isRenderMode || !isEnhancedDocumentWithinBudget) return;
    const target = e.target as HTMLDivElement;
    updateActiveTab({ scrollTop: target.scrollTop, scrollLeft: target.scrollLeft });
    syncSteadyEditorCaretPosition();
  }

  function handleEditorViewportPointerDown() {
    if (isRenderMode && isEnhancedDocumentWithinBudget) {
      renderViewportController?.cancelCaretReveal();
    }
  }

  $effect(() => {
    const viewport = editorViewportEl;
    if (!viewport) return;

    viewport.addEventListener('pointerdown', handleEditorViewportPointerDown);
    return () => viewport.removeEventListener('pointerdown', handleEditorViewportPointerDown);
  });

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
      ? desktopWindows.current().listen<number>("native-horizontal-wheel", (event: TauriEvent<number>) => {
          if (!textareaEl) return;
          if (isRenderMode && isEnhancedDocumentWithinBudget) return;
          const delta = event.payload;
          // OS의 delta 값(보통 120 또는 -120)을 받아 가로 스크롤에 직접 반영
          // 윈도우 OS의 가로 스크롤 한 틱 단위가 대개 120이므로, 120px 만큼 스크롤됩니다.
          textareaEl.scrollLeft += delta;
          updateActiveTab({
            scrollTop: textareaEl.scrollTop,
            scrollLeft: textareaEl.scrollLeft
          });

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
    } else if (
      !isSettingsWindow
      && e.ctrlKey
      && !e.shiftKey
      && !e.altKey
      && !e.metaKey
      && !e.isComposing
      && key === 'd'
    ) {
      if (duplicateEditorSelectionOrLine()) e.preventDefault();
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

    if (normalizeHexColor(currentValue) === null) {
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
      if (normalizeHexColor(value) === null) continue;
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

    return new DOMRect(
      rect.left,
      rect.top,
      1,
      rect.height
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
    if (listBody && Number.isFinite(listBodyStart)) {
      const bodyLength = Math.max(0, lineText.length - listBodyStart);
      const bodyOffset = clamp(targetOffset - listBodyStart, 0, bodyLength);
      if (bodyLength === 0) {
        const bodyRect = listBody.getBoundingClientRect();
        return new DOMRect(bodyRect.left, bodyRect.top, 1, bodyRect.height);
      }

      const boundary = getTextNodeBoundary(listBody, bodyOffset, true);
      return boundary ? getRenderedCaretRectAtBoundary(boundary) : null;
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
    return boundary ? getRenderedCaretRectAtBoundary(boundary) : null;
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
    const listBody = lineContent.querySelector<HTMLElement>('.list-item-body');
    const listBodyStart = Number(lineContent.dataset.listBodyStart);
    const pointRoot = listBody && Number.isFinite(listBodyStart) ? listBody : lineContent;
    const pointMaximum = listBody && Number.isFinite(listBodyStart)
      ? Math.max(0, lineText.length - listBodyStart)
      : lineText.length;
    const pointOffsetBase = listBody && Number.isFinite(listBodyStart) ? listBodyStart : 0;

    if (pointMaximum === 0) return pointOffsetBase;


    const nativeOffset = getNativeCaretTextOffsetAtPoint(
      pointRoot,
      pointMaximum,
      clientX,
      clientY
    );
    if (nativeOffset !== null) return pointOffsetBase + nativeOffset;

    const boundaries = createRenderedTextBoundaryIndex(pointRoot, pointMaximum);
    return pointOffsetBase + findClosestRenderedTextOffset(
      pointMaximum,
      clientX,
      clientY,
      Math.max(editorViewportWidth, 1),
      (offset) => {
        const boundary = boundaries.getBoundary(offset);
        return boundary ? getRenderedCaretRectAtBoundary(boundary) : null;
      }
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
      setInlineColorPickerPosition({
        left: margin,
        top: editorViewportEl.scrollTop + margin
      });
      return;
    }

    const target = {
      left: tokenRect.left - viewportRect.left,
      top: tokenRect.top - viewportRect.top + editorViewportEl.scrollTop,
      width: tokenRect.width,
      height: tokenRect.height
    };
    const viewportWidth = Math.max(viewportRect.width, pickerAnchorSize + margin * 2);
    const viewportHeight = Math.max(viewportRect.height, pickerAnchorSize + margin * 2);
    const maxLeft = viewportWidth - pickerAnchorSize - margin;
    const minTop = editorViewportEl.scrollTop + margin;
    const maxTop = editorViewportEl.scrollTop + viewportHeight - pickerAnchorSize - margin;

    const candidates = [
      { left: target.left + target.width + gap, top: target.top + target.height / 2 },
      { left: target.left - gap, top: target.top + target.height / 2 },
      { left: target.left, top: target.top + target.height + gap },
      { left: target.left, top: target.top - gap }
    ].map((candidate) => ({
      left: clamp(candidate.left, margin, maxLeft),
      top: clamp(candidate.top, minTop, maxTop)
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
    const editedTabId = activeTabId;
    const activationGeneration = editorActivationGeneration;
    const beforeContent = fileContent;
    const nextContent = `${beforeContent.slice(0, start)}${nextValue}${beforeContent.slice(end)}`;
    latestContentChange = getTextChange(beforeContent, nextContent);
    textOffsetIndex = createTextOffsetIndex(nextContent);
    inlineColorPickerValue = nextValue;
    pendingInlineColorReplacement = { start, end: start + nextValue.length };
    const nextFileName = filePath ? fileName : getFirstLineTitle(nextContent);
    updateActiveTab({
      fileName: nextFileName,
      fileContent: nextContent,
      isDirty: true,
      selectionStart: start,
      selectionEnd: start + nextValue.length
    });
    errorMsg = null;
    updateEditorCaretColor(caretOffset);
    setLastEditorSnapshot({
      content: nextContent,
      selection: {
        start,
        end: start + nextValue.length
      }
    });

    requestAnimationFrame(() => {
      if (
        !textareaEl
        || activeTabId !== editedTabId
        || editorActivationGeneration !== activationGeneration
      ) return;
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
      markdownHeadingReplacementCaret = null;
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
    requestAnimationFrame(() => {
      if (isRenderMode && isEnhancedDocumentWithinBudget) {
        if (editorViewportEl) editorViewportEl.scrollTop = scrollTop;
        if (textareaEl) textareaEl.scrollTop = 0;
      } else if (textareaEl) {
        textareaEl.scrollTop = scrollTop;
      }
      syncCursorState(false);
    });
  }

  function toggleThemeMode() {
    if (themeMode === 'system') {
      themeMode = systemIsDark ? 'light' : 'dark';
    } else {
      themeMode = themeMode === 'light' ? 'dark' : 'light';
    }
  }

  const editorMenuCommands = {
    newFile: handleNewFile,
    openFile: handleOpenFile,
    saveFile: handleSaveFile,
    saveFileAs: handleSaveAsFile,
    exit: handleExit,
    undo: handleUndo,
    redo: handleRedo,
    cut: handleCut,
    copy: handleCopy,
    paste: handlePaste,
    deleteSelection: handleDelete,
    selectAll: handleSelectAll,
    insertDateTime,
    checkForUpdates: handleManualUpdateCheck,
    installUpdate: handleAvailableUpdateInstall,
    openAbout: handleAboutDialogOpen,
    toggleNewDocumentFormatPicker,
    toggleTheme: toggleThemeMode,
    toggleRenderMode,
    openSettings: handleSettingsTrigger
  };
</script>

<svelte:window onkeydown={handleKeyDown} onclick={closeAllDropdown} />

{#snippet renderToken(token: Token)}{#if token.children && token.children.length > 0}<span class={getTokenClass(token)}>{#each token.children as child}{@render renderToken(child)}{/each}</span>{:else if token.type === 'boolean'}<span class={getTokenClass(token)} data-token-start={token.start ?? null} data-token-end={token.end ?? null} data-boolean-start={token.start} data-boolean-end={token.end} data-boolean-value={token.text}>{token.text || ''}</span>{:else if token.type === 'color'}<span class={getTokenClass(token)} style={getColorCodeStyle(token.text || '')} data-token-start={token.start ?? null} data-token-end={token.end ?? null} data-color-start={token.start} data-color-end={token.end}>{token.text || ''}</span>{:else}<span class={getTokenClass(token)} data-token-start={token.start ?? null} data-token-end={token.end ?? null}>{token.text || ''}</span>{/if}{/snippet}

{#if isSettingsWindow}
  <SettingsWindow
    {locale}
    {systemLocale}
    {currentTheme}
    {currentRenderFontFamilyCSS}
    bind:languagePreference
    bind:defaultNewDocumentFormat
    bind:sourceFontSize
    bind:renderFontSize
    bind:tabSize
    bind:renderFontFamily
    bind:renderAutoPairEditing
    bind:renderAutoPairAllowedFollowingStrings
    bind:renderAutoSymbolSubstitution
    bind:renderPreserveIndentOnEnter
    bind:delimitedTableHighlightHeader
    bind:delimitedTableShowRowIndices
    bind:delimitedTableAnimateReorder
    bind:delimitedTableReorderDurationMs
    bind:documentFeatureSettings
    bind:markdownRenderSettings
    bind:lightColors
    bind:darkColors
    {settingsTransferStatus}
    {isSettingsTransferBusy}
    onImportSettings={handleImportSettings}
    onExportSettings={handleExportSettings}
  />
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

    <EditorMenuBar
      {locale}
      bind:openDropdown
      canUndo={canUndoActiveTab()}
      canRedo={canRedoActiveTab()}
      hasContent={fileContent.length > 0}
      errorMessage={errorMsg || documentDiagnostic?.message || null}
      isSyntaxError={!errorMsg && !!documentDiagnostic}
      availableUpdateVersion={availableAppUpdate?.version ?? null}
      {isCheckingForUpdate}
      {isInstallingUpdate}
      {shouldShowNewDocumentFormatToolbar}
      {isNewDocumentFormatPickerOpen}
      bind:newDocumentFormatTriggerEl
      {currentTheme}
      {isRenderMode}
      commands={editorMenuCommands}
    />
    <!-- 편집 공간 -->
    <main
      class="editor-area"
      class:render-mode={isRenderMode && isEnhancedDocumentWithinBudget}
      class:render-selection-active={isRenderMode && isEnhancedDocumentWithinBudget && hasEditorSelection}
      class:render-custom-selection={isRenderMode && supportsRenderedSelectionHighlight && shouldRenderHighlightLayer && hasRenderedSelectionHighlight}
      class:render-wrap-settling={isRenderMode && isEnhancedDocumentWithinBudget && isRenderWrapSettling}
      class:render-native-text-visible={shouldShowNativeRenderText}
    >
      {#if shouldShowNewDocumentFormatToolbar && isNewDocumentFormatPickerOpen}
        <div
          bind:this={newDocumentFormatPickerEl}
          id="new-document-format-picker"
          class="new-document-format-picker"
          role="dialog"
          tabindex="-1"
          aria-labelledby="new-document-format-picker-title"
          onkeydown={handleNewDocumentFormatPickerKeydown}
        >
          <div class="new-document-format-picker-heading">
            <strong id="new-document-format-picker-title">{t('newDocument.formatPrompt')}</strong>
            <button
              type="button"
              class="new-document-format-picker-close"
              aria-label={t('window.closeTitle')}
              title={t('window.closeTitle')}
              onclick={() => closeNewDocumentFormatPicker()}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          <div class="new-document-format-groups">
            {#each configurableDocumentFormatCategories as category}
              <div
                class="new-document-format-group"
                role="group"
                aria-label={t(category.labelKey)}
              >
                <span class="new-document-format-category">{t(category.labelKey)}</span>
                <div class="new-document-format-buttons">
                  {#each getDocumentFormatsForCategory(category) as format}
                    <button
                      type="button"
                      class="new-document-format-button"
                      class:active={selectedDocumentFormatId === format.id}
                      aria-pressed={selectedDocumentFormatId === format.id}
                      onclick={() => selectNewDocumentFormat(format.id)}
                    >
                      {t(format.labelKey)}
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
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
          data-testid="editor-viewport"
          bind:this={editorViewportEl}
          onscroll={handleEditorViewportScroll}
        >
          {#if isRenderMode && isEnhancedDocumentWithinBudget}
            <div
              class="editor-render-scroll-extent"
              data-testid="editor-render-scroll-extent"
              style="height: {renderEditorScrollHeight}px;"
              aria-hidden="true"
            ></div>
          {/if}
          <!-- 렌더 모드 Backdrop -->
          {#if shouldRenderHighlightLayer}
            <div class="editor-backdrop" style="height: {renderEditorScrollHeight}px;">
              <div class="backdrop-scroll-container">
                {#each Array(endLine - startLine + 1) as _, idx}
                  {@const lineIdx = startLine + idx}
                  {@const line = parsedLines[idx]}
                  {@const listLayout = renderListLineLayouts[idx] ?? null}
                  {@const indentGuideCount = listLayout ? getRenderListIndentGuideCount(listLayout, tabSize) : line?.indentLevel ?? 0}
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
                      {#each Array(indentGuideCount) as _, i}
                        <span class="guide-line" style="left: {getIndentGuideLeft(i)}px;"></span>
                      {/each}
                      {#if listLayout && listTokenParts}
                        <span class="line-content list-item-content" data-list-body-start={listLayout.prefixLength}>
                          <span class="list-item-prefix">
                            {#each listTokenParts.prefixTokens as token}
                              {@render renderToken(token)}
                            {/each}
                          </span><span class="list-item-body">
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
            data-testid="editor-textarea"
            style="height: {isRenderMode && isEnhancedDocumentWithinBudget ? `${renderEditorScrollHeight}px` : '100%'}; font-size: {currentFontSize}pt; line-height: {measuredLineHeight}px; tab-size: {tabSize}; -moz-tab-size: {tabSize}; caret-color: {isRenderMode && isActiveDocumentRenderEnabled && !shouldShowNativeRenderText ? 'transparent' : steadyEditorCaretVisible ? 'transparent' : 'var(--text-color)'}; cursor: {isRenderMode && isEnhancedDocumentWithinBudget ? editorCursorStyle : 'text'};"
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
                style="left: {steadyEditorCaretLeft}px; top: {steadyEditorCaretTop}px; height: {steadyEditorCaretHeight}px; background-color: {isRenderMode ? editorCaretColor : 'var(--text-color)'};"
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

  .new-document-format-picker {
    position: absolute;
    z-index: 5;
    top: 12px;
    left: 50%;
    width: min(960px, calc(100% - 24px));
    max-height: calc(100% - 24px);
    padding: 10px 12px 12px;
    box-sizing: border-box;
    overflow: auto;
    transform: translateX(-50%);
    color: var(--text-color);
    background: var(--bg-window);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    box-shadow: var(--shadow-menu);
    font-family: var(--font-ui);
  }

  .new-document-format-picker-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 9px;
    font-size: 12px;
  }

  .new-document-format-picker-heading strong {
    font-size: 13px;
    font-weight: 650;
  }

  .new-document-format-category {
    color: var(--text-muted);
  }

  .new-document-format-picker-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .new-document-format-picker-close:hover {
    background: var(--bg-menu-hover);
    color: var(--text-color);
  }

  .new-document-format-picker-close:focus-visible {
    outline: 1px solid var(--accent-color);
    outline-offset: 1px;
  }

  .new-document-format-groups {
    display: grid;
    gap: 8px;
  }

  .new-document-format-group {
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr);
    align-items: start;
    gap: 8px;
  }

  .new-document-format-category {
    padding-top: 5px;
    font-size: 11px;
    white-space: nowrap;
  }

  .new-document-format-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .new-document-format-button {
    min-height: 26px;
    padding: 3px 8px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: var(--bg-menu-hover);
    color: var(--text-color);
    font-family: var(--font-ui);
    font-size: 11px;
    white-space: nowrap;
    cursor: default;
  }

  .new-document-format-button:hover,
  .new-document-format-button.active {
    border-color: color-mix(in srgb, var(--accent-color) 55%, var(--border-color));
    background: color-mix(in srgb, var(--accent-color) 14%, var(--bg-menu-hover));
  }

  .new-document-format-button:focus-visible {
    outline: 1px solid var(--accent-color);
    outline-offset: 1px;
  }

  @media (max-width: 640px) {
    .new-document-format-group {
      grid-template-columns: 1fr;
      gap: 3px;
    }

    .new-document-format-category {
      padding-top: 0;
    }
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

  .render-mode .editor-viewport {
    overflow-x: hidden;
    overflow-y: auto;
  }

  .editor-render-scroll-extent {
    width: 1px;
    pointer-events: none;
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
    overflow: hidden;
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

  .inline-color-picker-native {
    position: absolute;
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


