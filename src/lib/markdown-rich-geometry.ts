import { findClosestRenderedTextOffset, type RenderedTextBoundary } from './rendered-text-geometry';

export interface RichTextRun { node: Text; offsets: number[] }
const runCache = new WeakMap<Text, RichTextRun>();
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const boundaryCache = new WeakMap<Text, number[]>();
export function getRichTextRuns(root: HTMLElement): RichTextRun[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-rich-offsets]')).flatMap(span => {
    const node = span.firstChild;
    if (!(node instanceof Text) || !span.getClientRects().length) return [];
    const cached = runCache.get(node);
    if (cached) return [cached];
    const offsets = span.dataset.richOffsets!.split(',').map(Number);
    if (offsets.length !== node.length + 1) return [];
    const run = { node, offsets };
    runCache.set(node, run);
    return [run];
  });
}

/** 문자 참조·이모지를 나누지 않고 앞/뒤의 표시 문자 하나를 고른다. */
export function getRichDeletionRange(root: HTMLElement, offset: number, direction: -1 | 1): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  for (const run of getRichTextRuns(root)) {
    for (const segment of graphemes.segment(run.node.data)) {
      const start = run.offsets[segment.index];
      const end = run.offsets[segment.index + segment.segment.length];
      if (end <= start || (direction < 0 ? end > offset : start < offset)) continue;
      if (!best || (direction < 0 ? end > best.end : start < best.start)) best = { start, end };
    }
  }
  return best;
}

export function getRichTextBoundary(root: HTMLElement, offset: number, direction = 0): (RenderedTextBoundary & { source: number }) | null {
  let best: (RenderedTextBoundary & { source: number }) | null = null;
  let distance = Infinity;
  for (const run of getRichTextRuns(root)) {
    let boundaries = boundaryCache.get(run.node);
    if (!boundaries) {
      boundaries = [...graphemes.segment(run.node.data)].map(segment => segment.index).concat(run.node.length);
      boundaryCache.set(run.node, boundaries);
    }
    for (const i of boundaries) {
      const source = run.offsets[i];
      if ((direction < 0 && source > offset) || (direction > 0 && source < offset)) continue;
      const delta = Math.abs(source - offset);
      if (delta < distance) { best = { node: run.node, offset: i, source }; distance = delta; }
    }
  }
  return best;
}

export function getRichTextOffsetAtPoint(root: HTMLElement, x: number, y: number,
  rectAt: (boundary: RenderedTextBoundary) => DOMRect | null, overlay: HTMLElement | null | undefined): number | null {
  const caretDocument = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
  const old = overlay?.style.pointerEvents;
  let native: Range | null = null;
  try {
    if (overlay) overlay.style.pointerEvents = 'none';
    native = caretDocument.caretRangeFromPoint?.(x, y) ?? null;
  } finally { if (overlay) overlay.style.pointerEvents = old ?? ''; }
  const runs = getRichTextRuns(root);
  if (native) {
    const run = runs.find(run => run.node === native!.startContainer);
    if (run) return run.offsets[native.startOffset] ?? null;
  }
  let closest: number | null = null;
  let distance = Infinity;
  for (const run of runs) {
    const offset = findClosestRenderedTextOffset(run.node.length, x, y, 10000,
      i => rectAt({ node: run.node, offset: i }));
    const rect = rectAt({ node: run.node, offset });
    if (!rect) continue;
    const delta = Math.max(rect.top - y, y - rect.bottom, 0) * 10000 + Math.abs(rect.left - x);
    if (delta < distance) { distance = delta; closest = run.offsets[offset]; }
  }
  return closest;
}

export function getRichSelectionRanges(root: HTMLElement, start: number, end: number): Range[] {
  const result: Range[] = [];
  for (const run of getRichTextRuns(root)) {
    const from = run.offsets.findIndex(offset => offset >= start);
    let to = run.offsets.length - 1;
    while (to >= 0 && run.offsets[to] > end) to--;
    if (from < 0 || to <= from) continue;
    const range = document.createRange();
    range.setStart(run.node, from); range.setEnd(run.node, to);
    result.push(range);
  }
  return result;
}
