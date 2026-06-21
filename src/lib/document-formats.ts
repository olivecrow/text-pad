import {
  getCommentSyntaxForPath,
  tokenizeLineWithState,
  type CommentSyntax,
  type Token,
  type TokenizeState
} from './render-tokenizer';

export interface ParsedLine {
  id: number;
  indentLevel: number;
  indentColumns: number;
  extraIndentSpaces: number;
  tokens: Token[];
}

export interface DocumentDiagnostic {
  severity: 'error';
  message: string;
  line: number;
  column: number;
  offset: number;
}

export interface DocumentFormat {
  id: 'plain' | 'json';
  label: string;
  extensions: string[];
  defaultExtension: string;
  validatesSyntax: boolean;
}

export interface DocumentRenderResult {
  format: DocumentFormat;
  lines: ParsedLine[];
  diagnostic: DocumentDiagnostic | null;
}

export interface DocumentLineRange {
  startLine: number;
  endLine: number;
}

interface ParseDocumentOptions {
  pathOrName: string | null | undefined;
  tabSize: number;
  lineStartOffsets: number[];
  lineRange?: DocumentLineRange;
}

interface FlatToken extends Token {
  text: string;
  start: number;
  end: number;
}

const plainTextFormat: DocumentFormat = {
  id: 'plain',
  label: '텍스트',
  extensions: [],
  defaultExtension: 'txt',
  validatesSyntax: false
};

const jsonFormat: DocumentFormat = {
  id: 'json',
  label: 'JSON',
  extensions: ['json'],
  defaultExtension: 'json',
  validatesSyntax: true
};

const documentFormats = [jsonFormat];

export const supportedTextExtensions = [
  'txt',
  'md',
  'json',
  'csv',
  'tsv',
  'yaml',
  'yml',
  'ini',
  'cfg',
  'log',
  'js',
  'ts',
  'rs',
  'html',
  'css'
];

export const openFileDialogFilters = [
  {
    name: 'Text Files',
    extensions: supportedTextExtensions
  }
];

export const saveFileDialogFilters = [
  {
    name: 'Text Files',
    extensions: ['txt']
  },
  {
    name: 'JSON Files',
    extensions: ['json']
  },
  {
    name: 'All Supported Text Files',
    extensions: supportedTextExtensions
  }
];

export function getFileExtension(pathOrName: string | null | undefined): string {
  if (!pathOrName) return '';
  const fileName = pathOrName.split(/[?#]/)[0].split(/[/\\]/).pop() || pathOrName;
  const match = fileName.toLowerCase().match(/\.([^.]+)$/);
  return match?.[1] || '';
}

export function getDocumentFormatForPath(pathOrName: string | null | undefined): DocumentFormat {
  const extension = getFileExtension(pathOrName);
  return documentFormats.find((format) => format.extensions.includes(extension)) || plainTextFormat;
}

export function looksLikeJsonContent(content: string): boolean {
  const firstChar = content.trimStart()[0];
  return firstChar === '{' || firstChar === '[';
}

export function getDocumentFormatForContent(
  content: string,
  pathOrName: string | null | undefined
): DocumentFormat {
  const namedFormat = getDocumentFormatForPath(pathOrName);
  return namedFormat.id === 'plain' && looksLikeJsonContent(content) ? jsonFormat : namedFormat;
}

export function getSuggestedFileExtensionForContent(content: string): string {
  return looksLikeJsonContent(content) ? jsonFormat.defaultExtension : plainTextFormat.defaultExtension;
}

function getIndentInfo(lineText: string, tabSize: number) {
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

function annotateTokenOffsets(tokens: Token[], lineStartOffset: number) {
  let cursorOffset = 0;

  const visit = (token: Token) => {
    if (token.children && token.children.length > 0) {
      token.children.forEach(visit);
      return;
    }

    const text = token.text || '';
    if (token.type === 'color') {
      token.start = lineStartOffset + cursorOffset;
      token.end = token.start + text.length;
    }
    cursorOffset += text.length;
  };

  tokens.forEach(visit);
}

function parsePlainLine(
  lineText: string,
  id: number,
  tabSize: number,
  comments: CommentSyntax | null,
  state: TokenizeState | null,
  lineStartOffset: number
): { line: ParsedLine; state: TokenizeState | null } {
  const indentInfo = getIndentInfo(lineText, tabSize);
  const tokenized = tokenizeLineWithState(lineText, { comments, state });
  annotateTokenOffsets(tokenized.tokens, lineStartOffset);

  return {
    line: {
      id,
      ...indentInfo,
      tokens: tokenized.tokens
    },
    state: tokenized.state
  };
}

function normalizeLineRange(lineCount: number, lineRange?: DocumentLineRange): DocumentLineRange {
  if (lineCount <= 0) return { startLine: 0, endLine: 0 };

  const startLine = Math.max(0, Math.min(lineRange?.startLine ?? 0, lineCount - 1));
  const endLine = Math.max(startLine, Math.min(lineRange?.endLine ?? lineCount - 1, lineCount - 1));

  return { startLine, endLine };
}

function getLineRangeOffsets(
  content: string,
  lineStartOffsets: number[],
  lineRange: DocumentLineRange
): { start: number; end: number } {
  return {
    start: lineStartOffsets[lineRange.startLine] ?? 0,
    end: lineStartOffsets[lineRange.endLine + 1] ?? content.length
  };
}

function getLineText(content: string, lineStartOffsets: number[], lineIndex: number): string {
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

function getLineContentEndOffset(content: string, lineStartOffsets: number[], lineIndex: number): number {
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

function parsePlainLines(
  content: string,
  tabSize: number,
  comments: CommentSyntax | null,
  lineStartOffsets: number[],
  lineRange: DocumentLineRange
): ParsedLine[] {
  let state: TokenizeState | null = null;
  const parsedLines: ParsedLine[] = [];

  for (let idx = 0; idx <= lineRange.endLine; idx++) {
    const lineText = getLineText(content, lineStartOffsets, idx);
    const parsed = parsePlainLine(lineText, idx, tabSize, comments, state, lineStartOffsets[idx] ?? 0);
    state = parsed.state;
    if (idx >= lineRange.startLine) {
      parsedLines.push(parsed.line);
    }
  }

  return parsedLines;
}

function isJsonLiteralBoundary(char: string | undefined): boolean {
  return !char
    || char === ' '
    || char === '\t'
    || char === '\r'
    || char === '\n'
    || char === ','
    || char === ']'
    || char === '}'
    || char === ':';
}

function isJsonWhitespaceChar(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\r' || char === '\n';
}

function readJsonStringToken(content: string, start: number): FlatToken {
  let i = start + 1;

  while (i < content.length) {
    const char = content[i];
    if (char === '\r' || char === '\n') break;
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === '"') {
      i += 1;
      return { type: 'string', text: content.slice(start, i), start, end: i };
    }
    i += 1;
  }

  return { type: 'invalid', text: content.slice(start, i), start, end: i };
}

function readJsonNumberToken(content: string, start: number): FlatToken {
  let i = start;

  if (content[i] === '-') i += 1;

  if (content[i] === '0') {
    i += 1;
  } else if (content[i] && content[i] >= '1' && content[i] <= '9') {
    i += 1;
    while (content[i] && content[i] >= '0' && content[i] <= '9') i += 1;
  } else {
    return { type: 'invalid', text: content[start], start, end: start + 1 };
  }

  if (content[i] === '.') {
    const decimalStart = i;
    i += 1;
    const digitStart = i;
    while (content[i] && content[i] >= '0' && content[i] <= '9') i += 1;
    if (digitStart === i) {
      return { type: 'invalid', text: content.slice(start, decimalStart + 1), start, end: decimalStart + 1 };
    }
  }

  if (content[i] === 'e' || content[i] === 'E') {
    const exponentStart = i;
    i += 1;
    if (content[i] === '+' || content[i] === '-') i += 1;
    const digitStart = i;
    while (content[i] && content[i] >= '0' && content[i] <= '9') i += 1;
    if (digitStart === i) {
      return { type: 'invalid', text: content.slice(start, exponentStart + 1), start, end: exponentStart + 1 };
    }
  }

  return { type: 'number', text: content.slice(start, i), start, end: i };
}

function readJsonLiteralToken(content: string, start: number): FlatToken | null {
  for (const literal of ['true', 'false', 'null']) {
    if (content.startsWith(literal, start) && isJsonLiteralBoundary(content[start + literal.length])) {
      const end = start + literal.length;
      return {
        type: literal === 'null' ? 'literal' : 'boolean',
        text: content.slice(start, end),
        start,
        end
      };
    }
  }

  return null;
}

function shouldKeepToken(token: FlatToken, range?: { start: number; end: number }): boolean {
  return !range || (token.end > range.start && token.start < range.end);
}

function findNextNonJsonWhitespace(content: string, start: number): number {
  let i = start;
  while (i < content.length && isJsonWhitespaceChar(content[i])) i += 1;
  return i;
}

function scanJsonTokens(content: string, range?: { start: number; end: number }): FlatToken[] {
  const tokens: FlatToken[] = [];
  let i = range ? Math.max(0, Math.min(range.start, content.length)) : 0;
  const scanEnd = range ? Math.min(range.end, content.length) : content.length;

  while (i < scanEnd) {
    const char = content[i];

    if (isJsonWhitespaceChar(char)) {
      const start = i;
      i += 1;
      while (i < scanEnd && isJsonWhitespaceChar(content[i])) i += 1;
      const token = { type: 'text', text: content.slice(start, i), start, end: i } satisfies FlatToken;
      if (shouldKeepToken(token, range)) tokens.push(token);
      continue;
    }

    if (char === '"') {
      const token = readJsonStringToken(content, i);
      if (token.type === 'string' && content[findNextNonJsonWhitespace(content, token.end)] === ':') {
        token.type = 'key';
      }
      if (shouldKeepToken(token, range)) tokens.push(token);
      i = token.end;
      continue;
    }

    if (char === '-' || /\d/u.test(char)) {
      const token = readJsonNumberToken(content, i);
      if (shouldKeepToken(token, range)) tokens.push(token);
      i = token.end;
      continue;
    }

    const literalToken = readJsonLiteralToken(content, i);
    if (literalToken) {
      if (shouldKeepToken(literalToken, range)) tokens.push(literalToken);
      i = literalToken.end;
      continue;
    }

    if (char === '{' || char === '[') {
      const type = char === '{' ? 'brace' : 'bracket';
      const token = { type, text: char, start: i, end: i + 1 } satisfies FlatToken;
      if (shouldKeepToken(token, range)) tokens.push(token);
      i += 1;
      continue;
    }

    if (char === '}' || char === ']') {
      const expected = char === '}' ? 'brace' : 'bracket';
      const token = { type: expected, text: char, start: i, end: i + 1 } satisfies FlatToken;
      if (shouldKeepToken(token, range)) tokens.push(token);
      i += 1;
      continue;
    }

    if (char === ':' || char === ',') {
      const token = { type: 'punctuation', text: char, start: i, end: i + 1 } satisfies FlatToken;
      if (shouldKeepToken(token, range)) tokens.push(token);
      i += 1;
      continue;
    }

    const token = { type: 'invalid', text: char, start: i, end: i + 1 } satisfies FlatToken;
    if (shouldKeepToken(token, range)) tokens.push(token);
    i += 1;
  }

  return tokens;
}

function inferIndentUnit(content: string, lineStartOffsets: number[], tabSize: number): number {
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

function getJsonLineDepth(line: ParsedLine, indentUnit: number): number {
  if (line.indentColumns <= 0 || indentUnit <= 0) return 0;
  return Math.max(Math.floor(line.indentColumns / indentUnit) - 1, 0);
}

function getJsonRenderDepth(token: FlatToken, line: ParsedLine, indentUnit: number): number | undefined {
  if (token.type === 'key') {
    return getJsonLineDepth(line, indentUnit);
  }

  if (token.type === 'brace' || token.type === 'bracket') {
    return Math.max(getJsonLineDepth(line, indentUnit), 0);
  }

  return token.depth;
}

function findLineIndexForOffset(lineStartOffsets: number[], offset: number): number {
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

function splitFlatTokensIntoLines(
  content: string,
  flatTokens: FlatToken[],
  tabSize: number,
  lineStartOffsets: number[],
  lineRange: DocumentLineRange
): ParsedLine[] {
  const lineRangeOffsets = getLineRangeOffsets(content, lineStartOffsets, lineRange);
  const lines: ParsedLine[] = [];
  const jsonIndentUnit = inferIndentUnit(content, lineStartOffsets, tabSize);

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
      const lineStart = lineStartOffsets[lineIndex] ?? 0;
      const lineEnd = getLineContentEndOffset(content, lineStartOffsets, lineIndex);
      const segmentEnd = Math.min(tokenEnd, lineEnd);
      const outputLine = lines[lineIndex - lineRange.startLine];

      if (outputLine && segmentEnd > start) {
        outputLine.tokens.push({
          type: token.type,
          text: content.slice(start, segmentEnd),
          depth: getJsonRenderDepth(token, outputLine, jsonIndentUnit),
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

function offsetToLineColumn(content: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const safeOffset = Math.max(0, Math.min(offset, content.length));

  for (let i = 0; i < safeOffset; i++) {
    if (content[i] === '\n') {
      line += 1;
      lineStart = i + 1;
    }
  }

  return { line, column: safeOffset - lineStart + 1 };
}

function offsetFromLineColumn(content: string, line: number, column: number): number {
  let currentLine = 1;
  let lineStart = 0;

  for (let i = 0; i < content.length && currentLine < line; i++) {
    if (content[i] === '\n') {
      currentLine += 1;
      lineStart = i + 1;
    }
  }

  return Math.max(0, Math.min(content.length, lineStart + column - 1));
}

function getJsonErrorOffset(content: string, message: string): number {
  const lineColumnMatch = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (lineColumnMatch) {
    return offsetFromLineColumn(content, Number(lineColumnMatch[1]), Number(lineColumnMatch[2]));
  }

  const positionMatch = message.match(/position\s+(\d+)/i);
  if (positionMatch) {
    return Math.max(0, Math.min(content.length, Number(positionMatch[1])));
  }

  const invalidToken = scanJsonTokens(content).find((token) => token.type === 'invalid');
  return invalidToken?.start ?? 0;
}

function getJsonDiagnostic(content: string): DocumentDiagnostic | null {
  if (content.trim().length === 0) {
    return {
      severity: 'error',
      message: 'JSON 문서가 비어 있습니다.',
      line: 1,
      column: 1,
      offset: 0
    };
  }

  try {
    JSON.parse(content);
    return null;
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    const offset = getJsonErrorOffset(content, rawMessage);
    const position = offsetToLineColumn(content, offset);

    return {
      severity: 'error',
      message: `JSON 문법 오류가 있습니다. ${position.line}행 ${position.column}열을 확인하세요.`,
      line: position.line,
      column: position.column,
      offset
    };
  }
}

export function getDocumentDiagnostic(
  content: string,
  options: Pick<ParseDocumentOptions, 'pathOrName'>
): DocumentDiagnostic | null {
  const format = getDocumentFormatForContent(content, options.pathOrName);
  if (format.id === 'json') return getJsonDiagnostic(content);
  return null;
}

export function parseDocumentForRender(content: string, options: ParseDocumentOptions): DocumentRenderResult {
  const format = getDocumentFormatForContent(content, options.pathOrName);
  const lineRange = normalizeLineRange(options.lineStartOffsets.length, options.lineRange);
  const lineRangeOffsets = getLineRangeOffsets(content, options.lineStartOffsets, lineRange);

  if (format.id === 'json') {
    return {
      format,
      lines: splitFlatTokensIntoLines(
        content,
        scanJsonTokens(content, lineRangeOffsets),
        options.tabSize,
        options.lineStartOffsets,
        lineRange
      ),
      diagnostic: null
    };
  }

  return {
    format,
    lines: parsePlainLines(
      content,
      options.tabSize,
      getCommentSyntaxForPath(options.pathOrName),
      options.lineStartOffsets,
      lineRange
    ),
    diagnostic: null
  };
}
