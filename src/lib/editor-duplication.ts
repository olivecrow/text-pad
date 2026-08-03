import type { EditorSelection } from './editor-undo';

export interface EditorDuplicationEdit {
  content: string;
  selection: EditorSelection;
}

function clampOffset(content: string, offset: number): number {
  return Math.max(0, Math.min(offset, content.length));
}

export function getEditorDuplicationEdit(
  content: string,
  selection: EditorSelection,
  preferredNewline: string
): EditorDuplicationEdit {
  const start = clampOffset(content, Math.min(selection.start, selection.end));
  const end = clampOffset(content, Math.max(selection.start, selection.end));

  if (start !== end) {
    const selectedText = content.slice(start, end);
    return {
      content: `${content.slice(0, end)}${selectedText}${content.slice(end)}`,
      selection: {
        start: end,
        end: end + selectedText.length
      }
    };
  }

  const lineStart = content.lastIndexOf('\n', start - 1) + 1;
  const lineBreak = content.indexOf('\n', start);
  if (lineBreak !== -1) {
    const lineEnd = lineBreak > lineStart && content[lineBreak - 1] === '\r'
      ? lineBreak - 1
      : lineBreak;
    const nextLineStart = lineBreak + 1;
    const lineText = content.slice(lineStart, lineEnd);
    const lineEnding = content.slice(lineEnd, nextLineStart);
    const caretColumn = Math.min(start - lineStart, lineText.length);

    return {
      content: `${content.slice(0, nextLineStart)}${lineText}${lineEnding}${content.slice(nextLineStart)}`,
      selection: {
        start: nextLineStart + caretColumn,
        end: nextLineStart + caretColumn
      }
    };
  }

  const lineText = content.slice(lineStart);
  const caretColumn = Math.min(start - lineStart, lineText.length);
  const duplicatedLineStart = content.length + preferredNewline.length;

  return {
    content: `${content}${preferredNewline}${lineText}`,
    selection: {
      start: duplicatedLineStart + caretColumn,
      end: duplicatedLineStart + caretColumn
    }
  };
}
