export interface RenderedTextBoundary {
  node: Text;
  offset: number;
}

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  height: number;
}

export interface RenderedTextBoundaryIndex {
  getBoundary(offset: number): RenderedTextBoundary | null;
}

interface TextNodeEntry {
  node: Text;
  start: number;
  end: number;
}

function clampOffset(offset: number, maximum: number): number {
  return Math.max(0, Math.min(offset, maximum));
}

export function getNativeCaretTextOffsetAtPoint(
  root: HTMLElement,
  maximum: number,
  clientX: number,
  clientY: number
): number | null {
  const documentWithCaret = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  const caretPosition = documentWithCaret.caretPositionFromPoint?.(clientX, clientY);
  const caretRange = caretPosition ? null : documentWithCaret.caretRangeFromPoint?.(clientX, clientY);
  const node = caretPosition?.offsetNode ?? caretRange?.startContainer;
  const offset = caretPosition?.offset ?? caretRange?.startOffset;
  if (!node || offset === undefined || (node !== root && !root.contains(node))) return null;

  try {
    const prefix = document.createRange();
    prefix.selectNodeContents(root);
    prefix.setEnd(node, offset);
    return clampOffset(prefix.toString().length, maximum);
  } catch {
    return null;
  }
}

export function createRenderedTextBoundaryIndex(
  root: HTMLElement,
  maximum: number
): RenderedTextBoundaryIndex {
  const entries: TextNodeEntry[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let node = walker.nextNode() as Text | null;

  while (node && consumed < maximum) {
    const length = Math.min(node.data.length, maximum - consumed);
    if (length > 0) {
      entries.push({ node, start: consumed, end: consumed + length });
      consumed += length;
    }
    node = walker.nextNode() as Text | null;
  }

  return {
    getBoundary(offset: number): RenderedTextBoundary | null {
      if (entries.length === 0) return null;
      const target = clampOffset(offset, Math.min(maximum, consumed));
      let low = 0;
      let high = entries.length - 1;

      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (target > (entries[middle]?.end ?? 0)) low = middle + 1;
        else high = middle;
      }

      const entry = entries[low];
      if (!entry) return null;
      return {
        node: entry.node,
        offset: clampOffset(target - entry.start, entry.node.data.length)
      };
    }
  };
}

export function findClosestRenderedTextOffset(
  maximum: number,
  clientX: number,
  clientY: number,
  verticalWeight: number,
  getRect: (offset: number) => RectLike | null
): number {
  if (maximum <= 0) return 0;

  let low = 0;
  let high = maximum;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const rect = getRect(middle);
    if (!rect) {
      high = middle;
      continue;
    }

    if (rect.bottom < clientY || (rect.top <= clientY && clientY <= rect.bottom && rect.left < clientX)) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  let bestOffset = clampOffset(low, maximum);
  let bestDistance = Number.POSITIVE_INFINITY;
  const start = Math.max(0, bestOffset - 3);
  const end = Math.min(maximum, bestOffset + 3);

  for (let offset = start; offset <= end; offset += 1) {
    const rect = getRect(offset);
    if (!rect) continue;
    const distance = Math.abs(clientY - (rect.top + rect.height / 2)) * verticalWeight
      + Math.abs(clientX - rect.left);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestOffset = offset;
    }
  }

  return bestOffset;
}
