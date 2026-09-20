<script lang="ts">
  import { ChevronUp, ChevronDown, X } from '@lucide/svelte';
  import { translate, type AppLocale } from '$lib/i18n';
  let { locale, query, current, total, hiddenMatch, onquery, onmove, onclose, onsource }: {
    locale: AppLocale; query: string; current: number; total: number; hiddenMatch: boolean;
    onquery: (query: string) => void; onmove: (direction: -1 | 1) => void;
    onclose: () => void; onsource: () => void;
  } = $props();
  let input: HTMLInputElement;
  const undoQueries: string[] = [];
  const redoQueries: string[] = [];
  export function focus() { input?.focus(); input?.select(); }
  function changeQuery(value: string) {
    if (value === query) return;
    undoQueries.push(query);
    if (undoQueries.length > 100) undoQueries.shift();
    redoQueries.length = 0;
    onquery(value);
  }
  function keydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); onmove(event.shiftKey ? -1 : 1); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onclose(); }
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(key)) {
      // 브라우저의 전역 입력 기록이 검색창에서 본문으로 넘어가지 않게 독립 기록을 사용한다.
      event.preventDefault(); event.stopPropagation();
      const redo = key === 'y' || event.shiftKey;
      const previous = (redo ? redoQueries : undoQueries).pop();
      if (previous !== undefined) { (redo ? undoQueries : redoQueries).push(query); onquery(previous); }
    }
    if ((event.ctrlKey || event.metaKey) && ['a', 'd'].includes(key)) event.stopPropagation();
  }
</script>

<div class="document-search" role="search" aria-label={translate(locale, 'search.find')}>
  <input bind:this={input} value={query} onkeydown={keydown} oninput={event => changeQuery(event.currentTarget.value)}
    aria-label={translate(locale, 'search.find')} placeholder={translate(locale, 'search.find')} spellcheck="false" />
  <span class="search-count" role="status" aria-live="polite">{current}/{total}</span>
  <button type="button" title={translate(locale, 'search.previous')} aria-label={translate(locale, 'search.previous')}
    disabled={!total} onclick={() => onmove(-1)}><ChevronUp size={16} /></button>
  <button type="button" title={translate(locale, 'search.next')} aria-label={translate(locale, 'search.next')}
    disabled={!total} onclick={() => onmove(1)}><ChevronDown size={16} /></button>
  <button type="button" title={translate(locale, 'search.close')} aria-label={translate(locale, 'search.close')}
    onclick={onclose}><X size={16} /></button>
  {#if hiddenMatch}<button class="source-link" type="button" onclick={onsource}>{translate(locale, 'search.showSource')}</button>{/if}
</div>

<style>
  .document-search { display: flex; align-items: center; justify-content: flex-end; gap: 4px; padding: 5px 10px;
    background: var(--bg-dropdown); color: var(--text-color); border-bottom: 1px solid var(--border-color); flex-wrap: wrap; }
  input { min-width: 80px; width: 220px; flex: 0 1 220px; padding: 5px 8px; border: 1px solid var(--border-color);
    border-radius: 4px; background: var(--bg-editor); color: var(--text-color); font: inherit; font-size: 13px; }
  input:focus { outline: 1px solid var(--color-selection); }
  .search-count { min-width: 48px; text-align: center; font-size: 12px; font-variant-numeric: tabular-nums; }
  button { display: inline-flex; align-items: center; justify-content: center; min-height: 28px; min-width: 28px;
    padding: 4px; border: 0; border-radius: 4px; background: transparent; color: inherit; }
  button:hover { background: var(--bg-menu-hover); }
  button:disabled { opacity: .35; }
  .source-link { font-size: 12px; padding-inline: 8px; }
</style>
