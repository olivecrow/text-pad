import type { EditorSelection } from './editor-selection';
import type { MarkdownRichBlock } from './markdown-rich-text';
import { renderMappedMarkdown, type MappedMarkdown } from './markdown-source-renderer';
import { tokenizeLine, type Token } from './render-tokenizer';
import { adjacentTextOffset } from './multi-caret';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function lowerBound(values: readonly number[], value: number): number {
  let low = 0, high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** 표시 여부와 관계없이 같은 원문에서 같은 이동·삭제 경계를 만든다. DOM은 좌표만 담당한다. */
export class RenderTextIndex {
  private boundaries: number[];
  private characters: EditorSelection[];
  private starts: number[];
  private ends: number[];

  constructor(readonly mapped: Pick<MappedMarkdown, 'maps' | 'texts' | 'codeRanges' | 'inlineCodeRanges' | 'hiddenHeadingMarkers' | 'disclosures'>,
    disclosureState: readonly boolean[] = []) {
    const boundaries = new Set<number>();
    const characters: EditorSelection[] = [];
    const insideClosedDisclosure = (start: number, end: number) => mapped.disclosures?.some((range, i) =>
      !(disclosureState[i] ?? range.open) && start >= range.bodyStart && end <= range.end);
    mapped.texts.forEach((text, index) => {
      const offsets = mapped.maps[index];
      for (const segment of graphemes.segment(text)) {
        const start = offsets[segment.index], end = offsets[segment.index + segment.segment.length];
        if (insideClosedDisclosure(start, end)) continue;
        boundaries.add(start); boundaries.add(end);
        if (end > start) characters.push({ start, end });
      }
    });
    // 숨긴 백틱은 삭제할 표시 문자가 아니지만, 그 바깥은 일반 텍스트를 입력할 수 있다.
    for (const { start, end } of mapped.inlineCodeRanges ?? []) {
      if (insideClosedDisclosure(start, end)) continue;
      boundaries.add(start);
      boundaries.add(end);
    }
    this.boundaries = [...boundaries].sort((a, b) => a - b);
    this.characters = characters.sort((a, b) => a.start - b.start || a.end - b.end);
    this.starts = this.characters.map(range => range.start);
    this.ends = this.characters.map(range => range.end);
  }

  boundary(offset: number, direction: -1 | 0 | 1 = 0): number {
    if (!this.boundaries.length) return offset;
    const index = lowerBound(this.boundaries, offset);
    const after = this.boundaries[Math.min(index, this.boundaries.length - 1)];
    const before = this.boundaries[Math.max(0, index - 1)];
    if (after === offset) return offset;
    return direction < 0 ? before : direction > 0 ? after : offset - before < after - offset ? before : after;
  }

  adjacent(offset: number, direction: -1 | 1): number | null {
    const index = lowerBound(this.boundaries, offset);
    return (direction < 0 ? this.boundaries[index - 1]
      : this.boundaries[this.boundaries[index] === offset ? index + 1 : index]) ?? null;
  }

  deletion(offset: number, direction: -1 | 1): EditorSelection | null {
    if (direction > 0) return this.characters[lowerBound(this.starts, offset)] ?? null;
    let index = lowerBound(this.ends, offset);
    if (this.ends[index] !== offset) index--;
    return this.characters[index] ?? null;
  }
}

export interface RenderEditRegion { start: number; end: number; index: RenderTextIndex }

/** 키보드·메뉴·다중 캐럿이 공유하는 문자 삭제. 숨긴 구문 대신 원문 줄바꿈을 합친다. */
export function renderedDeletion(content: string, region: RenderEditRegion, offset: number,
  direction: -1 | 1): EditorSelection {
  const lineStart = offset > 0 ? content.lastIndexOf('\n', offset - 1) + 1 : 0;
  const prefix = content.slice(lineStart, offset);
  const localOffset = offset - region.start;
  const inCode = region.index.mapped.codeRanges?.some(range => localOffset >= range.start && localOffset <= range.end);
  if (!inCode && direction < 0 && /^(?: {0,3}>[ \t]?)+$/u.test(prefix)) return { start: lineStart, end: offset };
  const local = region.index.deletion(localOffset, direction);
  if (direction < 0) {
    const marker = region.index.mapped.hiddenHeadingMarkers?.find(marker =>
      marker.start >= lineStart - region.start && marker.start < localOffset && (!local || local.end <= marker.start));
    if (marker) {
      // 본문 첫 글자 앞에서는 숨긴 제목 표식의 끝을 편집하고 위 줄의 개행을 보존한다.
      const end = region.start + Math.min(localOffset, marker.end);
      return { start: end - 1, end };
    }
  }
  if (local) return { start: region.start + local.start, end: region.start + local.end };
  const edge = direction < 0 ? region.start : region.end;
  const adjacent = adjacentTextOffset(content, edge, direction);
  const start = Math.min(edge, adjacent), end = Math.max(edge, adjacent);
  return /^\r?\n$/u.test(content.slice(start, end)) ? { start, end } : { start: offset, end: offset };
}

const richIndexes = new WeakMap<MarkdownRichBlock, Map<boolean, RenderTextIndex>>();
const disclosureIndexes = new WeakMap<RenderTextIndex, Map<string, RenderTextIndex>>();

export function getMarkdownEditIndex(region: MarkdownRichBlock, showHeadingMarkers = false): RenderTextIndex {
  let variants = richIndexes.get(region);
  if (!variants) { variants = new Map(); richIndexes.set(region, variants); }
  let index = variants.get(showHeadingMarkers);
  if (!index) {
    index = new RenderTextIndex(renderMappedMarkdown(region.source, region.environment, { showHeadingMarkers }));
    variants.set(showHeadingMarkers, index);
  }
  return index;
}

export function withDisclosureState(index: RenderTextIndex, state: readonly boolean[] | undefined): RenderTextIndex {
  if (!state?.length) return index;
  const key = state.map(open => open ? '1' : '0').join('');
  let variants = disclosureIndexes.get(index);
  if (!variants) { variants = new Map(); disclosureIndexes.set(index, variants); }
  let result = variants.get(key);
  if (!result) {
    result = new RenderTextIndex(index.mapped, state);
    if (variants.size >= 4) variants.delete(variants.keys().next().value!);
    variants.set(key, result);
  }
  return result;
}

// 일반 강조 줄은 실제 토큰과 같은 문법만 숨긴다. 문단 해석기의 공백 정규화를 적용하지 않는다.
const inlineIndexes = new Map<string, RenderTextIndex>();
let inlineCacheCharacters = 0;
export function getInlineEditIndex(source: string, hideHeadingMarkers: boolean): RenderTextIndex {
  const key = `${hideHeadingMarkers ? 1 : 0}:${source}`;
  const cached = inlineIndexes.get(key);
  if (cached) return cached;
  const maps: number[][] = [], texts: string[] = [];
  const inlineCodeRanges: EditorSelection[] = [];
  const hiddenHeadingMarkers: EditorSelection[] = [];
  let offset = 0;
  function visit(tokens: Token[]) {
    for (const token of tokens) {
      if (token.children) {
        const start = offset;
        visit(token.children);
        if (token.type === 'code' && token.children[0]?.hiddenSyntax && token.children.at(-1)?.hiddenSyntax) {
          inlineCodeRanges.push({ start, end: offset });
        }
      } else {
        const text = token.text ?? '';
        if (!token.hiddenSyntax && text) {
          texts.push(text); maps.push(Array.from({ length: text.length + 1 }, (_, i) => offset + i));
        } else if (token.type === 'heading-marker' && text) {
          hiddenHeadingMarkers.push({ start: offset, end: offset + text.length });
        }
        offset += text.length;
      }
    }
  }
  visit(tokenizeLine(source, { markdown: { hideHeadingMarkers }, suppressCodeFence: true }));
  const index = new RenderTextIndex({ maps, texts, inlineCodeRanges, hiddenHeadingMarkers });
  // 긴 줄 편집 이력을 256개씩 붙잡지 않는다. 큰 단일 줄은 마지막 인덱스만 재사용한다.
  while (inlineIndexes.size && (inlineIndexes.size >= 256 || inlineCacheCharacters + key.length > 256 * 1024)) {
    const oldest = inlineIndexes.keys().next().value!;
    inlineIndexes.delete(oldest);
    inlineCacheCharacters -= oldest.length;
  }
  inlineIndexes.set(key, index);
  inlineCacheCharacters += key.length;
  return index;
}
