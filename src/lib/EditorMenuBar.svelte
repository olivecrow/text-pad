<script lang="ts">
  import {
    ChevronDown,
    Download,
    FileCode2,
    FileText,
    Moon,
    PaintRoller,
    Settings,
    Sun
  } from '@lucide/svelte';
  import {
    translate,
    type AppLocale,
    type TranslationKey,
    type TranslationValues
  } from '$lib/i18n';

  type EditorMenuId = 'file' | 'edit' | 'help';

  interface EditorMenuCommands {
    newFile: () => void;
    openFile: () => void | Promise<void>;
    saveFile: () => void | Promise<void>;
    saveFileAs: () => void | Promise<void>;
    exit: () => void;
    undo: () => void;
    redo: () => void;
    cut: () => void | Promise<void>;
    copy: () => void | Promise<void>;
    paste: () => void | Promise<void>;
    deleteSelection: () => void;
    selectAll: () => void;
    find: () => void;
    insertDateTime: () => void;
    checkForUpdates: () => void;
    installUpdate: () => void;
    openAbout: () => void;
    toggleNewDocumentFormatPicker: () => void;
    toggleTheme: () => void;
    toggleRenderMode: () => void;
    openSettings: (event: MouseEvent) => void | Promise<void>;
  }

  interface Props {
    locale: AppLocale;
    openDropdown: EditorMenuId | null;
    canUndo: boolean;
    canRedo: boolean;
    hasContent: boolean;
    errorMessage: string | null;
    isSyntaxError: boolean;
    availableUpdateVersion: string | null;
    isCheckingForUpdate: boolean;
    isInstallingUpdate: boolean;
    shouldShowNewDocumentFormatToolbar: boolean;
    isNewDocumentFormatPickerOpen: boolean;
    newDocumentFormatTriggerEl: HTMLButtonElement | null;
    currentTheme: 'light' | 'dark';
    isRenderMode: boolean;
    commands: EditorMenuCommands;
  }

  let {
    locale,
    openDropdown = $bindable(),
    canUndo,
    canRedo,
    hasContent,
    errorMessage,
    isSyntaxError,
    availableUpdateVersion,
    isCheckingForUpdate,
    isInstallingUpdate,
    shouldShowNewDocumentFormatToolbar,
    isNewDocumentFormatPickerOpen,
    newDocumentFormatTriggerEl = $bindable(),
    currentTheme,
    isRenderMode,
    commands
  }: Props = $props();

  function t(key: TranslationKey, values: TranslationValues = {}) {
    return translate(locale, key, values);
  }

  function toggleDropdown(menu: EditorMenuId, event: MouseEvent) {
    event.stopPropagation();
    openDropdown = openDropdown === menu ? null : menu;
  }

  function handleMouseEnter(menu: EditorMenuId) {
    if (openDropdown !== null) {
      openDropdown = menu;
    }
  }
</script>

<nav class="menu-bar">
  <div class="menu-left">
    <div class="menu-item-container">
      <button
        type="button"
        class="menu-trigger"
        class:active={openDropdown === 'file'}
        aria-haspopup="menu"
        aria-expanded={openDropdown === 'file'}
        onclick={(event) => toggleDropdown('file', event)}
        onmouseenter={() => handleMouseEnter('file')}
      >
        {t('menu.file')}
      </button>
      {#if openDropdown === 'file'}
        <div class="dropdown-menu" role="menu">
          <button type="button" class="dropdown-item" onclick={() => commands.newFile()}>
            <span class="item-label">{t('menu.newTab')}</span>
            <span class="shortcut-label">Ctrl+N</span>
          </button>
          <button type="button" class="dropdown-item" onclick={() => void commands.openFile()}>
            <span class="item-label">{t('menu.open')}</span>
            <span class="shortcut-label">Ctrl+O</span>
          </button>
          <button type="button" class="dropdown-item" onclick={() => void commands.saveFile()}>
            <span class="item-label">{t('menu.save')}</span>
            <span class="shortcut-label">Ctrl+S</span>
          </button>
          <button type="button" class="dropdown-item" onclick={() => void commands.saveFileAs()}>
            <span class="item-label">{t('menu.saveAs')}</span>
            <span class="shortcut-label">Ctrl+Shift+S</span>
          </button>
          <div class="menu-divider"></div>
          <button type="button" class="dropdown-item" onclick={() => commands.exit()}>
            <span class="item-label">{t('menu.exit')}</span>
            <span class="shortcut-label">Alt+F4</span>
          </button>
        </div>
      {/if}
    </div>

    <div class="menu-item-container">
      <button
        type="button"
        class="menu-trigger"
        class:active={openDropdown === 'edit'}
        aria-haspopup="menu"
        aria-expanded={openDropdown === 'edit'}
        onclick={(event) => toggleDropdown('edit', event)}
        onmouseenter={() => handleMouseEnter('edit')}
      >
        {t('menu.edit')}
      </button>
      {#if openDropdown === 'edit'}
        <div class="dropdown-menu" role="menu">
          <button type="button" class="dropdown-item" onclick={() => commands.undo()} disabled={!canUndo}>
            <span class="item-label">{t('menu.undo')}</span>
            <span class="shortcut-label">Ctrl+Z</span>
          </button>
          <button type="button" class="dropdown-item" onclick={() => commands.redo()} disabled={!canRedo}>
            <span class="item-label">{t('menu.redo')}</span>
            <span class="shortcut-label">Ctrl+Y</span>
          </button>
          <div class="menu-divider"></div>
          <button type="button" class="dropdown-item" onclick={() => void commands.cut()} disabled={!hasContent}>
            <span class="item-label">{t('menu.cut')}</span>
            <span class="shortcut-label">Ctrl+X</span>
          </button>
          <button type="button" class="dropdown-item" onclick={() => void commands.copy()} disabled={!hasContent}>
            <span class="item-label">{t('menu.copy')}</span>
            <span class="shortcut-label">Ctrl+C</span>
          </button>
          <button type="button" class="dropdown-item" onclick={() => void commands.paste()}>
            <span class="item-label">{t('menu.paste')}</span>
            <span class="shortcut-label">Ctrl+V</span>
          </button>
          <button type="button" class="dropdown-item" onclick={() => commands.deleteSelection()} disabled={!hasContent}>
            <span class="item-label">{t('menu.delete')}</span>
            <span class="shortcut-label">Del</span>
          </button>
          <div class="menu-divider"></div>
          <button type="button" class="dropdown-item" onclick={() => commands.selectAll()}>
            <span class="item-label">{t('menu.selectAll')}</span>
            <span class="shortcut-label">Ctrl+A</span>
          </button>
          <button type="button" class="dropdown-item" onclick={() => commands.find()}>
            <span class="item-label">{t('search.find')}</span>
            <span class="shortcut-label">Ctrl+F</span>
          </button>
          <button type="button" class="dropdown-item" onclick={() => commands.insertDateTime()}>
            <span class="item-label">{t('menu.dateTime')}</span>
            <span class="shortcut-label">F5</span>
          </button>
        </div>
      {/if}
    </div>

    <div class="menu-item-container">
      <button
        type="button"
        class="menu-trigger"
        class:active={openDropdown === 'help'}
        aria-haspopup="menu"
        aria-expanded={openDropdown === 'help'}
        onclick={(event) => toggleDropdown('help', event)}
        onmouseenter={() => handleMouseEnter('help')}
      >
        {t('menu.help')}
      </button>
      {#if openDropdown === 'help'}
        <div class="dropdown-menu help-menu" role="menu">
          <button
            type="button"
            class="dropdown-item"
            onclick={() => commands.checkForUpdates()}
            disabled={isCheckingForUpdate || isInstallingUpdate}
          >
            <span class="item-label">
              {isInstallingUpdate
                ? t('update.menuInstalling')
                : isCheckingForUpdate
                  ? t('update.menuChecking')
                  : t('update.menuCheck')}
            </span>
          </button>
          <div class="menu-divider"></div>
          <button type="button" class="dropdown-item" onclick={() => commands.openAbout()}>
            <span class="item-label">{t('menu.about')}</span>
          </button>
        </div>
      {/if}
    </div>

    {#if errorMessage}
      <div class="menu-error-indicator" class:syntax-error={isSyntaxError} title={errorMessage}>
        ⚠️ {errorMessage}
      </div>
    {/if}
  </div>

  <div class="menu-right">
    {#if availableUpdateVersion}
      <button
        type="button"
        class="available-update-button"
        onclick={() => commands.installUpdate()}
        disabled={isCheckingForUpdate || isInstallingUpdate}
        aria-label={`${t('update.install')} ${availableUpdateVersion}`}
        title={`${t('update.install')} ${availableUpdateVersion}`}
      >
        <Download size={14} aria-hidden="true"/>
        <span>{t('update.install')}</span>
        <span class="available-update-version">{availableUpdateVersion}</span>
      </button>
    {/if}

    {#if shouldShowNewDocumentFormatToolbar}
      <button
        bind:this={newDocumentFormatTriggerEl}
        type="button"
        class="new-document-format-trigger"
        class:active={isNewDocumentFormatPickerOpen}
        aria-haspopup="dialog"
        aria-expanded={isNewDocumentFormatPickerOpen}
        aria-controls="new-document-format-picker"
        onclick={() => commands.toggleNewDocumentFormatPicker()}
      >
        <FileText size={14} aria-hidden="true"/>
        <span>{t('newDocument.formatPrompt')}</span>
        <ChevronDown size={12} aria-hidden="true"/>
      </button>
    {/if}

    <button type="button" class="theme-mode-toggle" onclick={() => commands.toggleTheme()} title={t('toolbar.changeTheme')}>
      {#if currentTheme === 'dark'}
        <Moon size={18}/>
      {:else}
        <Sun size={18}/>
      {/if}
    </button>

    <button
      type="button"
      class="render-mode-toggle"
      class:active={isRenderMode}
      onclick={() => commands.toggleRenderMode()}
      title={isRenderMode ? t('toolbar.switchToSource') : t('toolbar.switchToRender')}
    >
      {#if isRenderMode}
        <PaintRoller size={18}/>
      {:else}
        <FileCode2 size={18}/>
      {/if}
    </button>

    <button
      type="button"
      class="settings-trigger"
      onclick={(event) => void commands.openSettings(event)}
      title={t('toolbar.settings')}
    >
      <Settings size={18}/>
    </button>
  </div>
</nav>

<style>
  .menu-bar {
    position: relative;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 32px;
    box-sizing: border-box;
    padding: 0 0.5rem;
    border-bottom: 1px solid var(--border-color);
    background-color: var(--bg-window);
    user-select: none;
  }

  .menu-left {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.15rem;
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
    margin-right: 0.25rem;
    padding: 0 0.5rem;
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

  .new-document-format-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 24px;
    margin-right: 0.25rem;
    padding: 0 7px;
    border: 1px solid var(--border-color);
    border-radius: 5px;
    background: transparent;
    color: var(--text-color);
    font-family: var(--font-ui);
    font-size: 0.72rem;
    white-space: nowrap;
    cursor: pointer;
  }

  .new-document-format-trigger:hover,
  .new-document-format-trigger.active {
    background-color: var(--bg-menu-hover);
  }

  .new-document-format-trigger:focus-visible {
    outline: 1px solid var(--accent-color);
    outline-offset: 1px;
  }

  .menu-item-container {
    position: relative;
  }

  .menu-trigger,
  .settings-trigger {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem 0.5rem;
    border: none;
    border-radius: 4px;
    outline: none;
    background: transparent;
    color: var(--text-color);
    font-family: var(--font-ui);
    font-size: 0.8rem;
    cursor: pointer;
    transition: background-color 0.1s;
  }

  .settings-trigger {
    margin-right: 0.25rem;
    padding: 0.2rem 0.4rem;
    font-size: 0.95rem;
  }

  .menu-trigger:hover,
  .menu-trigger.active,
  .settings-trigger:hover {
    background-color: var(--bg-menu-hover);
  }

  .render-mode-toggle,
  .theme-mode-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 0.25rem;
    padding: 0.2rem 0.4rem;
    border: none;
    border-radius: 4px;
    outline: none;
    background: transparent;
    color: var(--text-color);
    font-size: 0.95rem;
    cursor: pointer;
    transition: background-color 0.1s;
  }

  .render-mode-toggle:hover,
  .render-mode-toggle.active,
  .theme-mode-toggle:hover {
    background-color: var(--bg-menu-hover);
  }

  .dropdown-menu {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    min-width: 240px;
    margin-top: 2px;
    padding: 0.25rem;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background-color: var(--bg-dropdown);
    box-shadow: var(--shadow-menu);
  }

  .dropdown-menu.help-menu {
    min-width: 190px;
  }

  .dropdown-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.35rem 0.75rem;
    border: none;
    border-radius: 4px;
    outline: none;
    background: transparent;
    color: var(--text-color);
    font-family: var(--font-ui);
    font-size: 0.8rem;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.08s;
  }

  .dropdown-item:hover:not(:disabled) {
    background-color: var(--bg-menu-hover);
  }

  .dropdown-item:disabled {
    cursor: default;
    opacity: 0.4;
  }

  .item-label {
    flex: 1;
  }

  .shortcut-label {
    margin-left: 1.5rem;
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  .menu-divider {
    height: 1px;
    margin: 0.25rem 0.5rem;
    background-color: var(--border-color);
  }

  .menu-error-indicator {
    max-width: 250px;
    margin-left: auto;
    padding-right: 0.5rem;
    overflow: hidden;
    color: #ef4444;
    font-size: 0.75rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .menu-error-indicator.syntax-error {
    color: #dc2626;
  }
</style>
