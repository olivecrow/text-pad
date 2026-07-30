import type { FencedCodeLinePosition, Token } from './render-tokenizer';

export interface ParsedLine {
  id: number;
  indentLevel: number;
  indentColumns: number;
  extraIndentSpaces: number;
  tokens: Token[];
  fencedCodePosition?: FencedCodeLinePosition;
}

export interface DocumentLineRange {
  startLine: number;
  endLine: number;
}

export interface FlatToken extends Token {
  text: string;
  start: number;
  end: number;
}

export type FlatTokenDepthResolver = (
  token: FlatToken,
  line: ParsedLine,
  indentUnit: number
) => number | undefined;

export function getIndentInfo(lineText: string, tabSize: number) {
  const match = lineText.match(/^([ \t]*)/);
  const indentStr = match ? match[0] : '';

  let totalSpaces = 0;
  for (let j = 0; j < indentStr.length; j++) {
    totalSpaces += indentStr[j] === '\t' ? tabSize : 1;
  }

  return {
    indentLevel: Math.floor(totalSpaces / tabSize),
    indentColumns: totalSpaces,
    extraIndentSpaces: totalSpaces % tabSize
  };
}

export function normalizeLineRange(lineCount: number, lineRange?: DocumentLineRange): DocumentLineRange {
  if (lineCount <= 0) return { startLine: 0, endLine: 0 };

  const startLine = Math.max(0, Math.min(lineRange?.startLine ?? 0, lineCount - 1));
  const endLine = Math.max(startLine, Math.min(lineRange?.endLine ?? lineCount - 1, lineCount - 1));

  return { startLine, endLine };
}

export function getLineRangeOffsets(
  content: string,
  lineStartOffsets: number[],
  lineRange: DocumentLineRange
): { start: number; end: number } {
  return {
    start: lineStartOffsets[lineRange.startLine] ?? 0,
    end: lineStartOffsets[lineRange.endLine + 1] ?? content.length
  };
}

export function getLineText(content: string, lineStartOffsets: number[], lineIndex: number): string {
  const lineStart = lineStartOffsets[lineIndex] ?? 0;
  const nextLineStart = lineStartOffsets[lineIndex + 1];
  let lineEnd = nextLineStart ?? content.length;

  if (nextLineStart !== undefined && content[lineEnd - 1] === '\n') {
    lineEnd -= 1;
    if (lineEnd > lineStart && content[lineEnd - 1] === '\r') {
      lineEnd -= 1;
    }
  }

  return content.slice(lineStart, lineEnd);
}

export function getLineContentEndOffset(content: string, lineStartOffsets: number[], lineIndex: number): number {
  const lineStart = lineStartOffsets[lineIndex] ?? 0;
  const nextLineStart = lineStartOffsets[lineIndex + 1];
  let lineEnd = nextLineStart ?? content.length;

  if (nextLineStart !== undefined && content[lineEnd - 1] === '\n') {
    lineEnd -= 1;
    if (lineEnd > lineStart && content[lineEnd - 1] === '\r') {
      lineEnd -= 1;
    }
  }

  return lineEnd;
}

export function shouldKeepFlatToken(token: FlatToken, range?: { start: number; end: number }): boolean {
  return !range || (token.end > range.start && token.start < range.end);
}

export function inferIndentUnit(content: string, lineStartOffsets: number[], tabSize: number): number {
  let minPositiveIndent = Number.POSITIVE_INFINITY;

  for (let lineIndex = 0; lineIndex < lineStartOffsets.length; lineIndex += 1) {
    const lineStart = lineStartOffsets[lineIndex] ?? 0;
    const lineEnd = getLineContentEndOffset(content, lineStartOffsets, lineIndex);
    let indentColumns = 0;

    for (let i = lineStart; i < lineEnd; i += 1) {
      const char = content[i];
      if (char === ' ') {
        indentColumns += 1;
      } else if (char === '\t') {
        indentColumns += tabSize;
      } else {
        break;
      }
    }

    if (indentColumns > 0 && indentColumns < minPositiveIndent) {
      minPositiveIndent = indentColumns;
      if (minPositiveIndent === 1) return 1;
    }
  }

  return Number.isFinite(minPositiveIndent) ? minPositiveIndent : tabSize;
}

export function getIndentDepth(line: ParsedLine, indentUnit: number, offset = 0): number {
  if (line.indentColumns <= 0 || indentUnit <= 0) return Math.max(offset, 0);
  return Math.max(Math.floor(line.indentColumns / indentUnit) + offset, 0);
}

export function findLineIndexForOffset(lineStartOffsets: number[], offset: number): number {
  let low = 0;
  let high = lineStartOffsets.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const current = lineStartOffsets[mid] ?? 0;
    const next = lineStartOffsets[mid + 1] ?? Number.POSITIVE_INFINITY;

    if (offset >= current && offset < next) return mid;
    if (offset < current) high = mid - 1;
    else low = mid + 1;
  }

  return Math.max(0, lineStartOffsets.length - 1);
}

export function splitFlatTokensIntoLines(
  content: string,
  flatTokens: FlatToken[],
  tabSize: number,
  lineStartOffsets: number[],
  lineRange: DocumentLineRange,
  resolveDepth?: FlatTokenDepthResolver
): ParsedLine[] {
  const lineRangeOffsets = getLineRangeOffsets(content, lineStartOffsets, lineRange);
  const lines: ParsedLine[] = [];
  const indentUnit = inferIndentUnit(content, lineStartOffsets, tabSize);

  for (let lineIndex = lineRange.startLine; lineIndex <= lineRange.endLine; lineIndex++) {
    const lineText = getLineText(content, lineStartOffsets, lineIndex);
    lines.push({
      id: lineIndex,
      ...getIndentInfo(lineText, tabSize),
      tokens: []
    });
  }

  for (const token of flatTokens) {
    let start = Math.max(token.start, lineRangeOffsets.start);
    const tokenEnd = Math.min(token.end, lineRangeOffsets.end);

    while (start < tokenEnd) {
      const lineIndex = findLineIndexForOffset(lineStartOffsets, start);
      if (lineIndex < lineRange.startLine || lineIndex > lineRange.endLine) {
        start = lineStartOffsets[lineIndex + 1] ?? tokenEnd;
        continue;
      }
      const lineEnd = getLineContentEndOffset(content, lineStartOffsets, lineIndex);
      const segmentEnd = Math.min(tokenEnd, lineEnd);
      const outputLine = lines[lineIndex - lineRange.startLine];

      if (outputLine && segmentEnd > start) {
        outputLine.tokens.push({
          type: token.type,
          text: content.slice(start, segmentEnd),
          depth: resolveDepth?.(token, outputLine, indentUnit) ?? token.depth,
          start,
          end: segmentEnd
        });
        start = segmentEnd;
      } else {
        start = lineStartOffsets[lineIndex + 1] ?? tokenEnd;
      }
    }
  }

  return lines;
}
