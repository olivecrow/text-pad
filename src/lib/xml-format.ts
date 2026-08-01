import { XMLValidator } from 'fast-xml-parser';
import type { Token } from './render-tokenizer';
import {
  splitFlatTokensIntoLines,
  type DocumentLineRange,
  type FlatToken,
  type ParsedLine
} from './structured-rendering';

export interface XmlDiagnosticPosition {
  line: number;
  column: number;
  offset: number;
}

interface ParseXmlOptions {
  tabSize: number;
  lineStartOffsets: number[];
  lineRange: DocumentLineRange;
}

function pushToken(tokens: FlatToken[], type: Token['type'], content: string, start: number, end: number) {
  if (end <= start) return;
  tokens.push({ type, text: content.slice(start, end), start, end });
}

function tokenizeCharacterData(tokens: FlatToken[], content: string, start: number, end: number) {
  const entityPattern = /&(?:#[0-9]+|#x[0-9a-fA-F]+|[A-Za-z_][A-Za-z0-9_.:-]*);/gu;
  entityPattern.lastIndex = start;
  let cursor = start;
  let match: RegExpExecArray | null;
  while ((match = entityPattern.exec(content)) !== null && match.index < end) {
    if (match.index > cursor) pushToken(tokens, 'text', content, cursor, match.index);
    const matchEnd = Math.min(end, match.index + match[0].length);
    pushToken(tokens, 'keyword', content, match.index, matchEnd);
    cursor = matchEnd;
  }
  if (cursor < end) pushToken(tokens, 'text', content, cursor, end);
}

function findMarkupEnd(content: string, start: number, terminator: '>' | '?>'): number {
  let quote: '"' | "'" | null = null;
  let bracketDepth = 0;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '[') bracketDepth += 1;
    if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    if (bracketDepth === 0 && terminator === '?>' && content.startsWith('?>', index)) return index + 2;
    if (bracketDepth === 0 && terminator === '>' && char === '>') return index + 1;
  }
  return content.length;
}

function tokenizeTag(tokens: FlatToken[], content: string, start: number, end: number, processing: boolean) {
  const openingLength = processing ? 2 : content.startsWith('</', start) ? 2 : 1;
  const closingLength = processing ? 2 : content.slice(Math.max(start, end - 2), end) === '/>' ? 2 : 1;
  pushToken(tokens, 'punctuation', content, start, Math.min(end, start + openingLength));

  let cursor = start + openingLength;
  while (cursor < end - closingLength && /\s/u.test(content[cursor] || '')) cursor += 1;
  const nameStart = cursor;
  while (cursor < end - closingLength && /[^\s/>?]/u.test(content[cursor] || '')) cursor += 1;
  pushToken(tokens, processing ? 'directive' : 'tag', content, nameStart, cursor);

  while (cursor < end - closingLength) {
    const whitespaceStart = cursor;
    while (cursor < end - closingLength && /\s/u.test(content[cursor] || '')) cursor += 1;
    pushToken(tokens, 'text', content, whitespaceStart, cursor);
    if (cursor >= end - closingLength) break;
    if (content[cursor] === '/') {
      pushToken(tokens, 'punctuation', content, cursor, cursor + 1);
      cursor += 1;
      continue;
    }

    const attributeStart = cursor;
    while (cursor < end - closingLength && /[^\s=/>?]/u.test(content[cursor] || '')) cursor += 1;
    if (cursor === attributeStart) {
      pushToken(tokens, 'invalid', content, cursor, cursor + 1);
      cursor += 1;
      continue;
    }
    pushToken(tokens, 'attribute', content, attributeStart, cursor);

    const spacingStart = cursor;
    while (cursor < end - closingLength && /\s/u.test(content[cursor] || '')) cursor += 1;
    pushToken(tokens, 'text', content, spacingStart, cursor);
    if (content[cursor] !== '=') continue;
    pushToken(tokens, 'operator', content, cursor, cursor + 1);
    cursor += 1;
    const valueSpacingStart = cursor;
    while (cursor < end - closingLength && /\s/u.test(content[cursor] || '')) cursor += 1;
    pushToken(tokens, 'text', content, valueSpacingStart, cursor);

    const quote = content[cursor];
    if (quote === '"' || quote === "'") {
      const valueStart = cursor;
      cursor += 1;
      while (cursor < end - closingLength && content[cursor] !== quote) cursor += 1;
      if (cursor < end - closingLength) cursor += 1;
      pushToken(tokens, 'string', content, valueStart, cursor);
    } else {
      const valueStart = cursor;
      while (cursor < end - closingLength && /[^\s/>?]/u.test(content[cursor] || '')) cursor += 1;
      pushToken(tokens, 'invalid', content, valueStart, cursor);
    }
  }

  pushToken(tokens, 'punctuation', content, Math.max(start + openingLength, end - closingLength), end);
}

function scanXmlTokens(content: string): FlatToken[] {
  const tokens: FlatToken[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const markupStart = content.indexOf('<', cursor);
    if (markupStart === -1) {
      tokenizeCharacterData(tokens, content, cursor, content.length);
      break;
    }
    tokenizeCharacterData(tokens, content, cursor, markupStart);

    if (content.startsWith('<!--', markupStart)) {
      const closeIndex = content.indexOf('-->', markupStart + 4);
      const end = closeIndex === -1 ? content.length : closeIndex + 3;
      pushToken(tokens, closeIndex === -1 ? 'invalid' : 'comment', content, markupStart, end);
      cursor = end;
      continue;
    }
    if (content.startsWith('<![CDATA[', markupStart)) {
      const valueStart = markupStart + 9;
      const closeIndex = content.indexOf(']]>', valueStart);
      const end = closeIndex === -1 ? content.length : closeIndex + 3;
      pushToken(tokens, 'punctuation', content, markupStart, valueStart);
      pushToken(tokens, closeIndex === -1 ? 'invalid' : 'string', content, valueStart, closeIndex === -1 ? end : closeIndex);
      if (closeIndex !== -1) pushToken(tokens, 'punctuation', content, closeIndex, end);
      cursor = end;
      continue;
    }
    if (/^<!DOCTYPE\b/iu.test(content.slice(markupStart, markupStart + 16))) {
      const end = findMarkupEnd(content, markupStart + 2, '>');
      pushToken(tokens, 'punctuation', content, markupStart, markupStart + 2);
      const keywordEnd = markupStart + 9;
      pushToken(tokens, 'directive', content, markupStart + 2, Math.min(end, keywordEnd));
      pushToken(tokens, end === content.length && content[end - 1] !== '>' ? 'invalid' : 'text', content, Math.min(end, keywordEnd), Math.max(markupStart + 2, end - 1));
      if (content[end - 1] === '>') pushToken(tokens, 'punctuation', content, end - 1, end);
      cursor = end;
      continue;
    }
    if (content.startsWith('<?', markupStart)) {
      const end = findMarkupEnd(content, markupStart + 2, '?>');
      tokenizeTag(tokens, content, markupStart, end, true);
      cursor = end;
      continue;
    }
    if (content.startsWith('<!', markupStart)) {
      const end = findMarkupEnd(content, markupStart + 2, '>');
      pushToken(tokens, end === content.length && content[end - 1] !== '>' ? 'invalid' : 'directive', content, markupStart, end);
      cursor = end;
      continue;
    }

    const end = findMarkupEnd(content, markupStart + 1, '>');
    tokenizeTag(tokens, content, markupStart, end, false);
    cursor = end;
  }
  return tokens;
}

export function parseXmlFormat(content: string, options: ParseXmlOptions): ParsedLine[] {
  const lines = splitFlatTokensIntoLines(
    content,
    scanXmlTokens(content),
    options.tabSize,
    options.lineStartOffsets,
    options.lineRange
  );
  for (const line of lines) {
    if (line.tokens.some((token) => token.type === 'tag' || token.type === 'directive')) {
      line.lineKind = 'markup';
    }
  }
  return lines;
}

function lineColumnToOffset(content: string, line: number, column: number): number {
  let currentLine = 1;
  let offset = 0;
  while (currentLine < line && offset < content.length) {
    const next = content.indexOf('\n', offset);
    if (next === -1) return content.length;
    offset = next + 1;
    currentLine += 1;
  }
  return Math.min(content.length, offset + Math.max(0, column - 1));
}

export function getXmlDiagnostic(content: string): XmlDiagnosticPosition | null {
  if (!content.trim()) return { line: 1, column: 1, offset: 0 };
  const result = XMLValidator.validate(content, {
    allowBooleanAttributes: false,
    unpairedTags: []
  });
  if (result === true) return null;
  const line = Math.max(1, result.err.line || 1);
  const column = Math.max(1, result.err.col || 1);
  return { line, column, offset: lineColumnToOffset(content, line, column) };
}
