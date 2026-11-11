import type { EditorSelection, EditorSnapshot } from './editor-undo';

export interface CaretRange { anchor: number; head: number }
export interface MultiCaretSelection { ranges: CaretRange[]; primary: number }
export interface CaretReplacement { start: number; end: number; text: string; caret?: number }

export function caretSelection(range: CaretRange): EditorSelection {
  return { start: Math.min(range.anchor, range.head), end: Math.max(range.anchor, range.head) };
}

export function cloneMultiCaret(value: MultiCaretSelection | undefined | null): MultiCaretSelection | undefined {
  return value ? { primary: value.primary, ranges: value.ranges.map(range => ({ ...range })) } : undefined;
}

/** 겹치는 선택과 같은 위치의 캐럿을 합쳐 같은 원문을 두 번 편집하지 않는다. */
export function normalizeMultiCaret(value: MultiCaretSelection, length: number): MultiCaretSelection {
  const clamp = (offset: number) => Math.max(0, Math.min(length, offset));
  const sorted = value.ranges.map((range, index) => ({
    anchor: clamp(range.anchor), head: clamp(range.head), primary: index === value.primary
  })).sort((a, b) => caretSelection(a).start - caretSelection(b).start || caretSelection(a).end - caretSelection(b).end);
  const merged: typeof sorted = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    const current = caretSelection(range);
    if (last && current.start <= caretSelection(last).end) {
      const start = caretSelection(last).start;
      const end = Math.max(current.end, caretSelection(last).end);
      const backward = (range.primary ? range : last).head < (range.primary ? range : last).anchor;
      last.anchor = backward ? end : start;
      last.head = backward ? start : end;
      last.primary ||= range.primary;
    } else merged.push({ ...range });
  }
  return { ranges: merged.map(({ anchor, head }) => ({ anchor, head })),
    primary: Math.max(0, merged.findIndex(range => range.primary)) };
}

export function multiCaretSnapshot(content: string, value: MultiCaretSelection): EditorSnapshot {
  const multiCaret = normalizeMultiCaret(value, content.length);
  return { content, selection: caretSelection(multiCaret.ranges[multiCaret.primary] ?? { anchor: 0, head: 0 }),
    ...(multiCaret.ranges.length > 1 ? { multiCaret } : {}) };
}

/** 각 교체 범위는 같은 변경 전 원문을 기준으로 하며, 겹치는 삭제는 한 번만 적용한다. */
export function replaceAtCarets(content: string, value: MultiCaretSelection, replacements: CaretReplacement[]): EditorSnapshot {
  const edits = replacements.map((edit, index) => ({ ...edit, owners: [index] }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const unique: typeof edits = [];
  for (const edit of edits) {
    const last = unique.at(-1);
    if (last && (edit.start < last.end || edit.start === last.start && edit.end === last.end)) {
      last.end = Math.max(last.end, edit.end);
      last.owners.push(...edit.owners);
    } else unique.push(edit);
  }
  const ranges = value.ranges.map(range => ({ ...range }));
  const parts: string[] = [];
  let sourceOffset = 0;
  let delta = 0;
  for (const edit of unique) {
    parts.push(content.slice(sourceOffset, edit.start), edit.text);
    const head = edit.start + delta + (edit.caret ?? edit.text.length);
    for (const owner of edit.owners) ranges[owner] = { anchor: head, head };
    sourceOffset = edit.end;
    delta += edit.text.length - (edit.end - edit.start);
  }
  parts.push(content.slice(sourceOffset));
  return multiCaretSnapshot(parts.join(''), { ranges, primary: value.primary });
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const words = new Intl.Segmenter(undefined, { granularity: 'word' });

/** 한글 조합 문자, 이모지와 CRLF를 중간에서 자르지 않는다. */
export function adjacentTextOffset(content: string, offset: number, direction: -1 | 1, word = false): number {
  if (direction < 0 && offset <= 0 || direction > 0 && offset >= content.length) return offset;
  const start = offset > 0 ? content.lastIndexOf('\n', offset - 1) + 1 : 0;
  const nextBreak = content.indexOf('\n', offset);
  const end = nextBreak < 0 ? content.length : nextBreak + 1;
  if (direction < 0 && offset === start) return offset - (content[offset - 2] === '\r' ? 2 : 1);
  const segments = word ? words.segment(content.slice(start, end)) : graphemes.segment(content.slice(start, end));
  let previous = start;
  for (const segment of segments) {
    const from = start + segment.index;
    const to = from + segment.segment.length;
    if (direction < 0) {
      if (from >= offset) break;
      if (!word || segment.segment.trim()) previous = from;
    } else if (to > offset && (!word || segment.segment.trim())) return to;
  }
  return direction < 0 ? previous : end;
}

export function splitCaretPaste(text: string, count: number): string[] {
  const lines = text.split(/\r\n|\r|\n/u);
  return lines.length === count ? lines : Array.from({ length: count }, () => text);
}
