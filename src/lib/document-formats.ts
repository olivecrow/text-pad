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

interface ParseDocumentOptions {
  pathOrName: string | null | undefined;
  tabSize: number;
  lineStartOffsets: number[];
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

function parsePlainLines(
  content: string,
  tabSize: number,
  comments: CommentSyntax | null,
  lineStartOffsets: number[]
): ParsedLine[] {
  const lines = content.split(/\r?\n/);
  let state: TokenizeState | null = null;

  return lines.map((lineText, idx) => {
    const parsed = parsePlainLine(lineText, idx, tabSize, comments, state, lineStartOffsets[idx] ?? 0);
    state = parsed.state;
    return parsed.line;
  });
}

function isJsonLiteralBoundary(char: string | undefined): boolean {
  return !char || /[\s,\]}:]/u.test(char);
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
  const match = content.slice(start).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
  if (!match) {
    return { type: 'invalid', text: content[start], start, end: start + 1 };
  }

  const end = start + match[0].length;
  return { type: 'number', text: content.slice(start, end), start, end };
}

function readJsonLiteralToken(content: string, start: number): FlatToken | null {
  for (const literal of ['true', 'false', 'null']) {
    if (content.startsWith(literal, start) && isJsonLiteralBoundary(content[start + literal.length])) {
      const end = start + literal.length;
      return { type: 'literal', text: content.slice(start, end), start, end };
    }
  }

  return null;
}

function scanJsonTokens(content: string): FlatToken[] {
  const tokens: FlatToken[] = [];
  const stack: Array<'brace' | 'bracket'> = [];
  let i = 0;

  while (i < content.length) {
    const char = content[i];

    if (/\s/u.test(char)) {
      const start = i;
      i += 1;
      while (i < content.length && /\s/u.test(content[i])) i += 1;
      tokens.push({ type: 'text', text: content.slice(start, i), start, end: i });
      continue;
    }

    if (char === '"') {
      const token = readJsonStringToken(content, i);
      tokens.push(token);
      i = token.end;
      continue;
    }

    if (char === '-' || /\d/u.test(char)) {
      const token = readJsonNumberToken(content, i);
      tokens.push(token);
      i = token.end;
      continue;
    }

    const literalToken = readJsonLiteralToken(content, i);
    if (literalToken) {
      tokens.push(literalToken);
      i = literalToken.end;
      continue;
    }

    if (char === '{' || char === '[') {
      const type = char === '{' ? 'brace' : 'bracket';
      tokens.push({ type, text: char, start: i, end: i + 1, depth: stack.length });
      stack.push(type);
      i += 1;
      continue;
    }

    if (char === '}' || char === ']') {
      const expected = char === '}' ? 'brace' : 'bracket';
      const depth = Math.max(stack.length - 1, 0);
      if (stack[stack.length - 1] === expected) stack.pop();
      tokens.push({ type: expected, text: char, start: i, end: i + 1, depth });
      i += 1;
      continue;
    }

    if (char === ':' || char === ',') {
      tokens.push({ type: 'punctuation', text: char, start: i, end: i + 1 });
      i += 1;
      continue;
    }

    tokens.push({ type: 'invalid', text: char, start: i, end: i + 1 });
    i += 1;
  }

  classifyJsonKeys(tokens);
  return tokens;
}

function classifyJsonKeys(tokens: FlatToken[]) {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'string') continue;

    let nextIndex = i + 1;
    while (tokens[nextIndex]?.type === 'text') nextIndex += 1;

    if (tokens[nextIndex]?.type === 'punctuation' && tokens[nextIndex].text === ':') {
      token.type = 'key';
    }
  }
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

function splitFlatTokensIntoLines(content: string, flatTokens: FlatToken[], tabSize: number, lineStartOffsets: number[]): ParsedLine[] {
  const rawLines = content.split(/\r?\n/);
  const lines = rawLines.map((lineText, id) => ({
    id,
    ...getIndentInfo(lineText, tabSize),
    tokens: [] as Token[]
  }));

  for (const token of flatTokens) {
    let start = token.start;

    while (start < token.end) {
      const lineIndex = findLineIndexForOffset(lineStartOffsets, start);
      const lineStart = lineStartOffsets[lineIndex] ?? 0;
      const lineEnd = lineStart + (rawLines[lineIndex]?.length ?? 0);
      const segmentEnd = Math.min(token.end, lineEnd);

      if (segmentEnd > start) {
        lines[lineIndex]?.tokens.push({
          type: token.type,
          text: content.slice(start, segmentEnd),
          depth: token.depth,
          start,
          end: segmentEnd
        });
        start = segmentEnd;
      } else {
        start = lineStartOffsets[lineIndex + 1] ?? token.end;
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

export function parseDocumentForRender(content: string, options: ParseDocumentOptions): DocumentRenderResult {
  const namedFormat = getDocumentFormatForPath(options.pathOrName);
  const format = namedFormat.id === 'plain' && looksLikeJsonContent(content) ? jsonFormat : namedFormat;

  if (format.id === 'json') {
    return {
      format,
      lines: splitFlatTokensIntoLines(content, scanJsonTokens(content), options.tabSize, options.lineStartOffsets),
      diagnostic: getJsonDiagnostic(content)
    };
  }

  return {
    format,
    lines: parsePlainLines(content, options.tabSize, getCommentSyntaxForPath(options.pathOrName), options.lineStartOffsets),
    diagnostic: null
  };
}
