import {
  getListMarkerAtStart,
  getListMarkerBodyStart,
  type ListMarker
} from './list-markers';
import { findLineIndexForOffset, getLineText } from './structured-rendering';
import { isTextChangeTransition, type TextChange } from './text-change';

export interface FencedCodeBlockRange {
  openingLineIndex: number;
  openingLineStart: number;
  openingLineEnd: number;
  contentStart: number;
  fenceLength: number;
  closingBoundaryStart?: number;
  closingLineIndex?: number;
  closingLineStart?: number;
  closingLineEnd?: number;
  afterBlockStart?: number;
}

export interface RenderListLineLayout {
  marker: ListMarker;
  ownerLineIndex: number;
  prefixLength: number;
}

export interface RenderedLineHeightMeasurements {
  content: string;
  context: string;
  heights: Record<number, number>;
}

interface ActiveListOwner {
  marker: ListMarker;
  lineIndex: number;
}

interface CachedLayoutLine {
  text: string;
  isFencedCode: boolean;
  incomingOwnerKey: string;
  outgoingOwner: ActiveListOwner | null;
  outgoingOwnerKey: string;
  listLayout: RenderListLineLayout | null;
  estimatedHeight: number;
  height: number;
}

class LineHeightIndex {
  private heights: number[] = [];
  private tree: number[] = [0];

  reset(heights: number[]) {
    this.heights = [...heights];
    this.tree = new Array(heights.length + 1).fill(0);
    for (let index = 0; index < heights.length; index += 1) {
      let treeIndex = index + 1;
      while (treeIndex < this.tree.length) {
        this.tree[treeIndex] += heights[index] ?? 0;
        treeIndex += treeIndex & -treeIndex;
      }
    }
  }

  update(index: number, height: number) {
    const previous = this.heights[index];
    if (previous === undefined || Math.abs(previous - height) <= 0.001) return;
    this.heights[index] = height;
    const delta = height - previous;
    let treeIndex = index + 1;
    while (treeIndex < this.tree.length) {
      this.tree[treeIndex] += delta;
      treeIndex += treeIndex & -treeIndex;
    }
  }

  getHeight(index: number, fallback: number): number {
    return this.heights[index] ?? fallback;
  }

  getTop(index: number): number {
    let total = 0;
    let treeIndex = Math.max(0, Math.min(index, this.heights.length));
    while (treeIndex > 0) {
      total += this.tree[treeIndex] ?? 0;
      treeIndex -= treeIndex & -treeIndex;
    }
    return total;
  }

  getTotal(): number {
    return this.getTop(this.heights.length);
  }

  findLine(offset: number): number {
    if (this.heights.length === 0) return 0;
    const target = Math.max(0, offset);
    let index = 0;
    let accumulated = 0;
    let bit = 1;
    while ((bit << 1) < this.tree.length) bit <<= 1;

    while (bit > 0) {
      const nextIndex = index + bit;
      const nextValue = accumulated + (this.tree[nextIndex] ?? 0);
      if (nextIndex < this.tree.length && nextValue <= target) {
        index = nextIndex;
        accumulated = nextValue;
      }
      bit >>= 1;
    }

    return Math.max(0, Math.min(index, this.heights.length - 1));
  }
}

export interface EditorLineLayoutCache {
  content: string | null;
  context: string;
  lineStartOffsets: number[];
  lines: CachedLayoutLine[];
  listLayouts: Array<RenderListLineLayout | null>;
  wrapped: boolean;
  heights: LineHeightIndex;
  visitedLineCount: number;
}

export interface FencedCodeBlockCache {
  content: string | null;
  lineStartOffsets: number[];
  ranges: FencedCodeBlockRange[];
  visitedLineCount: number;
}

export interface EditorLineLayout {
  lineCount: number;
  totalHeight: number;
  uniformLineHeight: number | null;
  listLayouts: Array<RenderListLineLayout | null>;
  visitedLineCount: number;
  getLineTop(lineIndex: number): number;
  getLineHeight(lineIndex: number): number;
  findLineIndex(offset: number): number;
}

interface EditorLineLayoutOptions {
  content: string;
  lineStartOffsets: number[];
  contentWidth: number;
  fencedCodeRanges: FencedCodeBlockRange[];
  wrapEnabled: boolean;
  measurements: RenderedLineHeightMeasurements;
  measurementContext: string;
  measuredLineHeight: number;
  fencedCodeHorizontalPadding: number;
  measureTextEndWidth: (text: string, startWidth?: number) => number;
  measureTextWidth: (text: string) => number;
  getListContinuationIndent: (marker: ListMarker) => string;
  change?: TextChange | null;
}

export function createEditorLineLayoutCache(): EditorLineLayoutCache {
  return {
    content: null,
    context: '',
    lineStartOffsets: [0],
    lines: [],
    listLayouts: [],
    wrapped: false,
    heights: new LineHeightIndex(),
    visitedLineCount: 0
  };
}

export function createFencedCodeBlockCache(): FencedCodeBlockCache {
  return {
    content: null,
    lineStartOffsets: [0],
    ranges: [],
    visitedLineCount: 0
  };
}

function getOwnerKey(owner: ActiveListOwner | null): string {
  if (!owner) return '';
  const marker = owner.marker;
  return `${owner.lineIndex}|${marker.indent}|${marker.label}|${marker.separator}|${marker.spacing}|${marker.marker}`;
}

function countWrappedVisualLines(
  lineText: string,
  contentWidth: number,
  measureTextEndWidth: (text: string, startWidth?: number) => number
): number {
  if (contentWidth <= 0 || lineText.length === 0) return 1;

  const segments = lineText.match(/\S+\s*|\s+/g) || [lineText];
  let visualLineCount = 1;
  let currentWidth = 0;

  const appendPiece = (piece: string) => {
    const nextWidth = measureTextEndWidth(piece, currentWidth);
    if (currentWidth > 0 && nextWidth > contentWidth) {
      visualLineCount += 1;
      currentWidth = measureTextEndWidth(piece, 0);
    } else {
      currentWidth = nextWidth;
    }
  };

  for (const segment of segments) {
    const segmentWidth = measureTextEndWidth(segment, 0);
    if (segmentWidth <= contentWidth) {
      appendPiece(segment);
      continue;
    }

    for (const char of segment) {
      appendPiece(char);
      if (currentWidth > contentWidth) {
        visualLineCount += 1;
        currentWidth = 0;
      }
    }
  }

  return visualLineCount;
}

function createFencedLineLookup(
  ranges: FencedCodeBlockRange[],
  startOffset: number
): (lineStart: number) => boolean {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const range = ranges[middle];
    const end = range.closingLineStart ?? Number.POSITIVE_INFINITY;
    if (end < startOffset) low = middle + 1;
    else high = middle;
  }

  let rangeIndex = low;
  return (lineStart) => {
    let range = ranges[rangeIndex];
    while (range && lineStart > (range.closingLineStart ?? Number.POSITIVE_INFINITY)) {
      rangeIndex += 1;
      range = ranges[rangeIndex];
    }
    return !!range
      && lineStart >= range.openingLineStart
      && lineStart <= (range.closingLineStart ?? Number.POSITIVE_INFINITY);
  };
}

function getLayoutLine(
  options: EditorLineLayoutOptions,
  lineIndex: number,
  activeOwner: ActiveListOwner | null,
  isFencedCode: boolean
): CachedLayoutLine {
  const lineStart = options.lineStartOffsets[lineIndex] ?? 0;
  const lineText = getLineText(options.content, options.lineStartOffsets, lineIndex);
  const incomingOwnerKey = getOwnerKey(activeOwner);
  const currentListMarker = isFencedCode ? null : getListMarkerAtStart(lineText);
  let nextOwner = isFencedCode ? null : activeOwner;
  if (currentListMarker) nextOwner = { marker: currentListMarker, lineIndex };

  let prefixLength = 0;
  let listLayoutMarker: ListMarker | null = currentListMarker;
  let ownerLineIndex = lineIndex;
  if (currentListMarker) {
    prefixLength = getListMarkerBodyStart(currentListMarker);
  } else if (nextOwner) {
    const continuationIndent = options.getListContinuationIndent(nextOwner.marker);
    if (continuationIndent.length > 0 && lineText.startsWith(continuationIndent)) {
      prefixLength = continuationIndent.length;
      listLayoutMarker = nextOwner.marker;
      ownerLineIndex = nextOwner.lineIndex;
    } else {
      nextOwner = null;
    }
  }

  const listLayout = listLayoutMarker
    ? { marker: listLayoutMarker, ownerLineIndex, prefixLength }
    : null;
  const lineContentWidth = isFencedCode
    ? Math.max(1, options.contentWidth - (options.fencedCodeHorizontalPadding * 2))
    : options.contentWidth;
  const wrappedText = listLayoutMarker ? lineText.slice(prefixLength) : lineText;
  const wrappedWidth = listLayoutMarker
    ? Math.max(1, lineContentWidth - options.measureTextWidth(`${listLayoutMarker.indent}${listLayoutMarker.marker}`))
    : lineContentWidth;
  const visualLineCount = countWrappedVisualLines(
    wrappedText,
    wrappedWidth,
    options.measureTextEndWidth
  );
  if (!currentListMarker && /^[ \t]*$/.test(lineText)) nextOwner = null;

  const estimatedHeight = Math.max(
    options.measuredLineHeight,
    visualLineCount * options.measuredLineHeight
  );
  const measuredHeight = options.measurements.content === options.content
    && options.measurements.context === options.measurementContext
      ? options.measurements.heights[lineIndex]
      : undefined;

  return {
    text: lineText,
    isFencedCode,
    incomingOwnerKey,
    outgoingOwner: nextOwner,
    outgoingOwnerKey: getOwnerKey(nextOwner),
    listLayout,
    estimatedHeight,
    height: measuredHeight ?? estimatedHeight
  };
}

function layoutLinesEqual(left: CachedLayoutLine | undefined, right: CachedLayoutLine): boolean {
  return !!left
    && left.text === right.text
    && left.isFencedCode === right.isFencedCode
    && left.incomingOwnerKey === right.incomingOwnerKey
    && left.outgoingOwnerKey === right.outgoingOwnerKey
    && Math.abs(left.estimatedHeight - right.estimatedHeight) <= 0.001;
}

function createLayoutView(
  cache: EditorLineLayoutCache,
  lineCount: number,
  measuredLineHeight: number,
  uniformLineHeight: number | null
): EditorLineLayout {
  if (uniformLineHeight !== null) {
    return {
      lineCount,
      totalHeight: lineCount * uniformLineHeight,
      uniformLineHeight,
      listLayouts: [],
      visitedLineCount: 0,
      getLineTop: (lineIndex) => Math.max(0, lineIndex) * uniformLineHeight,
      getLineHeight: () => uniformLineHeight,
      findLineIndex: (offset) => Math.max(0, Math.min(Math.floor(Math.max(0, offset) / uniformLineHeight), lineCount - 1))
    };
  }

  return {
    lineCount,
    totalHeight: cache.heights.getTotal(),
    uniformLineHeight: null,
    listLayouts: cache.listLayouts,
    visitedLineCount: cache.visitedLineCount,
    getLineTop: (lineIndex) => cache.heights.getTop(lineIndex),
    getLineHeight: (lineIndex) => cache.heights.getHeight(lineIndex, measuredLineHeight),
    findLineIndex: (offset) => cache.heights.findLine(offset)
  };
}

export function getEditorLineLayout(
  cache: EditorLineLayoutCache,
  options: EditorLineLayoutOptions
): EditorLineLayout {
  const lineCount = options.lineStartOffsets.length;
  cache.visitedLineCount = 0;

  if (!options.wrapEnabled) {
    cache.content = options.content;
    cache.context = options.measurementContext;
    cache.lineStartOffsets = options.lineStartOffsets;
    cache.lines = [];
    cache.listLayouts = [];
    cache.wrapped = false;
    cache.heights.reset([]);
    return createLayoutView(cache, lineCount, options.measuredLineHeight, options.measuredLineHeight);
  }

  if (
    cache.wrapped
    && cache.content === options.content
    && cache.context === options.measurementContext
  ) {
    if (
      options.measurements.content === options.content
      && options.measurements.context === options.measurementContext
    ) {
      for (const [rawLineIndex, rawHeight] of Object.entries(options.measurements.heights)) {
        const lineIndex = Number(rawLineIndex);
        const line = cache.lines[lineIndex];
        if (!line || !Number.isFinite(rawHeight)) continue;
        const height = Math.max(options.measuredLineHeight, rawHeight);
        line.height = height;
        cache.heights.update(lineIndex, height);
      }
    }
    return createLayoutView(cache, lineCount, options.measuredLineHeight, null);
  }

  const canIncrement = cache.wrapped
    && cache.content !== null
    && cache.context === options.measurementContext
    && isTextChangeTransition(cache.content, options.content, options.change ?? null);

  if (!canIncrement || !options.change) {
    const lines: CachedLayoutLine[] = [];
    let activeOwner: ActiveListOwner | null = null;
    const isFencedLine = createFencedLineLookup(options.fencedCodeRanges, 0);
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
      const lineStart = options.lineStartOffsets[lineIndex] ?? 0;
      const line = getLayoutLine(options, lineIndex, activeOwner, isFencedLine(lineStart));
      lines.push(line);
      activeOwner = line.outgoingOwner;
      cache.visitedLineCount += 1;
    }
    cache.lines = lines;
    cache.listLayouts = lines.map((line) => line.listLayout);
    cache.heights.reset(lines.map((line) => line.height));
  } else {
    const changedLine = findLineIndexForOffset(cache.lineStartOffsets, options.change.rangeStart);
    const newChangedEndLine = findLineIndexForOffset(
      options.lineStartOffsets,
      options.change.rangeStart + options.change.afterText.length
    );
    const sameLineCount = cache.lineStartOffsets.length === lineCount;
    let activeOwner = changedLine > 0 ? cache.lines[changedLine - 1]?.outgoingOwner ?? null : null;
    const isFencedLine = createFencedLineLookup(
      options.fencedCodeRanges,
      options.lineStartOffsets[changedLine] ?? 0
    );

    if (sameLineCount) {
      for (let lineIndex = changedLine; lineIndex < lineCount; lineIndex += 1) {
        const previous = cache.lines[lineIndex];
        const lineStart = options.lineStartOffsets[lineIndex] ?? 0;
        const next = getLayoutLine(options, lineIndex, activeOwner, isFencedLine(lineStart));
        cache.visitedLineCount += 1;
        if (lineIndex > newChangedEndLine && layoutLinesEqual(previous, next)) break;
        cache.lines[lineIndex] = next;
        cache.listLayouts[lineIndex] = next.listLayout;
        cache.heights.update(lineIndex, next.height);
        activeOwner = next.outgoingOwner;
      }
    } else {
      const lines = cache.lines.slice(0, changedLine);
      for (let lineIndex = changedLine; lineIndex < lineCount; lineIndex += 1) {
        const lineStart = options.lineStartOffsets[lineIndex] ?? 0;
        const next = getLayoutLine(options, lineIndex, activeOwner, isFencedLine(lineStart));
        lines.push(next);
        activeOwner = next.outgoingOwner;
        cache.visitedLineCount += 1;
      }
      cache.lines = lines;
      cache.listLayouts = lines.map((line) => line.listLayout);
      cache.heights.reset(lines.map((line) => line.height));
    }
  }

  cache.content = options.content;
  cache.context = options.measurementContext;
  cache.lineStartOffsets = options.lineStartOffsets;
  cache.wrapped = true;
  return createLayoutView(cache, lineCount, options.measuredLineHeight, null);
}

export function getFencedCodeBlockRanges(
  cache: FencedCodeBlockCache,
  content: string,
  lineStartOffsets: number[],
  change?: TextChange | null
): FencedCodeBlockRange[] {
  cache.visitedLineCount = 0;
  if (cache.content === content) return cache.ranges;

  let scanStartLine = 0;
  let preservedRanges: FencedCodeBlockRange[] = [];
  if (
    cache.content !== null
    && change
    && isTextChangeTransition(cache.content, content, change)
  ) {
    scanStartLine = findLineIndexForOffset(cache.lineStartOffsets, change.rangeStart);
    const containingRange = cache.ranges.find((range) => (
      range.openingLineIndex <= scanStartLine
      && (range.closingLineIndex ?? Number.POSITIVE_INFINITY) >= scanStartLine
    ));
    if (containingRange) scanStartLine = containingRange.openingLineIndex;
    preservedRanges = cache.ranges.filter((range) => (
      range.closingLineIndex !== undefined && range.closingLineIndex < scanStartLine
    ));
  }

  const ranges = [...preservedRanges];
  let activeRange: FencedCodeBlockRange | null = null;
  for (let lineIndex = scanStartLine; lineIndex < lineStartOffsets.length; lineIndex += 1) {
    cache.visitedLineCount += 1;
    const lineStart = lineStartOffsets[lineIndex] ?? 0;
    const lineText = getLineText(content, lineStartOffsets, lineIndex);
    const lineEnd = lineStart + lineText.length;

    if (activeRange) {
      const closingMatch = lineText.match(/^[ \t]*(`{3,})[ \t]*$/);
      if (closingMatch?.[1] && closingMatch[1].length >= activeRange.fenceLength) {
        activeRange.closingBoundaryStart = lineStart > 0 && content[lineStart - 1] === '\n'
          ? (lineStart > 1 && content[lineStart - 2] === '\r' ? lineStart - 2 : lineStart - 1)
          : lineStart;
        activeRange.closingLineIndex = lineIndex;
        activeRange.closingLineStart = lineStart;
        activeRange.closingLineEnd = lineEnd;
        activeRange.afterBlockStart = lineStartOffsets[lineIndex + 1] ?? lineEnd;
        activeRange = null;
      }
      continue;
    }

    const openingMatch = lineText.match(/^[ \t]*(`{3,})/);
    if (!openingMatch?.[1]) continue;
    activeRange = {
      openingLineIndex: lineIndex,
      openingLineStart: lineStart,
      openingLineEnd: lineEnd,
      contentStart: lineStartOffsets[lineIndex + 1] ?? lineEnd,
      fenceLength: openingMatch[1].length
    };
    ranges.push(activeRange);
  }

  cache.content = content;
  cache.lineStartOffsets = lineStartOffsets;
  cache.ranges = ranges;
  return ranges;
}
