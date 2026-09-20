import type { EditorSelection, EditorSnapshot } from './editor-undo';
import type { MarkdownRichBlock } from './markdown-rich-text';
import { renderMappedMarkdown } from './markdown-source-renderer';
import type { TextChange } from './text-change';

/** 브라우저가 교체한 범위의 숨긴 서식을 복원하되 실제 선택 의도를 유지한다. */
export function repairMarkdownInput(before: EditorSnapshot, after: EditorSnapshot, change: TextChange | null,
  regions: MarkdownRichBlock[], showHeadingMarkers = false): EditorSnapshot {
  if (!change?.beforeText) return after;
  // 최소 차이는 전체 선택 교체의 공통 접두부/접미부를 제외하므로 선택 범위를 우선한다.
  const selection = before.selection.start < before.selection.end
    && before.selection.start <= change.rangeStart
    && before.selection.end >= change.rangeStart + change.beforeText.length
    ? before.selection
    : { start: change.rangeStart, end: change.rangeStart + change.beforeText.length };
  const replacementEnd = selection.end + change.afterText.length - change.beforeText.length;
  const safe = replaceMarkdownSelection(before.content, selection,
    after.content.slice(selection.start, replacementEnd), regions, showHeadingMarkers);
  return safe.content === after.content ? after : safe;
}

/** 선택한 표시 문자만 교체한다. 감싸는 문법과 선택 밖 원문은 그대로 둔다. */
export function replaceMarkdownSelection(content: string, selection: EditorSelection, text: string,
  regions: MarkdownRichBlock[], showHeadingMarkers = false): EditorSnapshot {
  const { start, end } = selection;
  const keep: Array<{ start: number; end: number }> = [];
  for (const region of regions) {
    if (region.end <= start || region.start >= end || start <= region.start && end >= region.end) continue;
    let maps: number[][];
    try { maps = renderMappedMarkdown(region.source, region.environment, { showHeadingMarkers }).maps; }
    catch { continue; } // 원문 대체 표시와 동일하게 편집한다.
    const visible = maps.flatMap(offsets => offsets.slice(0, -1).flatMap((offset, i) =>
      offsets[i + 1] > offset ? [{ start: region.start + offset, end: region.start + offsets[i + 1] }] : []))
      .sort((a, b) => a.start - b.start);
    let cursor = Math.max(start, region.start);
    const limit = Math.min(end, region.end);
    for (const range of visible) {
      if (range.end <= cursor || range.start >= limit) continue;
      if (range.start > cursor) keep.push({ start: cursor, end: range.start });
      cursor = Math.max(cursor, Math.min(limit, range.end));
    }
    if (cursor < limit) keep.push({ start: cursor, end: limit });
  }
  let result = content.slice(0, start) + text;
  for (const range of keep) {
    const syntax = content.slice(range.start, range.end);
    // Markdown의 일반 줄바꿈/여백은 감싸는 서식이 아니다.
    if (syntax.trim()) result += syntax;
  }
  result += content.slice(end);
  return { content: result, selection: { start: start + text.length, end: start + text.length } };
}
