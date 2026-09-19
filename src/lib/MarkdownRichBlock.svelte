<script lang="ts">
  import { renderMarkdownRichText } from './markdown-rich-text';
  import { desktopFiles } from './desktop-file-service';
  import { desktopWindows } from './desktop-window-service';
  let { source, environment, documentPath, editLabel, onedit, onlink, inline = false, showEdit = true }: {
    source: string;
    environment: Record<string, unknown>;
    documentPath: string | null;
    editLabel: string;
    onedit: () => void;
    onlink: (href: string) => void;
    inline?: boolean;
    showEdit?: boolean;
  } = $props();
  const html = $derived(renderMarkdownRichText(source, environment, inline));
  let contentElement: HTMLDivElement;
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
    const anchor = (event.target as Element).closest('a');
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute('href');
    if (href) onlink(href);
  }
</script>

<div class="rich-block" class:inline>
  {#if showEdit}<button class="edit-source" title={editLabel} aria-label={editLabel} onclick={onedit}>‹/›</button>{/if}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="rich-content" bind:this={contentElement} onclick={click} ondblclick={onedit}>{@html html}</div>
</div>

<style>
  .rich-block { position: relative; min-height: 1.5em; }
  .rich-block.inline { min-height: 17px; }
  .inline .rich-content { line-height: inherit; }
  .inline .rich-content::after { content: '\200b'; }
  .edit-source { position: absolute; top: 0; right: 0; z-index: 1; font: inherit; font-size: 11px; border: 1px solid var(--color-gutter-border); border-radius: 3px; background: var(--color-render-bg); color: inherit; cursor: pointer; opacity: 0; }
  .rich-block:hover .edit-source, .edit-source:focus-visible { opacity: 1; }
  .rich-content { overflow-wrap: anywhere; white-space: normal; line-height: 1.6; }
  .rich-content :global(p) { margin: .4em 0; }
  .rich-content :global(> :first-child) { margin-top: 0; }
  .rich-content :global(> :last-child) { margin-bottom: 0; }
  .rich-content :global(img) { max-width: 100%; height: auto; vertical-align: middle; }
  .rich-content :global(a) { color: var(--color-hl-key-medium); text-decoration: underline; cursor: pointer; }
  .rich-content :global(pre) { white-space: pre-wrap; padding: .5em .7em; overflow-wrap: anywhere; }
  .rich-content :global(pre), .rich-content :global(code), .rich-content :global(kbd), .rich-content :global(samp) { background: var(--color-hl-code-bg); border-radius: 3px; font-family: inherit; }
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
  .rich-content :global(h1), .rich-content :global(h2), .rich-content :global(h3) { line-height: 1.3; }
</style>
