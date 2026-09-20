export interface MarkdownHeadingSpaceEdit {
  content: string;
  selection: { start: number; end: number };
}

function getLineBounds(content: string, offset: number): { start: number; end: number } {
  const start = content.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const lineBreak = content.indexOf('\n', offset);
  const end = lineBreak === -1
    ? content.length
    : lineBreak > 0 && content[lineBreak - 1] === '\r'
      ? lineBreak - 1
      : lineBreak;
  return { start, end };
}

export function canInsertMarkdownHeadingReplacementMarker(content: string, caret: number): boolean {
  if (caret < 0 || caret > content.length) return false;

  const line = getLineBounds(content, caret);
  return /^[ \t]{0,3}#{0,5}$/u.test(content.slice(line.start, caret))
    && /^[ \t]{0,3}#{1,6}[ \t]+/u.test(content.slice(caret, line.end));
}

export function getMarkdownHeadingSpaceEdit(
  content: string,
  caret: number
): MarkdownHeadingSpaceEdit | null {
  if (caret <= 0 || caret > content.length) return null;

  const line = getLineBounds(content, caret);
  const newMarker = content.slice(line.start, caret).match(/^([ \t]{0,3})(#{1,6})$/u);
  if (!newMarker) return null;

  const existingMarker = content.slice(caret, line.end).match(/^[ \t]{0,3}#{1,6}[ \t]+/u);
  const replacementEnd = caret + (existingMarker?.[0].length ?? 0);
  const replacement = `${newMarker[1] ?? ''}${newMarker[2] ?? ''} `;
  const nextCaret = line.start + replacement.length;

  return {
    content: `${content.slice(0, line.start)}${replacement}${content.slice(replacementEnd)}`,
    selection: { start: nextCaret, end: nextCaret }
  };
}
