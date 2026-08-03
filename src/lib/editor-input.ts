import type { EditorSnapshot } from './editor-undo';
import {
  createTextOffsetIndex,
  textareaOffsetToContentOffset,
  type TextOffsetIndex
} from './text-offset-index';
import type { TextChange } from './text-change';

export interface TextareaInputResult {
  snapshot: EditorSnapshot;
  change: TextChange | null;
  offsetIndex: TextOffsetIndex;
  inspectedCharacters: number;
}

export function getPreferredNewline(text: string, offset: number): string {
  const previousLineBreak = offset <= 0 ? -1 : text.lastIndexOf('\n', offset - 1);
  if (previousLineBreak >= 0) {
    return previousLineBreak > 0 && text[previousLineBreak - 1] === '\r' ? '\r\n' : '\n';
  }

  const nextLineBreak = text.indexOf('\n', offset);
  if (nextLineBreak >= 0) {
    return nextLineBreak > 0 && text[nextLineBreak - 1] === '\r' ? '\r\n' : '\n';
  }

  return '\n';
}

export function getSnapshotFromTextareaInput(
  before: EditorSnapshot,
  beforeOffsetIndex: TextOffsetIndex,
  textareaValue: string,
  textareaSelectionStart: number,
  textareaSelectionEnd: number
): TextareaInputResult {
  const beforeTextareaValue = beforeOffsetIndex.textareaValue;
  let prefixLength = 0;
  const prefixLimit = Math.min(beforeTextareaValue.length, textareaValue.length);

  while (
    prefixLength < prefixLimit
    && beforeTextareaValue[prefixLength] === textareaValue[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < beforeTextareaValue.length - prefixLength
    && suffixLength < textareaValue.length - prefixLength
    && beforeTextareaValue[beforeTextareaValue.length - suffixLength - 1]
      === textareaValue[textareaValue.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  const beforeTextareaEnd = beforeTextareaValue.length - suffixLength;
  const afterTextareaEnd = textareaValue.length - suffixLength;
  const contentStart = textareaOffsetToContentOffset(beforeOffsetIndex, prefixLength);
  const contentEnd = textareaOffsetToContentOffset(beforeOffsetIndex, beforeTextareaEnd);
  const newline = getPreferredNewline(before.content, contentStart);
  const replacement = textareaValue.slice(prefixLength, afterTextareaEnd).replace(/\n/g, newline);
  const beforeText = before.content.slice(contentStart, contentEnd);
  const content = `${before.content.slice(0, contentStart)}${replacement}${before.content.slice(contentEnd)}`;
  const change = beforeText === replacement
    ? null
    : { rangeStart: contentStart, beforeText, afterText: replacement };
  const offsetIndex = change ? createTextOffsetIndex(content) : beforeOffsetIndex;

  return {
    snapshot: {
      content,
      selection: {
        start: textareaOffsetToContentOffset(offsetIndex, textareaSelectionStart),
        end: textareaOffsetToContentOffset(offsetIndex, textareaSelectionEnd)
      }
    },
    change,
    offsetIndex,
    inspectedCharacters: prefixLength + suffixLength
  };
}
