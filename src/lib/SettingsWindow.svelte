<script lang="ts">
  import { tick } from 'svelte';
  import { getAdditionalRenderThemeStyle } from '$lib/render-theme-fields';
  import {
    getSettingsPages, getSettingsSearchTokens, matchesSettingsSearch, searchSettingsPages,
    settingsColorGroups, type ColorField, type SettingsView
  } from '$lib/settings-navigation';
  import {
    Braces,
    ChevronDown,
    ChevronRight,
    Check,
    Code2,
    Download,
    FileCode2,
    FileText,
    Moon,
    Palette,
    PaintRoller,
    PenLine,
    Plus,
    Settings,
    Search,
    Sun,
    Table2,
    Type,
    Upload,
    X
  } from '@lucide/svelte';
  import {
    configurableDocumentFormatCategories,
    configurableDocumentFormats,
    type DocumentFeatureSettings,
    type DocumentFormatCategory,
    type DocumentFormatCategoryId,
    type DocumentFormatId
  } from '$lib/document-formats';
  import {
    getLanguageNativeName,
    supportedLanguages,
    translate,
    type AppLocale,
    type LanguagePreference,
    type TranslationKey,
    type TranslationValues
  } from '$lib/i18n';
  import {
    maximumAutoPairAllowedFollowingStringCount,
    maximumAutoPairAllowedFollowingStringLength,
    normalizeAutoPairAllowedFollowingString
  } from '$lib/auto-pair';
  import {
    markdownHeadingLevels,
    type MarkdownHeadingLevel,
    type MarkdownHeadingStyle,
    type MarkdownRenderSettings
  } from '$lib/markdown-settings';
  import type { SettingsThemePalette } from '$lib/settings-transfer';
  import {
    formatColorCode,
    getColorCodeStyle,
    getColorInputValue,
    getSystemDefaultColors
  } from '$lib/theme-colors';

  type FormatSettingsView = `format:${DocumentFormatId}`;
  type FormatCategorySettingsView = `category:${DocumentFormatCategoryId}`;
  type SettingsTransferStatus = { kind: 'success' | 'warning' | 'error'; message: string };

  interface Props {
    locale: AppLocale;
    systemLocale: AppLocale;
    currentTheme: 'light' | 'dark';
    currentRenderFontFamilyCSS: string;
    languagePreference: LanguagePreference;
    defaultNewDocumentFormat: DocumentFormatId;
    sourceFontSize: number;
    renderFontSize: number;
    tabSize: number;
    renderFontFamily: string;
    renderAutoPairEditing: boolean;
    renderAutoPairAllowedFollowingStrings: string[];
    renderAutoSymbolSubstitution: boolean;
    renderPreserveIndentOnEnter: boolean;
    delimitedTableHighlightHeader: boolean;
    delimitedTableShowRowIndices: boolean;
    delimitedTableAnimateReorder: boolean;
    delimitedTableReorderDurationMs: number;
    documentFeatureSettings: DocumentFeatureSettings;
    markdownRenderSettings: MarkdownRenderSettings;
    lightColors: SettingsThemePalette;
    darkColors: SettingsThemePalette;
    settingsTransferStatus: SettingsTransferStatus | null;
    isSettingsTransferBusy: boolean;
    onImportSettings: () => void | Promise<void>;
    onExportSettings: () => void | Promise<void>;
  }

  let {
    locale,
    systemLocale,
    currentTheme,
    currentRenderFontFamilyCSS,
    languagePreference = $bindable(),
    defaultNewDocumentFormat = $bindable(),
    sourceFontSize = $bindable(),
    renderFontSize = $bindable(),
    tabSize = $bindable(),
    renderFontFamily = $bindable(),
    renderAutoPairEditing = $bindable(),
    renderAutoPairAllowedFollowingStrings = $bindable(),
    renderAutoSymbolSubstitution = $bindable(),
    renderPreserveIndentOnEnter = $bindable(),
    delimitedTableHighlightHeader = $bindable(),
    delimitedTableShowRowIndices = $bindable(),
    delimitedTableAnimateReorder = $bindable(),
    delimitedTableReorderDurationMs = $bindable(),
    documentFeatureSettings = $bindable(),
    markdownRenderSettings = $bindable(),
    lightColors = $bindable(),
    darkColors = $bindable(),
    settingsTransferStatus,
    isSettingsTransferBusy,
    onImportSettings,
    onExportSettings
  }: Props = $props();

  const delimitedTableReorderDurationMinMs = 50;
  const delimitedTableReorderDurationMaxMs = 2000;
  const delimitedTableReorderDurationStepMs = 50;

  let activeSettingsView = $state<SettingsView>('general');
  let searchQuery = $state('');
  let searchInput: HTMLInputElement;
  let settingsContent: HTMLDivElement;
  let settingsNavigation: HTMLElement;
  let searchTokens = $derived(getSettingsSearchTokens(searchQuery));
  let settingsPages = $derived(getSettingsPages(locale));
  let searchResults = $derived(searchSettingsPages(settingsPages, searchQuery));
  let activePage = $derived(settingsPages.find(page => page.id === activeSettingsView)!);
  let expandedFormatCategories = $state<Record<DocumentFormatCategoryId, boolean>>({
    document: false,
    structured: false,
    project: false,
    table: false,
    subtitle: false
  });
  let selectedEditingTheme = $state<'light' | 'dark' | null>(null);
  let editingTheme = $derived(selectedEditingTheme ?? currentTheme);
  let expandedColorGroups = $state<string[]>(['editor']);
  let previewColors = $derived(editingTheme === 'dark' ? darkColors : lightColors);
  let renderAutoPairAllowedFollowingStringDraft = $state('');
  let normalizedRenderAutoPairAllowedFollowingStringDraft = $derived(
    normalizeAutoPairAllowedFollowingString(renderAutoPairAllowedFollowingStringDraft)
  );
  let canAddRenderAutoPairAllowedFollowingString = $derived(
    normalizedRenderAutoPairAllowedFollowingStringDraft !== null
      && !renderAutoPairAllowedFollowingStrings.includes(normalizedRenderAutoPairAllowedFollowingStringDraft)
      && renderAutoPairAllowedFollowingStrings.length < maximumAutoPairAllowedFollowingStringCount
  );
  let activeColors = $derived(currentTheme === 'dark' ? darkColors : lightColors);
  let activeSettingsCategory = $derived(
    configurableDocumentFormatCategories.find(
      (category) => activeSettingsView === getDocumentFormatCategorySettingsView(category.id)
    ) ?? null
  );
  let activeSettingsFormat = $derived(
    configurableDocumentFormats.find(
      (format) => activeSettingsView === getDocumentFormatSettingsView(format.id)
    ) ?? null
  );

  function t(key: TranslationKey, values: TranslationValues = {}) {
    return translate(locale, key, values);
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

  async function selectSettingsView(view: SettingsView) {
    activeSettingsView = view;
    const category = configurableDocumentFormatCategories.find(item =>
      view === `category:${item.id}` || item.formatIds.some(id => view === `format:${id}`));
    if (category) expandedFormatCategories[category.id] = true;
    await tick();
    settingsContent?.scrollTo({ top: 0 });
    if (searchTokens.length) {
      settingsContent?.querySelector('.search-match')?.scrollIntoView({ block: 'center' });
    }
  }

  function handleSettingsKeydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      searchInput?.focus();
      searchInput?.select();
    } else if (event.key === 'Escape' && searchQuery) {
      event.preventDefault();
      searchQuery = '';
      searchInput?.focus();
    }
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.isComposing || !['ArrowDown', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Enter' && searchTokens.length && searchResults[0]) {
      void selectSettingsView(searchResults[0].id);
    }
    settingsNavigation?.querySelector<HTMLButtonElement>('button[data-nav-item]')?.focus();
  }

  function handleNavigationKeydown(event: KeyboardEvent) {
    if (event.isComposing || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...settingsNavigation.querySelectorAll<HTMLButtonElement>('button')];
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    buttons[next]?.focus();
  }

  function toggleColorGroup(id: string) {
    expandedColorGroups = expandedColorGroups.includes(id)
      ? expandedColorGroups.filter(group => group !== id) : [...expandedColorGroups, id];
  }

  // 페이지 경로로 좁힌 검색에서도 실제 일치하는 설정 행을 눈에 띄게 표시한다.
  $effect(() => {
    const tokens = searchTokens;
    activeSettingsView;
    locale;
    let cancelled = false;
    void tick().then(() => {
      if (cancelled) return;
      settingsContent?.querySelectorAll<HTMLElement>('.settings-row, .settings-check-row, .auto-pair-following-heading, .settings-category-note').forEach(row => {
        const text = row.innerText;
        row.classList.toggle('search-match', tokens.length > 0 && tokens.some(token => matchesSettingsSearch(text, [token])));
      });
    });
    return () => { cancelled = true; };
  });

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

  function setMarkdownRenderFlag(
    field: 'hideHeadingMarkers' | 'showHeadingDividers',
    enabled: boolean
  ) {
    markdownRenderSettings = { ...markdownRenderSettings, [field]: enabled };
  }

  function updateThemeColor(
    theme: 'light' | 'dark',
    field: keyof SettingsThemePalette,
    value: string
  ) {
    if (theme === 'dark') {
      darkColors = { ...darkColors, [field]: value };
    } else {
      lightColors = { ...lightColors, [field]: value };
    }
  }

  function resetColorsToDefault() {
    if (editingTheme === 'dark') {
      darkColors = getSystemDefaultColors(true);
    } else {
      lightColors = getSystemDefaultColors(false);
    }
  }

  function openColorPicker(inputId: string) {
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

  function handleColorCodeKeydown(inputId: string, event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openColorPicker(inputId);
  }

  function formatDelimitedTableReorderDuration(durationMs: number): string {
    return t('common.seconds', {
      seconds: (durationMs / 1000).toFixed(durationMs % 1000 === 0 ? 0 : 2)
    });
  }
</script>

{#snippet colorSettingRow(id: string, labelText: string, theme: 'light' | 'dark', field: ColorField)}
  {@const pickerId = `${id}-picker`}
  {@const colors = theme === 'dark' ? darkColors : lightColors}
  <div class="settings-row color-row">
    <label for={id}>{labelText}</label>
    <div class="color-picker-wrapper">
      <input
        id={pickerId}
        class="color-picker-native"
        type="color"
        value={getColorInputValue(colors[field])}
        oninput={(event) => updateThemeColor(theme, field, (event.currentTarget as HTMLInputElement).value.toUpperCase())}
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


{#snippet navigationItem(view: SettingsView, label: string, icon: typeof Settings, nested = false)}
  {@const Icon = icon}
  <button type="button" class="sidebar-item" class:nested class:active={activeSettingsView === view}
    data-nav-item aria-current={activeSettingsView === view ? 'page' : undefined} onkeydown={handleNavigationKeydown}
    onclick={() => void selectSettingsView(view)} title={label}>
    <Icon size={16} aria-hidden="true"/><span>{label}</span>
  </button>
{/snippet}

{#snippet editorPreview(sourceMode = false)}
  {@const colors = sourceMode || activeSettingsView === 'renderAppearance' ? activeColors : previewColors}
  <section class="editor-preview" aria-label={t('settings.preview')} style:background={colors.renderBg}
    style:color={colors.renderText} style:border-color={colors.gutterBorder}>
    <div class="preview-heading" style:border-color={colors.gutterBorder}>
      <span>{t('settings.preview')}</span><span>{sourceMode ? 'notes.txt' : 'example.json'}</span>
    </div>
    <div class="preview-document" dir="ltr"
      style:font-family={sourceMode ? 'var(--font-notepad, Consolas, monospace)' : currentRenderFontFamilyCSS}
      style:font-size={(sourceMode ? sourceFontSize : renderFontSize) + 'pt'}
      style:font-weight={sourceMode ? '400' : colors.renderFontWeight}>
      {#if sourceMode}
        <div><span class="preview-line" style:color={colors.gutterText}>1</span><span>{t('settings.previewText')}</span></div>
        <div><span class="preview-line" style:color={colors.gutterText}>2</span><span>ABCDEFGHIJKLMNOPQRSTUVWXYZ</span></div>
        <div><span class="preview-line" style:color={colors.gutterText}>3</span><span>0123456789 ( ) [ ] {'{ }'}</span></div>
      {:else}
        <div><span class="preview-line" style:color={colors.gutterText}>1</span><span style:color={colors.brace}>{'{'}</span></div>
        <div><span class="preview-line" style:color={colors.gutterText}>2</span><span style:padding-inline-start={tabSize + 'ch'}><span style:color={colors.keyStrong}>"name"</span><span style:color={colors.mutedSyntax}>: </span><span style:color={colors.string}>"text-pad"</span>,</span></div>
        <div><span class="preview-line" style:color={colors.gutterText}>3</span><span style:padding-inline-start={tabSize + 'ch'}><span style:color={colors.keyStrong}>"fontSize"</span><span style:color={colors.mutedSyntax}>: </span><span style:color={colors.number}>{renderFontSize}</span>,</span></div>
        <div><span class="preview-line" style:color={colors.gutterText}>4</span><span style:padding-inline-start={tabSize + 'ch'}><span style:color={colors.keyStrong}>"enabled"</span><span style:color={colors.mutedSyntax}>: </span><span class="preview-boolean" style:color={colors.booleanTrueText} style:background={colors.booleanTrueBg} style:border-color={colors.booleanBorder}>true</span></span></div>
        <div><span class="preview-line" style:color={colors.gutterText}>5</span><span style:color={colors.brace}>{'}'}</span></div>
      {/if}
    </div>
  </section>
{/snippet}

<svelte:window onkeydown={handleSettingsKeydown} />

<div class="settings-window-container" data-theme={currentTheme} style="
  {getAdditionalRenderThemeStyle(activeColors)}
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
    <aside class="settings-sidebar" aria-label={t('settings.sidebarLabel')}>
      <div class="sidebar-heading"><Settings size={18} aria-hidden="true"/><span>{t('settings.windowTitle')}</span></div>
      <div class="settings-search">
        <Search size={15} aria-hidden="true"/>
        <input bind:this={searchInput} bind:value={searchQuery} onkeydown={handleSearchKeydown}
          type="search" aria-label={t('settings.search')} placeholder={t('settings.search')} autocomplete="off" spellcheck="false"/>
        {#if searchQuery}
          <button type="button" class="icon-button" aria-label={t('settings.clearSearch')}
            onclick={() => { searchQuery = ''; searchInput.focus(); }}><X size={14} aria-hidden="true"/></button>
        {:else}<kbd>Ctrl F</kbd>{/if}
      </div>
      <nav class="settings-navigation" bind:this={settingsNavigation} aria-label={t('settings.sidebarLabel')}>
        {#if searchTokens.length}
          <p class="navigation-label" role="status">{t('settings.searchResults', { count: searchResults.length })}</p>
          {#each searchResults as result}
            {@const match = result.terms.find(term => matchesSettingsSearch(term, searchTokens))}
            <button type="button" class="sidebar-item search-result" class:active={activeSettingsView === result.id}
              data-nav-item aria-current={activeSettingsView === result.id ? 'page' : undefined} onkeydown={handleNavigationKeydown}
              onclick={() => void selectSettingsView(result.id)}>
              <span class="search-result-title">{result.title}</span>
              <span class="search-result-path">{result.path.join(' › ') || t('settings.windowTitle')}</span>
              {#if match}<span class="search-result-match">{match}</span>{/if}
            </button>
          {:else}
            <div class="search-empty"><Search size={24} aria-hidden="true"/><strong>{t('settings.noResults')}</strong><p>{t('settings.searchHint')}</p></div>
          {/each}
        {:else}
          {@render navigationItem('general', t('settings.general'), Settings)}
          <p class="navigation-label">{t('settings.editor')}</p>
          <div class="navigation-subheading"><FileCode2 size={15} aria-hidden="true"/>{t('settings.sourceMode')}</div>
          {@render navigationItem('sourceAppearance', t('settings.fontSettings'), Type, true)}
          <div class="navigation-subheading"><PaintRoller size={15} aria-hidden="true"/>{t('settings.renderMode')}</div>
          {@render navigationItem('renderAppearance', t('settings.fontSettings'), Type, true)}
          {@render navigationItem('renderColors', t('settings.colors'), Palette, true)}
          {@render navigationItem('renderEditing', t('settings.editing'), PenLine, true)}
          <p class="navigation-label">{t('settings.fileFormats')}</p>
          {#each configurableDocumentFormatCategories as category}
            <div class="sidebar-category-row">
              <button type="button" class="category-disclosure" aria-label={t('settings.toggleCategory', { category: t(category.labelKey) })}
                aria-expanded={expandedFormatCategories[category.id]} aria-controls={'settings-category-' + category.id} onkeydown={handleNavigationKeydown}
                onclick={() => expandedFormatCategories[category.id] = !expandedFormatCategories[category.id]}>
                <ChevronDown size={14} class={expandedFormatCategories[category.id] ? '' : 'collapsed'} aria-hidden="true"/>
              </button>
              {@render navigationItem(getDocumentFormatCategorySettingsView(category.id), t(category.labelKey), category.id === 'structured' ? Braces : category.id === 'table' ? Table2 : category.id === 'project' ? Code2 : FileText)}
            </div>
            <div id={'settings-category-' + category.id} hidden={!expandedFormatCategories[category.id]} class="format-children">
              {#if expandedFormatCategories[category.id]}
                {#each getDocumentFormatsForCategory(category) as format}
                  {@render navigationItem(getDocumentFormatSettingsView(format.id), t(format.labelKey), FileCode2, true)}
                {/each}
              {/if}
            </div>
          {/each}
          <div class="navigation-divider"></div>
          {@render navigationItem('transfer', t('settings.transfer.title'), Download)}
        {/if}
      </nav>
      <div class="sidebar-footer">text-pad <span>{t('settings.preferences')}</span></div>
    </aside>

    <main class="settings-main" aria-labelledby="settings-page-title">
      <header class="settings-page-header">
        <div class="settings-breadcrumb" aria-label={t('settings.location')}>
          <span>{t('settings.windowTitle')}</span>
          {#each activePage.path as part}<ChevronRight size={12} aria-hidden="true"/><span>{part}</span>{/each}
        </div>
        <h1 id="settings-page-title">{activePage.title}</h1>
        <p>{activePage.description}</p>
      </header>
      <div class="settings-content" bind:this={settingsContent}>
      <div class="settings-content-inner">
      {#if activeSettingsView === 'general'}
        <div class="settings-section">
          <h2 class="section-title">{t('settings.languageSection')}</h2>
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
          <h2 class="section-title">{t('settings.newDocumentSection')}</h2>
          <div class="settings-row">
            <label for="default-new-document-format-select">{t('settings.defaultNewDocumentFormat')}</label>
            <select
              id="default-new-document-format-select"
              bind:value={defaultNewDocumentFormat}
              class="tab-size-select wide-select"
            >
              {#each configurableDocumentFormatCategories as category}
                <optgroup label={t(category.labelKey)}>
                  {#each getDocumentFormatsForCategory(category) as format}
                    <option value={format.id}>{t(format.labelKey)}</option>
                  {/each}
                </optgroup>
              {/each}
            </select>
          </div>
          <p class="settings-category-note">{t('settings.defaultNewDocumentFormatDescription')}</p>
        </div>
      {:else if activeSettingsView === 'transfer'}
        <div class="settings-section">
          <h2 class="section-title">{t('settings.transfer.title')}</h2>
          <p class="settings-category-note">{t('settings.transfer.description')}</p>
          <div class="settings-transfer-actions">
            <button
              type="button"
              class="settings-transfer-button"
              disabled={isSettingsTransferBusy}
              onclick={() => void onImportSettings()}
            >
              <Upload size={15} aria-hidden="true"/>
              {t('settings.transfer.import')}
            </button>
            <button
              type="button"
              class="settings-transfer-button"
              disabled={isSettingsTransferBusy}
              onclick={() => void onExportSettings()}
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
          <h2 class="section-title">{t('settings.fontSettings')}</h2>
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
              <button type="button" class="adjust-btn" aria-label={t('settings.decreaseFont')} onclick={() => sourceFontSize = Math.max(6, sourceFontSize - 1)}>-</button>
              <button type="button" class="adjust-btn" aria-label={t('settings.increaseFont')} onclick={() => sourceFontSize = Math.min(72, sourceFontSize + 1)}>+</button>
            </div>
          </div>
        </div>
        {@render editorPreview(true)}
      {:else if activeSettingsView === 'renderAppearance'}
        <div class="settings-section">
          <h2 class="section-title">{t('settings.displayAndFont')}</h2>
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
              <button type="button" class="adjust-btn" aria-label={t('settings.decreaseFont')} onclick={() => renderFontSize = Math.max(6, renderFontSize - 1)}>-</button>
              <button type="button" class="adjust-btn" aria-label={t('settings.increaseFont')} onclick={() => renderFontSize = Math.min(72, renderFontSize + 1)}>+</button>
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
            <select id="render-font-family-select-window" bind:value={renderFontFamily} class="tab-size-select wide-select centered-select">
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


        {@render editorPreview()}
      {:else if activeSettingsView === 'renderColors'}
        <div class="palette-toolbar">
          <div class="theme-edit-toggle" aria-label={t('settings.editingPalette')}>
            <button type="button" class="theme-toggle-btn" class:active={editingTheme === 'light'} aria-pressed={editingTheme === 'light'} onclick={() => selectedEditingTheme = 'light'}><Sun size={15} aria-hidden="true"/>{t('settings.themeLight')}</button>
            <button type="button" class="theme-toggle-btn" class:active={editingTheme === 'dark'} aria-pressed={editingTheme === 'dark'} onclick={() => selectedEditingTheme = 'dark'}><Moon size={15} aria-hidden="true"/>{t('settings.themeDark')}</button>
          </div>
          <button type="button" class="reset-colors-btn" onclick={resetColorsToDefault}>{t('settings.resetColors')}</button>
        </div>
        <p class="settings-category-note">{t('settings.paletteHint')}</p>
        {@render editorPreview()}
        <div class="settings-row">
          <label for={'render-font-weight-window-' + editingTheme}>{t('settings.fontWeight')}</label>
          <select id={'render-font-weight-window-' + editingTheme} class="tab-size-select font-weight-select"
            value={previewColors.renderFontWeight}
            onchange={(event) => updateThemeColor(editingTheme, 'renderFontWeight', event.currentTarget.value)}>
            <option value="300">{t('settings.weightLight')}</option><option value="400">{t('settings.weightNormal')}</option>
            <option value="500">{t('settings.weightMedium')}</option><option value="600">{t('settings.weightSemiBold')}</option>
            <option value="700">{t('settings.weightBold')}</option>
          </select>
        </div>
        <div class="color-groups">
          {#each settingsColorGroups as group}
            {@const expanded = searchTokens.length > 0 || expandedColorGroups.includes(group.id)}
            <section class="color-group">
              <h2><button type="button" class="color-group-toggle" aria-expanded={expanded} aria-controls={'color-group-' + group.id}
                onclick={() => toggleColorGroup(group.id)} disabled={searchTokens.length > 0}>
                <ChevronDown size={14} class={expanded ? '' : 'collapsed'} aria-hidden="true"/>
                <span>{t(group.label)}</span><span class="group-count">{group.fields.length}</span>
              </button></h2>
              <div id={'color-group-' + group.id} class="color-group-fields" hidden={!expanded}>
                {#each group.fields as item}
                  {@render colorSettingRow('color-' + item.id + '-window-' + editingTheme, t(item.label), editingTheme, item.field)}
                {/each}
              </div>
            </section>
          {/each}
        </div>
      {:else if activeSettingsView === 'renderEditing'}
        <div class="settings-section">
          <h2 class="section-title">{t('settings.autoInput')}</h2>
          <label class="settings-check-row" for="render-auto-pair-editing-window">
            <input id="render-auto-pair-editing-window" class="settings-checkbox" type="checkbox" bind:checked={renderAutoPairEditing}/>
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
                    <X size={12} aria-hidden="true"/>
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
                <Plus size={13} aria-hidden="true"/>
                {t('settings.autoPair.addFollowingString')}
              </button>
            </div>
          </div>
          <label class="settings-check-row" for="render-auto-symbol-substitution-window">
            <input id="render-auto-symbol-substitution-window" class="settings-checkbox" type="checkbox" bind:checked={renderAutoSymbolSubstitution}/>
            <span class="settings-check-copy">
              <span class="settings-check-title">{t('settings.autoSymbols.title')}</span>
              <span class="settings-check-description">{t('settings.autoSymbols.description')}</span>
            </span>
          </label>
          <label class="settings-check-row" for="render-preserve-indent-on-enter-window">
            <input id="render-preserve-indent-on-enter-window" class="settings-checkbox" type="checkbox" bind:checked={renderPreserveIndentOnEnter}/>
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
              <h2 class="section-title">{t(activeSettingsCategory.labelKey)}</h2>
              <span class="settings-check-description">{t(activeSettingsCategory.descriptionKey)}</span>
            </div>
            <div class="settings-category-formats" aria-label={t('settings.categoryFormats', { category: t(activeSettingsCategory.labelKey) })}>
              {#each getDocumentFormatsForCategory(activeSettingsCategory) as format}
                <button type="button" class="settings-format-chip" onclick={() => void selectSettingsView(getDocumentFormatSettingsView(format.id))}>{t(format.labelKey)}<ChevronRight size={12} aria-hidden="true"/></button>
              {/each}
            </div>
          </div>

          {#if activeSettingsCategory.id === 'table'}
            <div class="settings-format-module">
              <h3 class="settings-subsection-title">{t('settings.table.display')}</h3>
              <label class="settings-check-row" for="delimited-table-highlight-header-window">
                <input id="delimited-table-highlight-header-window" class="settings-checkbox" type="checkbox" bind:checked={delimitedTableHighlightHeader}/>
                <span class="settings-check-copy">
                  <span class="settings-check-title">{t('settings.table.highlightHeader.title')}</span>
                  <span class="settings-check-description">{t('settings.table.highlightHeader.description')}</span>
                </span>
              </label>
              <label class="settings-check-row" for="delimited-table-show-row-indices-window">
                <input id="delimited-table-show-row-indices-window" class="settings-checkbox" type="checkbox" bind:checked={delimitedTableShowRowIndices}/>
                <span class="settings-check-copy">
                  <span class="settings-check-title">{t('settings.table.rowNumbers.title')}</span>
                  <span class="settings-check-description">{t('settings.table.rowNumbers.description')}</span>
                </span>
              </label>
            </div>

            <div class="settings-format-module">
              <h3 class="settings-subsection-title">{t('settings.table.reorderSection')}</h3>
              <label class="settings-check-row" for="delimited-table-reorder-animation-window">
                <input id="delimited-table-reorder-animation-window" class="settings-checkbox" type="checkbox" bind:checked={delimitedTableAnimateReorder}/>
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
                <output class="settings-duration-value">{formatDelimitedTableReorderDuration(delimitedTableReorderDurationMs)}</output>
              </label>
            </div>
          {:else}
            <p class="settings-category-note">{t('settings.categoryNote')}</p>
          {/if}
        </div>
      {:else if activeSettingsFormat}
        <div class="settings-section">
          <div class="settings-format-module">
            <div class="settings-format-heading">
              <h2 class="section-title">{t(activeSettingsFormat.labelKey)}</h2>
              <span class="settings-check-description">
                {activeSettingsFormat.extensions.length > 0
                  ? activeSettingsFormat.extensions.map((extension) => `.${extension}`).join(', ')
                  : t('settings.noExtension')}
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
              <h3 class="settings-subsection-title">{t('settings.markdown.headings')}</h3>
              <label class="settings-check-row" for="markdown-hide-heading-markers-window">
                <input
                  id="markdown-hide-heading-markers-window"
                  class="settings-checkbox"
                  type="checkbox"
                  checked={markdownRenderSettings.hideHeadingMarkers}
                  onchange={(event) => setMarkdownRenderFlag('hideHeadingMarkers', (event.currentTarget as HTMLInputElement).checked)}
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
                  onchange={(event) => setMarkdownRenderFlag('showHeadingDividers', (event.currentTarget as HTMLInputElement).checked)}
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
      <footer class="settings-status"><Check size={14} aria-hidden="true"/><span>{t('settings.autoApply')}</span></footer>
    </main>
  </div>
</div>

<style>
  .settings-window-container {
    --settings-accent: var(--accent-color);
    width: 100%; height: 100dvh; min-height: 0; overflow: hidden;
    background: var(--bg-editor); color: var(--text-color);
    font-family: var(--font-ui); font-size: 13px; line-height: 1.5;
  }
  .settings-window-container[data-theme='dark'] { --settings-accent: #6cb6ff; }
  .settings-window-container :global(*) { box-sizing: border-box; }
  .settings-window-container :global(button), .settings-window-container :global(input),
  .settings-window-container :global(select) { font: inherit; }
  .settings-window-container :global(button) { color: inherit; cursor: pointer; }
  .settings-window-container :global(button:disabled), .settings-window-container :global(input:disabled) { cursor: default; opacity: .55; }
  .settings-window-container :global(:focus-visible) { outline: 2px solid var(--settings-accent); outline-offset: 2px; }
  .settings-window-container :global([hidden]) { display: none !important; }
  .settings-window-container :global(svg) { flex-shrink: 0; }
  .settings-body { display: flex; width: 100%; height: 100%; min-height: 0; }
  .settings-sidebar {
    width: 238px; flex-shrink: 0; display: flex; flex-direction: column;
    background: var(--bg-window); border-inline-end: 1px solid var(--border-color); user-select: none;
  }
  .sidebar-heading { display: flex; align-items: center; gap: 10px; padding: 22px 18px 16px; font-size: 16px; font-weight: 600; }
  .sidebar-heading :global(svg) { color: var(--text-muted); }
  .settings-search {
    display: flex; align-items: center; gap: 7px; margin: 0 12px 12px; padding: 0 9px;
    min-height: 34px; border: 1px solid var(--border-color); border-radius: 5px;
    background: var(--bg-editor); color: var(--text-muted);
  }
  .settings-search:focus-within { border-color: var(--settings-accent); box-shadow: 0 0 0 1px var(--settings-accent); }
  .settings-search input { width: 100%; min-width: 0; padding: 7px 0; border: 0; outline: none; background: transparent; color: var(--text-color); font-size: 12px; }
  .settings-search input:focus-visible { outline: none; }
  .settings-search input::-webkit-search-cancel-button { display: none; }
  .settings-search kbd { white-space: nowrap; font-size: 10px; font-family: inherit; opacity: .8; }
  .icon-button { display: flex; align-items: center; justify-content: center; padding: 2px; border: 0; border-radius: 3px; background: transparent; }
  .icon-button:hover { background: var(--bg-menu-hover); }
  .settings-navigation { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 0 9px 16px; scrollbar-width: thin; }
  .navigation-label { margin: 18px 10px 7px; font-size: 11px; color: var(--text-muted); font-weight: 600; letter-spacing: .3px; }
  .navigation-subheading { display: flex; align-items: center; gap: 8px; min-height: 30px; padding: 2px 10px; color: var(--text-muted); font-size: 12px; }
  .navigation-subheading:not(:first-of-type) { margin-top: 4px; }
  .sidebar-item {
    display: flex; align-items: center; gap: 9px; width: 100%; min-height: 33px;
    padding: 6px 10px; margin: 1px 0; border: 1px solid transparent; border-radius: 4px;
    background: transparent; text-align: start; font-size: 12px;
  }
  .sidebar-item > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sidebar-item :global(svg) { color: var(--text-muted); }
  .sidebar-item.nested { padding-inline-start: 30px; }
  .sidebar-item:hover, .category-disclosure:hover { background: var(--bg-menu-hover); }
  .sidebar-item.active { background: color-mix(in srgb, var(--settings-accent) 13%, var(--bg-window)); color: var(--settings-accent); font-weight: 600; border-color: color-mix(in srgb, var(--settings-accent) 12%, transparent); }
  .sidebar-item.active :global(svg) { color: var(--settings-accent); }
  .sidebar-category-row { display: flex; align-items: center; }
  .sidebar-category-row .sidebar-item { flex: 1; min-width: 0; padding-inline-start: 5px; }
  .category-disclosure { display: flex; align-items: center; justify-content: center; width: 22px; height: 30px; padding: 0; border: none; border-radius: 4px; background: transparent; color: var(--text-muted); }
  .settings-window-container :global(.collapsed) { transform: rotate(-90deg); }
  :global([dir='rtl']) .settings-window-container :global(.collapsed) { transform: rotate(90deg); }
  .format-children { padding-inline-start: 8px; }
  .navigation-divider { border-top: 1px solid var(--border-color); margin: 16px 8px 10px; }
  .sidebar-footer { display: flex; gap: 8px; align-items: center; min-height: 38px; padding: 0 18px; border-top: 1px solid var(--border-color); color: var(--text-muted); font-size: 11px; }
  .sidebar-footer span { opacity: .7; }
  .search-result { flex-direction: column; align-items: stretch; gap: 2px; margin-bottom: 4px; padding: 9px 10px; }
  .search-result-title { font-weight: 600; }
  .search-result-path, .search-result-match { font-size: 11px; color: var(--text-muted); font-weight: 400; }
  .search-result-match { color: var(--settings-accent); }
  .search-empty { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 22px 12px; color: var(--text-muted); font-size: 12px; }
  .search-empty p { margin: 0; }
  .settings-main { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; }
  .settings-page-header { padding: 20px 28px 18px; border-bottom: 1px solid var(--border-color); }
  .settings-breadcrumb { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; color: var(--text-muted); font-size: 11px; margin-bottom: 8px; }
  .settings-page-header h1 { margin: 0; font-size: 22px; font-weight: 600; line-height: 1.3; letter-spacing: -.5px; }
  .settings-page-header > p { margin: 7px 0 0; color: var(--text-muted); font-size: 12px; }
  .settings-content { flex: 1; min-height: 0; overflow: auto; padding: 24px 28px; scroll-padding-block: 16px; scrollbar-width: thin; }
  .settings-content-inner { display: flex; flex-direction: column; gap: 22px; width: 100%; max-width: 900px; margin-inline-end: auto; }
  .settings-section { display: flex; flex-direction: column; gap: 12px; }
  .settings-section + .settings-section { margin-top: 5px; }
  .section-title { display: flex; align-items: center; gap: 12px; margin: 0 0 4px; font-size: 13px; font-weight: 600; color: var(--text-color); }
  .section-title::after { content: ''; flex: 1; border-top: 1px solid var(--border-color); }
  .settings-row { display: grid; grid-template-columns: minmax(130px, 220px) minmax(0, 1fr); align-items: center; gap: 18px; min-height: 32px; font-size: 13px; border-radius: 4px; }
  .settings-row > label { line-height: 1.45; }
  .settings-status { display: flex; align-items: center; gap: 7px; min-height: 38px; padding: 8px 28px; border-top: 1px solid var(--border-color); color: var(--text-muted); font-size: 11px; }
  .settings-status :global(svg) { color: #16835d; }
  .settings-check-row { display: flex; align-items: flex-start; gap: 10px; padding: 5px 0; font-size: 13px; cursor: pointer; border-radius: 4px; }
  .settings-checkbox { width: 15px; height: 15px; flex-shrink: 0; margin: 3px 0 0; accent-color: var(--settings-accent); }
  .settings-check-copy { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .settings-check-title { color: var(--text-color); font-weight: 500; }
  .settings-check-description, .settings-category-note { color: var(--text-muted); font-size: 12px; line-height: 1.6; }
  .settings-category-note { margin: 0; }
  .settings-content :global(.search-match) { background: color-mix(in srgb, #facc15 16%, var(--bg-editor)); box-shadow: 0 0 0 4px color-mix(in srgb, #facc15 16%, var(--bg-editor)); outline: 1px solid color-mix(in srgb, #eab308 40%, transparent); }
  .tab-size-select, .font-size-num, .auto-pair-following-input { height: 32px; max-width: 100%; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-editor); color: var(--text-color); padding: 4px 9px; }
  .tab-size-select { width: 110px; text-align: start; }
  .wide-select, .language-select { width: 280px; }
  .font-weight-select { width: 160px; }
  .size-control { display: flex; align-items: center; gap: 5px; }
  .font-size-num { width: 70px; text-align: center; }
  .adjust-btn { display: flex; align-items: center; justify-content: center; width: 29px; height: 30px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-window); }
  .adjust-btn:hover { background: var(--bg-menu-hover); }
  .auto-pair-following-settings { display: flex; flex-direction: column; gap: 10px; margin: 0 0 4px 25px; padding: 12px 14px; border-inline-start: 2px solid var(--border-color); background: var(--bg-window); }
  :global([dir='rtl']) .auto-pair-following-settings { margin-inline-start: 25px; margin-inline-end: 0; }
  .auto-pair-following-settings.disabled, .settings-duration-row.disabled { opacity: .55; }
  .auto-pair-following-heading { display: flex; flex-direction: column; gap: 4px; }
  .auto-pair-following-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .auto-pair-following-chip { display: inline-flex; align-items: center; gap: 4px; min-height: 26px; max-width: 100%; padding: 2px 4px 2px 8px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-editor); font-size: 12px; }
  .auto-pair-following-chip.fixed { gap: 8px; padding-inline-end: 8px; }
  .auto-pair-following-chip code { overflow-wrap: anywhere; font-family: Consolas, monospace; }
  .auto-pair-following-fixed-label { color: var(--text-muted); font-size: 10px; }
  .auto-pair-following-remove { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: 0; border-radius: 3px; background: transparent; padding: 0; }
  .auto-pair-following-remove:hover:not(:disabled) { background: var(--bg-menu-hover); }
  .auto-pair-following-add-row { display: flex; gap: 7px; max-width: 380px; }
  .auto-pair-following-input { flex: 1; min-width: 0; }
  .auto-pair-following-add, .settings-transfer-button, .reset-colors-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 32px; padding: 5px 12px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-window); font-size: 12px; }
  .auto-pair-following-add { white-space: nowrap; }
  .auto-pair-following-add:hover:not(:disabled), .settings-transfer-button:hover:not(:disabled), .reset-colors-btn:hover { background: var(--bg-menu-hover); }
  .settings-transfer-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .settings-transfer-status { margin: 0; color: #16753c; font-size: 12px; }
  .settings-transfer-status.warning { color: #946200; }
  .settings-transfer-status.error { color: var(--error-text, #b91c1c); }
  :global(.theme-dark) .settings-transfer-status { color: #86efac; }
  :global(.theme-dark) .settings-transfer-status.warning { color: #fde68a; }
  :global(.theme-dark) .settings-transfer-status.error { color: #fca5a5; }
  .settings-duration-row { display: grid; grid-template-columns: auto minmax(70px, 240px) 54px; gap: 12px; align-items: center; padding-inline-start: 25px; font-size: 12px; }
  .settings-duration-range { width: 100%; min-width: 0; margin: 0; accent-color: var(--settings-accent); }
  .settings-duration-value { color: var(--text-muted); font-variant-numeric: tabular-nums; text-align: end; }
  .settings-format-module { display: flex; flex-direction: column; gap: 12px; }
  .settings-format-module + .settings-format-module { margin-top: 8px; padding-top: 20px; border-top: 1px solid var(--border-color); }
  .settings-format-heading { display: flex; flex-direction: column; gap: 3px; }
  .settings-subsection-title { margin: 0; font-size: 13px; font-weight: 600; }
  .settings-category-formats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 7px; }
  .settings-format-chip { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 36px; text-align: start; padding: 7px 10px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-editor); font-size: 12px; }
  .settings-format-chip:hover { background: var(--bg-window); border-color: var(--settings-accent); }
  .settings-format-chip :global(svg) { color: var(--text-muted); }
  .markdown-heading-settings { display: flex; flex-direction: column; border: 1px solid var(--border-color); border-radius: 5px; }
  .markdown-heading-setting-row { display: grid; grid-template-columns: minmax(70px, 1fr) 65px 16px 96px; gap: 8px; align-items: center; padding: 8px 12px; font-size: 12px; }
  .markdown-heading-setting-row + .markdown-heading-setting-row { border-top: 1px solid var(--border-color); }
  .markdown-heading-setting-row label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .markdown-heading-setting-label { font-weight: 500; }
  .markdown-heading-size-input, .markdown-heading-weight-select { width: 100%; }
  .markdown-heading-unit { color: var(--text-muted); }
  .palette-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
  .theme-edit-toggle { display: flex; gap: 2px; padding: 3px; border: 1px solid var(--border-color); border-radius: 5px; background: var(--bg-window); }
  .theme-toggle-btn { display: flex; align-items: center; gap: 7px; min-height: 28px; padding: 3px 13px; border: 1px solid transparent; border-radius: 3px; background: transparent; font-size: 12px; }
  .theme-toggle-btn.active { background: var(--bg-editor); border-color: var(--border-color); box-shadow: 0 1px 2px #0000000a; font-weight: 600; }
  .theme-toggle-btn:hover { background: var(--bg-editor); }
  .editor-preview { border: 1px solid; border-radius: 5px; overflow: hidden; }
  .preview-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 7px 12px; border-bottom: 1px solid; font-family: var(--font-ui); font-size: 11px; }
  .preview-heading > span:last-child { opacity: .7; }
  .preview-document { padding: 13px 0; overflow: auto; max-height: 280px; line-height: 1.65; }
  .preview-document > div { display: flex; white-space: pre; padding-inline-end: 16px; }
  .preview-line { display: inline-block; flex-shrink: 0; width: 42px; text-align: end; padding-inline-end: 15px; font-size: 11px; user-select: none; }
  .preview-boolean { border: 1px solid; border-radius: 3px; padding: 0 3px; }
  .color-groups { display: flex; flex-direction: column; border: 1px solid var(--border-color); border-radius: 5px; }
  .color-group + .color-group { border-top: 1px solid var(--border-color); }
  .color-group h2 { margin: 0; font-size: 12px; }
  .color-group-toggle { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 39px; padding: 9px 13px; border: 0; background: var(--bg-window); font-weight: 600; text-align: start; }
  .color-group-toggle:disabled { opacity: 1; }
  .group-count { margin-inline-start: auto; font-size: 11px; color: var(--text-muted); font-weight: 400; }
  .color-group-fields { padding: 4px 14px; }
  .color-row { grid-template-columns: minmax(0, 1fr) 96px; min-height: 42px; font-size: 12px; }
  .color-row + .color-row { border-top: 1px solid color-mix(in srgb, var(--border-color) 65%, transparent); }
  .color-picker-wrapper { position: relative; }
  .color-picker-native { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  .color-text-input { width: 96px; min-height: 27px; border: 1px solid #9ca3af; border-radius: 4px; padding: 3px 7px; text-align: center; cursor: pointer; }
  .color-picker-wrapper .color-text-input { font-family: Consolas, monospace; font-size: 12px; font-weight: 600; }
  .color-text-input:hover { outline: 1px solid var(--settings-accent); outline-offset: 1px; }
  @media (min-width: 1200px) {
    .settings-sidebar { width: 254px; }
    .settings-content, .settings-page-header { padding-inline: 36px; }
    .settings-content-inner { max-width: 820px; }
  }
  @media (max-width: 850px) {
    .settings-sidebar { width: 212px; }
    .settings-content { padding: 20px; }
    .settings-page-header { padding: 18px 20px 16px; }
    .settings-page-header h1 { font-size: 20px; }
    .settings-row { grid-template-columns: minmax(100px, 170px) minmax(0, 1fr); gap: 12px; }
    .color-row { grid-template-columns: minmax(0, 1fr) 96px; }
    .settings-status { padding-inline: 20px; }
  }
  @media (max-width: 640px) {
    .settings-sidebar { width: 178px; }
    .sidebar-heading { padding-inline: 14px; }
    .settings-navigation { padding-inline: 5px; }
    .sidebar-item { font-size: 11px; gap: 7px; }
    .sidebar-item.nested { padding-inline-start: 24px; }
    .settings-search { margin-inline: 9px; }
    .settings-search kbd { display: none; }
    .settings-content, .settings-page-header { padding-inline: 16px; }
    .settings-row { grid-template-columns: minmax(0, 1fr); gap: 6px; }
    .color-row { grid-template-columns: minmax(0, 1fr) 96px; }
    .markdown-heading-setting-row { grid-template-columns: minmax(45px, 1fr) 52px 9px 65px; gap: 4px; padding-inline: 6px; }
    .settings-status { padding-inline: 16px; }
  }

</style>
