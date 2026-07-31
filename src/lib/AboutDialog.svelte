<script lang="ts">
  import { tick } from 'svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import {
    APP_COPYRIGHT,
    APP_LICENSE,
    APP_NAME,
    APP_RELEASE_DATE,
    APP_REPOSITORY_URL,
    THIRD_PARTY_COMPONENTS
  } from '$lib/app-metadata';
  import { translate, type AppLocale, type TranslationKey, type TranslationValues } from '$lib/i18n';

  interface Props {
    open: boolean;
    version: string;
    locale: AppLocale;
    onclose: () => void;
  }

  let { open, version, locale, onclose }: Props = $props();
  function t(key: TranslationKey, values: TranslationValues = {}) {
    return translate(locale, key, values);
  }

  let closeButton = $state<HTMLButtonElement | null>(null);
  let noticesExpanded = $state(false);
  let noticesLoading = $state(false);
  let noticesText = $state('');
  let noticesError = $state('');

  function hasTauriRuntime(): boolean {
    if (typeof window === 'undefined') return false;
    const runtimeWindow = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
    return '__TAURI_INTERNALS__' in runtimeWindow || '__TAURI__' in runtimeWindow;
  }

  async function openExternalUrl(url: string) {
    if (hasTauriRuntime()) {
      await openUrl(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function loadThirdPartyNotices() {
    if (noticesText || noticesLoading) return;
    noticesLoading = true;
    noticesError = '';

    try {
      const response = await fetch('/THIRD_PARTY_NOTICES.txt');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      noticesText = await response.text();
    } catch (error) {
      noticesError = t('error.loadNotices', { detail: error instanceof Error ? error.message : String(error) });
    } finally {
      noticesLoading = false;
    }
  }

  function toggleNotices() {
    noticesExpanded = !noticesExpanded;
    if (noticesExpanded) {
      void loadThirdPartyNotices();
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      onclose();
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose();
    }
  }

  $effect(() => {
    if (!open) return;
    void tick().then(() => closeButton?.focus());
  });
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if open}
  <div class="about-backdrop" role="presentation" onclick={handleBackdropClick}>
    <div
      class="about-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-title"
    >
      <header class="about-header">
        <div>
          <h2 id="about-title">{t('about.title', { appName: APP_NAME })}</h2>
          <p>{t('app.tagline')}</p>
        </div>
        <button bind:this={closeButton} class="about-close" type="button" aria-label={t('about.close')} onclick={onclose}>
          ×
        </button>
      </header>

      <div class="about-body">
        <div class="about-product">
          <img src="/favicon.png" alt="" aria-hidden="true" />
          <div>
            <strong>{APP_NAME}</strong>
            <span>{t('common.version', { version })}</span>
            <span>{t('common.releaseDate', { date: APP_RELEASE_DATE })}</span>
          </div>
        </div>

        <section class="about-section" aria-labelledby="about-license-title">
          <h3 id="about-license-title">{t('about.licenseTitle')}</h3>
          <p>{APP_COPYRIGHT}</p>
          <p>{t('about.licenseText', { license: APP_LICENSE })}</p>
          <button class="about-link" type="button" onclick={() => void openExternalUrl(APP_REPOSITORY_URL)}>
            {t('about.projectLicense')}
          </button>
        </section>

        <section class="about-section" aria-labelledby="third-party-title">
          <h3 id="third-party-title">{t('about.componentsTitle')}</h3>
          <ul class="component-list">
            {#each THIRD_PARTY_COMPONENTS as component}
              <li>
                <span><strong>{component.name}</strong> · {component.license}</span>
                <button class="about-link compact" type="button" onclick={() => void openExternalUrl(component.sourceUrl)}>
                  {t('common.origin')}
                </button>
              </li>
            {/each}
          </ul>

          <button
            class="notice-toggle"
            type="button"
            aria-expanded={noticesExpanded}
            aria-controls="third-party-notices"
            onclick={toggleNotices}
          >
            {noticesExpanded ? t('about.toggleNotices.hide') : t('about.toggleNotices.show')}
          </button>

          {#if noticesExpanded}
            <div id="third-party-notices" class="notices-panel" aria-live="polite">
              {#if noticesLoading}
                <p>{t('about.loading')}</p>
              {:else if noticesError}
                <p class="notice-error">{noticesError}</p>
              {:else}
                <pre>{noticesText}</pre>
              {/if}
            </div>
          {/if}
        </section>
      </div>

      <footer class="about-footer">
        <button class="about-primary" type="button" onclick={onclose}>{t('common.ok')}</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .about-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--bg-overlay);
    font-family: var(--font-ui);
    color: var(--text-color);
  }

  .about-dialog {
    display: flex;
    flex-direction: column;
    width: min(580px, calc(100vw - 48px));
    max-height: min(720px, calc(100vh - 48px));
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 10px;
    background: var(--bg-modal);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
  }

  .about-header,
  .about-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    padding: 16px 18px;
  }

  .about-header {
    border-bottom: 1px solid var(--border-color);
  }

  .about-header h2 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
  }

  .about-header p {
    margin: 4px 0 0;
    color: var(--text-muted);
    font-size: 0.8rem;
  }

  .about-close {
    width: 30px;
    height: 30px;
    padding: 0;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-color);
    font-size: 1.25rem;
    line-height: 1;
    cursor: pointer;
  }

  .about-close:hover,
  .about-close:focus-visible {
    background: var(--bg-menu-hover);
  }

  .about-body {
    overflow: auto;
    padding: 18px;
  }

  .about-product {
    display: flex;
    align-items: center;
    gap: 14px;
    padding-bottom: 18px;
  }

  .about-product img {
    width: 46px;
    height: 46px;
  }

  .about-product div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 0.82rem;
  }

  .about-product strong {
    font-size: 1rem;
  }

  .about-section {
    padding: 14px 0;
    border-top: 1px solid var(--border-color);
  }

  .about-section h3 {
    margin: 0 0 10px;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .about-section p {
    margin: 5px 0;
    font-size: 0.8rem;
    line-height: 1.5;
  }

  .about-link {
    padding: 0;
    border: none;
    background: transparent;
    color: var(--accent-color);
    font: inherit;
    font-size: 0.8rem;
    text-align: left;
    cursor: pointer;
  }

  .about-link:hover,
  .about-link:focus-visible {
    text-decoration: underline;
  }

  .about-link.compact {
    flex-shrink: 0;
    font-size: 0.75rem;
  }

  .component-list {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin: 0 0 12px;
    padding: 0;
    list-style: none;
    font-size: 0.78rem;
  }

  .component-list li {
    display: flex;
    justify-content: space-between;
    gap: 16px;
  }

  .notice-toggle,
  .about-primary {
    min-height: 30px;
    padding: 5px 12px;
    border: 1px solid var(--border-color);
    border-radius: 5px;
    background: var(--bg-menu-hover);
    color: var(--text-color);
    font-family: var(--font-ui);
    font-size: 0.78rem;
    cursor: pointer;
  }

  .notice-toggle:hover,
  .notice-toggle:focus-visible,
  .about-primary:hover,
  .about-primary:focus-visible {
    background: var(--bg-menu-active);
  }

  .notices-panel {
    max-height: 230px;
    margin-top: 10px;
    overflow: auto;
    border: 1px solid var(--border-color);
    border-radius: 5px;
    background: var(--bg-editor);
  }

  .notices-panel pre {
    margin: 0;
    padding: 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text-color);
    font-family: var(--font-notepad);
    font-size: 0.7rem;
    line-height: 1.45;
  }

  .notices-panel p {
    padding: 0 12px;
  }

  .notice-error {
    color: #dc2626;
  }

  .about-footer {
    justify-content: flex-end;
    border-top: 1px solid var(--border-color);
  }

  .about-primary {
    min-width: 72px;
    background: var(--accent-color);
    border-color: var(--accent-color);
    color: #ffffff;
  }

  .about-primary:hover,
  .about-primary:focus-visible {
    filter: brightness(1.08);
    background: var(--accent-color);
  }
</style>
