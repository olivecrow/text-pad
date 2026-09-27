<script lang="ts">
  import { renderMarkdownRichText } from './markdown-rich-text';
  import { registerRichScriptHighlights } from './script-coloring';
  import { tick } from 'svelte';
  import { desktopFiles } from './desktop-file-service';
  import { desktopWindows } from './desktop-window-service';
  import { createDefaultMarkdownRenderSettings, markdownHeadingLevels, type MarkdownRenderSettings } from './markdown-settings';
  let { source, environment, documentPath, editLabel, onedit, onlink, inline = false, showEdit = true, editable = false, settings = createDefaultMarkdownRenderSettings() }: {
    source: string;
    environment: Record<string, unknown>;
    documentPath: string | null;
    editLabel: string;
    onedit: () => void;
    onlink: (href: string) => void;
    inline?: boolean;
    showEdit?: boolean;
    editable?: boolean;
    settings?: MarkdownRenderSettings;
  } = $props();
  const html = $derived(renderMarkdownRichText(source, environment, inline, editable, !settings.hideHeadingMarkers));
  const headingStyle = $derived(markdownHeadingLevels.map(level =>
    `--rich-h${level}-size:${settings.headings[level].sizePercent}%;--rich-h${level}-weight:${settings.headings[level].fontWeight}`
  ).join(';'));
  let contentElement: HTMLDivElement;
  let disclosureState: boolean[] = [];
  $effect(() => {
    void html;
    if (!editable || !contentElement) return;
    const disclosures = Array.from(contentElement.querySelectorAll('details'));
    disclosures.forEach((element, index) => {
      if (disclosureState[index] !== undefined) element.open = disclosureState[index];
    });
    return () => { disclosureState = disclosures.map(element => element.open); };
  });
  $effect(() => {
    void html;
    const root = contentElement;
    if (!root) return;
    let active = true;
    let unregister = () => {};
    void tick().then(() => {
      if (active) unregister = registerRichScriptHighlights(root);
    });
    return () => { active = false; unregister(); };
  });
  $effect(() => {
    void html;
    const path = documentPath;
    const root = contentElement;
    if (!root || !path || !desktopWindows.isAvailable()) return;
    let cancelled = false;
    const urls: string[] = [];
    // 순차 로드로 거대한 문서의 동시 파일 읽기를 제한한다.
    void (async () => {
      for (const image of root.querySelectorAll<HTMLImageElement>('img[data-local-image]')) {
        if (cancelled) break;
        try {
          const relative = decodeURIComponent(image.dataset.localImage!.split(/[?#]/u)[0]);
          const result = await desktopFiles.readDocumentImage(path, relative);
          if (cancelled) break;
          const url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: result.mimeType }));
          urls.push(url);
          image.src = url;
        } catch { /* 원문과 대체 텍스트를 유지한다. */ }
      }
    })();
    return () => { cancelled = true; urls.forEach((url) => URL.revokeObjectURL(url)); };
  });
  function click(event: MouseEvent) {
    if (editable && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      return;
    }
    const anchor = (event.target as Element).closest('a');
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute('href');
    if (href) onlink(href);
  }
</script>

<div class="rich-block" class:inline class:heading-dividers={settings.showHeadingDividers} style={headingStyle}>
  {#if showEdit}<button class="edit-source" title={editLabel} aria-label={editLabel} onclick={onedit}>‹/›</button>{/if}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="rich-content" class:editable bind:this={contentElement} onclick={click} ondblclick={editable ? undefined : onedit}>{@html html}</div>
</div>

<style>
  .rich-block { position: relative; min-height: 1.5em; }
  .rich-block.inline { min-height: 17px; }
  .inline .rich-content { line-height: inherit; }
  .inline .rich-content::after { content: '\200b'; }
  .edit-source { position: absolute; top: 0; right: 0; z-index: 1; font: inherit; font-size: 11px; border: 1px solid var(--color-gutter-border); border-radius: 3px; background: var(--color-render-bg); color: inherit; cursor: pointer; opacity: 0; }
  .rich-block:hover .edit-source, .edit-source:focus-visible { opacity: 1; }
  .rich-content { overflow-wrap: break-word; word-break: keep-all; white-space: normal; line-height: inherit; }
  .rich-content.editable { cursor: text; user-select: none; }
  .rich-content.editable :global(a) { cursor: text; }
  .rich-content :global(p) { margin: .4em 0; }
  .rich-content :global(> :first-child) { margin-top: 0; }
  .rich-content :global(> :last-child) { margin-bottom: 0; }
  .rich-content :global(img) { max-width: 100%; height: auto; vertical-align: middle; }
  .rich-content :global(a) { color: var(--color-hl-key-medium); text-decoration: underline; cursor: pointer; }
  .rich-content :global(pre) { white-space: pre-wrap; padding: .5em .7em; overflow-wrap: break-word; }
  .rich-content :global(pre), .rich-content :global(code), .rich-content :global(kbd), .rich-content :global(samp) { background: var(--color-hl-code-bg); border-radius: 3px; font-family: Consolas, 'Cascadia Mono', monospace; }
  .rich-content :global(code), .rich-content :global(kbd) { padding: .1em .25em; }
  .rich-content :global(kbd) { border: 1px solid var(--color-gutter-border); box-shadow: 0 1px 0 var(--color-gutter-border); }
  .rich-content :global(mark) { background: var(--color-selection); color: inherit; }
  .rich-content :global(blockquote) { margin: .5em 0; padding: .2em 1em; border-left: 3px solid var(--color-gutter-border); color: color-mix(in srgb, var(--color-render-text) 80%, var(--color-render-bg)); }
  .rich-content :global(blockquote > :first-child) { margin-top: 0; }
  .rich-content :global(blockquote > :last-child) { margin-bottom: 0; }
  .rich-content :global(strong) { font-weight: 700; }
  .rich-content :global(em) { font-style: italic; }
  .rich-content :global(details) { border-left: 2px solid var(--color-gutter-border); padding-left: .7em; }
  .rich-content :global(summary) { cursor: pointer; }
  .rich-content :global(table) { border-collapse: collapse; max-width: 100%; }
  .rich-content :global(th), .rich-content :global(td) { border: 1px solid var(--color-gutter-border); padding: .3em .6em; }
  .rich-content :global(hr) { border: 0; border-top: 1px solid var(--color-gutter-border); }
  .rich-content :global(figure) { margin: .5em 0; }
  .rich-content :global(h1) { font-size: var(--rich-h1-size); font-weight: var(--rich-h1-weight); }
  .rich-content :global(h2) { font-size: var(--rich-h2-size); font-weight: var(--rich-h2-weight); }
  .rich-content :global(h3) { font-size: var(--rich-h3-size); font-weight: var(--rich-h3-weight); }
  .rich-content :global(h4) { font-size: var(--rich-h4-size); font-weight: var(--rich-h4-weight); }
  .rich-content :global(h5) { font-size: var(--rich-h5-size); font-weight: var(--rich-h5-weight); }
  .rich-content :global(h6) { font-size: var(--rich-h6-size); font-weight: var(--rich-h6-weight); }
  .rich-content :global(:is(h1,h2,h3,h4,h5,h6)) { line-height: inherit; margin: 0; }
  .heading-dividers .rich-content :global(:is(h1,h2)) { box-shadow: inset 0 -1px color-mix(in srgb, var(--color-render-text) 18%, transparent); }
</style>
