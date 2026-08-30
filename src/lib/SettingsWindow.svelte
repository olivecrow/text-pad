<script lang="ts">
  import {
    Braces,
    ChevronDown,
    Code2,
    Download,
    FileCode2,
    FileText,
    Moon,
    PaintRoller,
    PenLine,
    Plus,
    Settings,
    Sun,
    Table2,
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
  type SettingsView =
    | 'general'
    | 'sourceAppearance'
    | 'renderAppearance'
    | 'renderEditing'
    | FormatCategorySettingsView
    | FormatSettingsView;
  type SettingsTransferStatus = { kind: 'success' | 'warning' | 'error'; message: string };
  type ColorField = Exclude<keyof SettingsThemePalette, 'renderFontWeight'>;

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
  let isSourceSettingsExpanded = $state(true);
  let isRenderSettingsExpanded = $state(true);
  let expandedFormatCategories = $state<Record<DocumentFormatCategoryId, boolean>>({
    document: true,
    structured: true,
    project: true,
    table: true,
    subtitle: true
  });
  let editingTheme = $state<'light' | 'dark'>('light');
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

  function selectDocumentFormatCategory(categoryId: DocumentFormatCategoryId) {
    const categoryView = getDocumentFormatCategorySettingsView(categoryId);
    const wasActive = activeSettingsView === categoryView;
    activeSettingsView = categoryView;
    expandedFormatCategories = {
      ...expandedFormatCategories,
      [categoryId]: wasActive ? !expandedFormatCategories[categoryId] : true
    };
  }

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
          <h4 class="section-title">{t('settings.newDocumentSection')}</h4>
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
        <div class="settings-section">
          <h4 class="section-title">{t('settings.transfer.title')}</h4>
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
              <button type="button" class="adjust-btn" onclick={() => sourceFontSize = Math.max(6, sourceFontSize - 1)}>-</button>
              <button type="button" class="adjust-btn" onclick={() => sourceFontSize = Math.min(72, sourceFontSize + 1)}>+</button>
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
              <button type="button" class="adjust-btn" onclick={() => renderFontSize = Math.max(6, renderFontSize - 1)}>-</button>
              <button type="button" class="adjust-btn" onclick={() => renderFontSize = Math.min(72, renderFontSize + 1)}>+</button>
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

        <div class="settings-section">
          <div class="settings-row theme-section-heading">
            <h4 class="section-title">{t('settings.themeColors')}</h4>
            <div class="theme-edit-toggle">
              <button
                type="button"
                class="theme-toggle-btn"
                class:active={editingTheme === 'light'}
                onclick={() => editingTheme = 'light'}
              >
                <Sun size={16} class="tab-icon"/> {t('settings.themeLight')}
              </button>
              <button
                type="button"
                class="theme-toggle-btn"
                class:active={editingTheme === 'dark'}
                onclick={() => editingTheme = 'dark'}
              >
                <Moon size={16} class="tab-icon"/> {t('settings.themeDark')}
              </button>
            </div>
          </div>

          {@render colorSettingRow(`color-render-bg-window-${editingTheme}`, t('settings.color.renderBackground'), editingTheme, 'renderBg')}
          {@render colorSettingRow(`color-render-text-window-${editingTheme}`, t('settings.color.renderText'), editingTheme, 'renderText')}

          <div class="settings-row color-row">
            <label for={`render-font-weight-window-${editingTheme}`}>{t('settings.fontWeight')}</label>
            <select
              id={`render-font-weight-window-${editingTheme}`}
              class="tab-size-select font-weight-select"
              value={editingTheme === 'dark' ? darkColors.renderFontWeight : lightColors.renderFontWeight}
              onchange={(event) => updateThemeColor(editingTheme, 'renderFontWeight', (event.currentTarget as HTMLSelectElement).value)}
            >
              <option value="300">{t('settings.weightLight')}</option>
              <option value="400">{t('settings.weightNormal')}</option>
              <option value="500">{t('settings.weightMedium')}</option>
              <option value="600">{t('settings.weightSemiBold')}</option>
              <option value="700">{t('settings.weightBold')}</option>
            </select>
          </div>

          {@render colorSettingRow(`color-hl-code-bg-window-${editingTheme}`, t('settings.color.codeBackground'), editingTheme, 'codeBg')}
          {@render colorSettingRow(`color-hl-code-text-window-${editingTheme}`, t('settings.color.codeText'), editingTheme, 'codeText')}
          {@render colorSettingRow(`color-hl-key-strong-window-${editingTheme}`, t('settings.color.keyStrong'), editingTheme, 'keyStrong')}
          {@render colorSettingRow(`color-hl-key-medium-window-${editingTheme}`, t('settings.color.keyMedium'), editingTheme, 'keyMedium')}
          {@render colorSettingRow(`color-hl-key-light-window-${editingTheme}`, t('settings.color.keyLight'), editingTheme, 'keyLight')}
          {@render colorSettingRow(`color-hl-string-window-${editingTheme}`, t('settings.color.string'), editingTheme, 'string')}
          {@render colorSettingRow(`color-hl-number-window-${editingTheme}`, t('settings.color.number'), editingTheme, 'number')}
          {@render colorSettingRow(`color-hl-list-marker-window-${editingTheme}`, t('settings.color.listMarker'), editingTheme, 'listMarker')}
          {@render colorSettingRow(`color-hl-comment-window-${editingTheme}`, t('settings.color.comment'), editingTheme, 'comment')}
          {@render colorSettingRow(`color-hl-paren-window-${editingTheme}`, t('settings.color.parenthesis'), editingTheme, 'paren')}
          {@render colorSettingRow(`color-hl-bracket-window-${editingTheme}`, t('settings.color.bracket'), editingTheme, 'bracket')}
          {@render colorSettingRow(`color-hl-brace-window-${editingTheme}`, t('settings.color.brace'), editingTheme, 'brace')}
          {@render colorSettingRow(`color-indent-guide-window-${editingTheme}`, t('settings.color.indentGuide'), editingTheme, 'guide')}

          <div class="settings-action-row">
            <button type="button" class="reset-colors-btn" onclick={resetColorsToDefault}>
              {t('settings.resetColors')}
            </button>
          </div>
        </div>
      {:else if activeSettingsView === 'renderEditing'}
        <div class="settings-section">
          <h4 class="section-title">{t('settings.autoInput')}</h4>
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
              <h5 class="settings-subsection-title">{t('settings.table.reorderSection')}</h5>
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
              <h4 class="section-title">{t(activeSettingsFormat.labelKey)}</h4>
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
              <h5 class="settings-subsection-title">{t('settings.markdown.headings')}</h5>
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
</div>

<style>
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
  }

  .settings-sidebar {
    width: 180px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0.5rem 0;
    overflow-y: auto;
    border-right: 1px solid var(--border-color);
    background-color: var(--bg-window);
    user-select: none;
  }

  .sidebar-tree-group {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .sidebar-group,
  .sidebar-item {
    border: none;
    border-left: 3px solid transparent;
    outline: none;
    background: transparent;
    color: var(--text-color);
    font-family: var(--font-ui);
    font-size: 0.85rem;
    padding: 0.6rem 1rem;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.1s, color 0.1s;
  }

  .sidebar-group {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-weight: 600;
  }

  .settings-sidebar :global(.tree-chevron) {
    flex-shrink: 0;
    transition: transform 0.1s;
  }

  .settings-sidebar :global(.tree-chevron.collapsed) {
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
    border-left-color: var(--accent-color);
    background-color: var(--bg-menu-active);
    font-weight: 600;
  }

  .settings-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 1rem 1.25rem;
    overflow-y: auto;
    background-color: var(--bg-editor);
  }

  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border-color);
  }

  .settings-section:last-child {
    padding-bottom: 0;
    border-bottom: none;
  }

  .section-title {
    margin: 0;
    color: var(--accent-color);
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }

  .settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 28px;
    font-size: 0.85rem;
  }

  .theme-section-heading {
    margin-bottom: 0.75rem;
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

  .auto-pair-following-heading {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
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
    padding-top: 0.85rem;
    border-top: 1px solid var(--border-color);
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

  .settings-transfer-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
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
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .color-picker-native {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  .color-text-input {
    width: 92px;
    min-height: 28px;
    box-sizing: border-box;
    padding: 0;
    border: 1px solid #9ca3af;
    border-radius: 4px;
    outline: none;
    font-family: Consolas, "Courier New", monospace;
    font-size: 0.8rem;
    font-weight: 600;
    line-height: 26px;
    text-align: center;
    text-transform: uppercase;
    cursor: pointer;
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
    padding: 0.4rem 0.8rem;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    outline: none;
    background-color: var(--bg-window);
    color: var(--text-color);
    font-family: var(--font-ui);
    font-size: 0.8rem;
    cursor: pointer;
    transition: background-color 0.1s;
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
    border-radius: 4px;
    outline: none;
    background-color: var(--bg-editor);
    color: var(--text-color);
    font-family: var(--font-ui);
    font-size: 0.85rem;
    text-align: center;
  }

  .adjust-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    outline: none;
    background-color: var(--bg-menu-hover);
    color: var(--text-color);
    font-weight: bold;
    cursor: pointer;
  }

  .adjust-btn:hover {
    background-color: var(--bg-menu-active);
  }

  .theme-edit-toggle {
    display: flex;
    gap: 4px;
    padding: 2px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background-color: var(--bg-window);
  }

  .theme-toggle-btn {
    padding: 4px 12px;
    border: none;
    border-radius: 4px;
    outline: none;
    background: transparent;
    color: var(--text-color);
    font-size: 0.8rem;
    cursor: pointer;
    transition: background 0.1s;
  }

  .theme-toggle-btn:hover {
    background-color: var(--bg-menu-hover);
  }

  .theme-toggle-btn.active {
    background-color: var(--bg-editor);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .tab-size-select {
    width: 100px;
    padding: 0.2rem 0.4rem;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    outline: none;
    background-color: var(--bg-editor);
    color: var(--text-color);
    font-family: var(--font-ui);
    font-size: 0.85rem;
    text-align: center;
  }

  .wide-select {
    width: 195px;
  }

  .centered-select {
    text-align-last: center;
  }

  .font-weight-select {
    width: 140px;
  }
</style>
