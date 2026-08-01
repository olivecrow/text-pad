import { getListMarkerAtStart } from './list-markers';
import {
  tokenizeLineWithState,
  type CommentSyntax,
  type Token,
  type TokenizeState
} from './render-tokenizer';
import {
  getIndentInfo,
  getLineText,
  type DocumentLineRange,
  type ParsedLine
} from './structured-rendering';
import type { MarkdownHeadingLevel } from './markdown-settings';

export type LineOrientedFormatId =
  | 'markdown'
  | 'ini'
  | 'conf'
  | 'properties'
  | 'dotenv'
  | 'log'
  | 'srt'
  | 'webvtt'
  | 'lrc';

export interface LineFormatDiagnosticPosition {
  line: number;
  column: number;
  offset: number;
}

interface ParseLineOrientedFormatOptions {
  tabSize: number;
  lineStartOffsets: number[];
  lineRange: DocumentLineRange;
  hideMarkdownHeadingMarkers: boolean;
  commentSyntax?: CommentSyntax | null;
}

const iniCommentSyntax: CommentSyntax = {
  line: [{ marker: ';', anchored: true }, { marker: '#', anchored: true }]
};
const hashCommentSyntax: CommentSyntax = { line: [{ marker: '#', anchored: true }] };
const propertiesCommentSyntax: CommentSyntax = {
  line: [{ marker: '#', anchored: true }, { marker: '!', anchored: true }]
};

function createToken(type: Token['type'], text: string, start: number, hiddenSyntax = false): Token {
  return {
    type,
    text,
    start,
    end: start + text.length,
    hiddenSyntax: hiddenSyntax || undefined
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
    token.start = lineStartOffset + cursorOffset;
    token.end = token.start + text.length;
    cursorOffset += text.length;
  };

  tokens.forEach(visit);
}

export function getMarkdownHeadingLevel(line: string): MarkdownHeadingLevel | null {
  const match = line.match(/^[ \t]{0,3}(#{1,6})[ \t]+/u);
  return match?.[1]?.length as MarkdownHeadingLevel | undefined ?? null;
}

function tokenizeMarkdownInline(text: string, absoluteStart: number): Token[] {
  const tokens: Token[] = [];
  const pattern = /(\[[^\]\r\n]+\]\([^)\r\n]+\)|\*\*[^*\r\n]+\*\*|__[^_\r\n]+__|\x60[^\x60\r\n]+\x60|\*[^*\r\n]+\*|_[^_\r\n]+_)/gu;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      tokens.push(createToken('text', text.slice(cursor, match.index), absoluteStart + cursor));
    }
    const matchedText = match[0];
    const type: Token['type'] = matchedText.startsWith('[')
      ? 'link'
      : matchedText.startsWith('**') || matchedText.startsWith('__')
        ? 'strong'
        : matchedText.charCodeAt(0) === 96
          ? 'code'
          : 'emphasis';
    tokens.push(createToken(type, matchedText, absoluteStart + match.index));
    cursor = match.index + matchedText.length;
  }

  if (cursor < text.length) {
    tokens.push(createToken('text', text.slice(cursor), absoluteStart + cursor));
  }
  return tokens;
}

function parseMarkdownTextLine(line: string, lineStartOffset: number): Token[] {
  const quoteMatch = line.match(/^([ \t]{0,3})(>[ \t]?)(.*)$/u);
  if (quoteMatch) {
    const indent = quoteMatch[1] || '';
    const marker = quoteMatch[2] || '';
    const body = quoteMatch[3] || '';
    return [
      ...(indent ? [createToken('text', indent, lineStartOffset)] : []),
      createToken('quote-marker', marker, lineStartOffset + indent.length),
      ...tokenizeMarkdownInline(body, lineStartOffset + indent.length + marker.length)
    ];
  }

  const listMarker = getListMarkerAtStart(line);
  if (listMarker) {
    const bodyStart = listMarker.indent.length + listMarker.marker.length;
    return [
      ...(listMarker.indent ? [createToken('text', listMarker.indent, lineStartOffset)] : []),
      createToken('list-marker', listMarker.marker, lineStartOffset + listMarker.indent.length),
      ...tokenizeMarkdownInline(line.slice(bodyStart), lineStartOffset + bodyStart)
    ];
  }

  return tokenizeMarkdownInline(line, lineStartOffset);
}

function parseMarkdownHeading(
  line: string,
  lineStartOffset: number,
  hideMarker: boolean
): { tokens: Token[]; headingLevel: MarkdownHeadingLevel } | null {
  const match = line.match(/^([ \t]{0,3})(#{1,6})([ \t]+)(.*)$/u);
  const hashes = match?.[2];
  if (!match || !hashes) return null;

  const indent = match[1] || '';
  const spacing = match[3] || '';
  const body = match[4] || '';
  const marker = `${hashes}${spacing}`;
  const bodyStart = lineStartOffset + indent.length + marker.length;
  const tokens: Token[] = [];
  if (indent) tokens.push(createToken('text', indent, lineStartOffset));
  tokens.push(createToken('heading-marker', marker, lineStartOffset + indent.length, hideMarker));
  tokens.push(...tokenizeMarkdownInline(body, bodyStart));

  return { tokens, headingLevel: hashes.length as MarkdownHeadingLevel };
}

function findUnquotedCommentStart(value: string, markers: string[]): number {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (markers.includes(char) && (index === 0 || /\s/u.test(value[index - 1] || ''))) return index;
  }
  return -1;
}

function tokenizeConfigValue(value: string, absoluteStart: number, commentMarkers: string[]): Token[] {
  const commentStart = findUnquotedCommentStart(value, commentMarkers);
  const valueText = commentStart === -1 ? value : value.slice(0, commentStart);
  const commentText = commentStart === -1 ? '' : value.slice(commentStart);
  const tokens: Token[] = [];
  const matcher = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:true|false|null|yes|no|on|off)\b|[-+]?\b\d+(?:\.\d+)?\b)/giu;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(valueText)) !== null) {
    if (match.index > cursor) {
      tokens.push(createToken('text', valueText.slice(cursor, match.index), absoluteStart + cursor));
    }
    const text = match[0];
    const normalized = text.toLowerCase();
    const type: Token['type'] = text.startsWith('"') || text.startsWith("'")
      ? 'string'
      : normalized === 'true' || normalized === 'false'
        ? 'boolean'
        : normalized === 'null' || normalized === 'yes' || normalized === 'no' || normalized === 'on' || normalized === 'off'
          ? 'literal'
          : 'number';
    tokens.push(createToken(type, text, absoluteStart + match.index));
    cursor = match.index + text.length;
  }

  if (cursor < valueText.length) {
    tokens.push(createToken('text', valueText.slice(cursor), absoluteStart + cursor));
  }
  if (commentText) {
    tokens.push(createToken('comment', commentText, absoluteStart + commentStart));
  }
  return tokens;
}

function parseConfigLine(line: string, lineStartOffset: number, format: LineOrientedFormatId): Token[] {
  const leading = line.match(/^[ \t]*/u)?.[0] || '';
  const trimmed = line.slice(leading.length);
  const commentMarkers = format === 'properties' ? ['#', '!'] : format === 'dotenv' ? ['#'] : ['#', ';'];
  if (!trimmed) return leading ? [createToken('text', leading, lineStartOffset)] : [];
  if (commentMarkers.some((marker) => trimmed.startsWith(marker))) {
    return [
      ...(leading ? [createToken('text', leading, lineStartOffset)] : []),
      createToken('comment', trimmed, lineStartOffset + leading.length)
    ];
  }

  if ((format === 'ini' || format === 'conf') && /^\[[^\]]+\]/u.test(trimmed)) {
    const closeIndex = trimmed.indexOf(']');
    return [
      ...(leading ? [createToken('text', leading, lineStartOffset)] : []),
      createToken('punctuation', '[', lineStartOffset + leading.length),
      createToken('section', trimmed.slice(1, closeIndex), lineStartOffset + leading.length + 1),
      createToken('punctuation', ']', lineStartOffset + leading.length + closeIndex),
      ...tokenizeConfigValue(
        trimmed.slice(closeIndex + 1),
        lineStartOffset + leading.length + closeIndex + 1,
        commentMarkers
      )
    ];
  }

  const exportPrefix = format === 'dotenv' ? trimmed.match(/^export[ \t]+/u)?.[0] || '' : '';
  const assignmentText = trimmed.slice(exportPrefix.length);
  const separatorMatch = assignmentText.match(format === 'properties' ? /[:=]|[ \t]+/u : /[=:]/u);
  if (!separatorMatch || separatorMatch.index === undefined) {
    const tokens = tokenizeLineWithState(line, {
      comments: format === 'properties' ? propertiesCommentSyntax : format === 'dotenv' ? hashCommentSyntax : iniCommentSyntax
    }).tokens;
    annotateTokenOffsets(tokens, lineStartOffset);
    return tokens;
  }

  const separatorIndex = separatorMatch.index;
  const separator = separatorMatch[0];
  const tokens: Token[] = [];
  if (leading) tokens.push(createToken('text', leading, lineStartOffset));
  if (exportPrefix) tokens.push(createToken('keyword', exportPrefix, lineStartOffset + leading.length));
  const assignmentStart = lineStartOffset + leading.length + exportPrefix.length;
  tokens.push(createToken('key', assignmentText.slice(0, separatorIndex), assignmentStart));
  tokens.push(createToken('operator', separator, assignmentStart + separatorIndex));
  tokens.push(...tokenizeConfigValue(
    assignmentText.slice(separatorIndex + separator.length),
    assignmentStart + separatorIndex + separator.length,
    commentMarkers
  ));
  return tokens;
}

function parseLogLine(line: string, lineStartOffset: number): Token[] | null {
  const match = line.match(/^(\[?(?:\d{4}-\d{2}-\d{2}[T ][0-9:.+\-Z]+|\d{2}:\d{2}:\d{2}(?:\.\d+)?)\]?)(\s+)(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)(\b.*)$/iu);
  if (!match) return null;
  const timestamp = match[1] || '';
  const spacing = match[2] || '';
  const level = match[3] || '';
  const rest = match[4] || '';
  return [
    createToken('timestamp', timestamp, lineStartOffset),
    createToken('text', spacing, lineStartOffset + timestamp.length),
    createToken('keyword', level, lineStartOffset + timestamp.length + spacing.length),
    createToken('text', rest, lineStartOffset + timestamp.length + spacing.length + level.length)
  ];
}

const srtTimestamp = String.raw`\d{2}:\d{2}:\d{2},\d{3}`;
const vttTimestamp = String.raw`(?:\d{2}:)?\d{2}:\d{2}\.\d{3}`;

function parseSubtitleLine(line: string, lineStartOffset: number, format: LineOrientedFormatId): Token[] | null {
  if (format === 'srt' && /^\d+$/u.test(line.trim())) {
    const leading = line.indexOf(line.trim());
    return [
      ...(leading > 0 ? [createToken('text', line.slice(0, leading), lineStartOffset)] : []),
      createToken('number', line.trim(), lineStartOffset + leading)
    ];
  }

  const timestampPattern = format === 'srt' ? srtTimestamp : vttTimestamp;
  const timingMatch = line.match(new RegExp(`^([ \\t]*)(${timestampPattern})([ \\t]+-->[ \\t]+)(${timestampPattern})(.*)$`, 'u'));
  if (timingMatch) {
    const leading = timingMatch[1] || '';
    const start = timingMatch[2] || '';
    const arrow = timingMatch[3] || '';
    const end = timingMatch[4] || '';
    const settings = timingMatch[5] || '';
    const startOffset = lineStartOffset + leading.length;
    return [
      ...(leading ? [createToken('text', leading, lineStartOffset)] : []),
      createToken('timestamp', start, startOffset),
      createToken('operator', arrow, startOffset + start.length),
      createToken('timestamp', end, startOffset + start.length + arrow.length),
      createToken('comment', settings, startOffset + start.length + arrow.length + end.length)
    ];
  }

  if (format === 'webvtt' && /^(WEBVTT|NOTE|STYLE|REGION)\b/u.test(line)) {
    const keyword = line.match(/^\S+/u)?.[0] || line;
    return [
      createToken('keyword', keyword, lineStartOffset),
      ...(line.length > keyword.length ? [createToken('text', line.slice(keyword.length), lineStartOffset + keyword.length)] : [])
    ];
  }

  if (format === 'lrc') {
    const tokens: Token[] = [];
    const tagMatcher = /\[(?:(?:\d{1,3}:)?\d{2}(?:[.:]\d{1,3})?|[a-z][a-z0-9-]*:[^\]]*)\]/giu;
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = tagMatcher.exec(line)) !== null && match.index === cursor) {
      const tag = match[0];
      const colon = tag.indexOf(':');
      if (/^\[\d/u.test(tag)) {
        tokens.push(createToken('timestamp', tag, lineStartOffset + cursor));
      } else if (colon > 1) {
        tokens.push(createToken('punctuation', '[', lineStartOffset + cursor));
        tokens.push(createToken('key', tag.slice(1, colon), lineStartOffset + cursor + 1));
        tokens.push(createToken('operator', ':', lineStartOffset + cursor + colon));
        tokens.push(createToken('string', tag.slice(colon + 1, -1), lineStartOffset + cursor + colon + 1));
        tokens.push(createToken('punctuation', ']', lineStartOffset + cursor + tag.length - 1));
      }
      cursor += tag.length;
    }
    if (tokens.length > 0) {
      if (cursor < line.length) tokens.push(createToken('text', line.slice(cursor), lineStartOffset + cursor));
      return tokens;
    }
  }

  return null;
}

export function parseLineOrientedFormat(
  content: string,
  format: LineOrientedFormatId,
  options: ParseLineOrientedFormatOptions
): ParsedLine[] {
  let state: TokenizeState | null = null;
  const parsedLines: ParsedLine[] = [];

  for (let lineIndex = 0; lineIndex <= options.lineRange.endLine; lineIndex += 1) {
    const lineText = getLineText(content, options.lineStartOffsets, lineIndex);
    const lineStartOffset = options.lineStartOffsets[lineIndex] ?? 0;
    let tokens: Token[];
    let headingLevel: MarkdownHeadingLevel | undefined;
    let fencedCodePosition;

    if (format === 'markdown') {
      const heading = state
        ? null
        : parseMarkdownHeading(lineText, lineStartOffset, options.hideMarkdownHeadingMarkers);
      if (heading) {
        tokens = heading.tokens;
        headingLevel = heading.headingLevel;
      } else if (state || /^[ \t]*\x60{3,}/u.test(lineText) || lineText.includes('<!--')) {
        const tokenized = tokenizeLineWithState(lineText, { comments: options.commentSyntax, state });
        tokens = tokenized.tokens;
        state = tokenized.state;
        fencedCodePosition = tokenized.fencedCodePosition;
        annotateTokenOffsets(tokens, lineStartOffset);
      } else {
        tokens = parseMarkdownTextLine(lineText, lineStartOffset);
      }
    } else if (format === 'ini' || format === 'conf' || format === 'properties' || format === 'dotenv') {
      tokens = parseConfigLine(lineText, lineStartOffset, format);
    } else if (format === 'log') {
      const logTokens = parseLogLine(lineText, lineStartOffset);
      if (logTokens) {
        tokens = logTokens;
      } else {
        const tokenized = tokenizeLineWithState(lineText, { state });
        tokens = tokenized.tokens;
        state = tokenized.state;
        fencedCodePosition = tokenized.fencedCodePosition;
        annotateTokenOffsets(tokens, lineStartOffset);
      }
    } else if (format === 'srt' || format === 'webvtt' || format === 'lrc') {
      const subtitleTokens = parseSubtitleLine(lineText, lineStartOffset, format);
      if (subtitleTokens) {
        tokens = subtitleTokens;
      } else {
        const tokenized = tokenizeLineWithState(lineText, { state });
        tokens = tokenized.tokens;
        state = tokenized.state;
        fencedCodePosition = tokenized.fencedCodePosition;
        annotateTokenOffsets(tokens, lineStartOffset);
      }
    } else {
      const tokenized = tokenizeLineWithState(lineText, { comments: options.commentSyntax, state });
      tokens = tokenized.tokens;
      state = tokenized.state;
      fencedCodePosition = tokenized.fencedCodePosition;
      annotateTokenOffsets(tokens, lineStartOffset);
    }

    if (lineIndex >= options.lineRange.startLine) {
      parsedLines.push({
        id: lineIndex,
        ...getIndentInfo(lineText, options.tabSize),
        tokens,
        headingLevel,
        fencedCodePosition
      });
    }
  }

  return parsedLines;
}

function getLineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function diagnosticAt(lineStarts: number[], lineIndex: number, columnIndex = 0): LineFormatDiagnosticPosition {
  return {
    line: lineIndex + 1,
    column: columnIndex + 1,
    offset: (lineStarts[lineIndex] ?? 0) + columnIndex
  };
}

function hasUnclosedQuote(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"') && !trimmed.startsWith("'")) return false;
  const quote = trimmed[0];
  let escaped = false;
  for (let index = 1; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (escaped) {
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === quote) {
      return false;
    }
  }
  return true;
}

function getIniDiagnostic(lines: string[], starts: number[]): LineFormatDiagnosticPosition | null {
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = (lines[index] || '').trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[')) {
      if (!/^\[[^\]\r\n]+\](?:\s*[;#].*)?$/u.test(trimmed)) return diagnosticAt(starts, index);
      continue;
    }
    if (!/^[^=:#\s][^=:]*[=:]/u.test(trimmed)) return diagnosticAt(starts, index);
  }
  return null;
}

function getPropertiesDiagnostic(lines: string[], starts: number[]): LineFormatDiagnosticPosition | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || '';
    const invalidEscape = line.search(/\\u(?![0-9a-fA-F]{4})/u);
    if (invalidEscape !== -1) return diagnosticAt(starts, index, invalidEscape);
  }
  return null;
}

function getDotenvDiagnostic(lines: string[], starts: number[]): LineFormatDiagnosticPosition | null {
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = (lines[index] || '').trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=(.*)$/u);
    if (!match) return diagnosticAt(starts, index);
    if (hasUnclosedQuote(match[1] || '')) {
      return diagnosticAt(starts, index, Math.max(0, (lines[index] || '').indexOf(match[1] || '')));
    }
  }
  return null;
}

function subtitleTimestampToMilliseconds(value: string, decimalMarker: ',' | '.'): number | null {
  const parts = value.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const secondParts = (parts.pop() || '').split(decimalMarker);
  if (secondParts.length !== 2) return null;
  const seconds = Number(secondParts[0]);
  const milliseconds = Number((secondParts[1] || '').padEnd(3, '0').slice(0, 3));
  const minutes = Number(parts.pop());
  const hours = parts.length > 0 ? Number(parts.pop()) : 0;
  if (![seconds, milliseconds, minutes, hours].every(Number.isFinite) || seconds >= 60 || minutes >= 60) return null;
  return (((hours * 60) + minutes) * 60 + seconds) * 1000 + milliseconds;
}

function validateSubtitleTimingLine(line: string, format: 'srt' | 'webvtt'): boolean {
  const timestampPattern = format === 'srt' ? srtTimestamp : vttTimestamp;
  const match = line.match(new RegExp(`^(${timestampPattern})[ \\t]+-->[ \\t]+(${timestampPattern})(?:[ \\t]+.*)?$`, 'u'));
  if (!match?.[1] || !match[2]) return false;
  const marker = format === 'srt' ? ',' : '.';
  const start = subtitleTimestampToMilliseconds(match[1], marker);
  const end = subtitleTimestampToMilliseconds(match[2], marker);
  return start !== null && end !== null && end > start;
}

function getSrtDiagnostic(lines: string[], starts: number[]): LineFormatDiagnosticPosition | null {
  let index = 0;
  while (index < lines.length) {
    while (index < lines.length && !(lines[index] || '').trim()) index += 1;
    if (index >= lines.length) break;
    if (/^\d+$/u.test((lines[index] || '').trim())) index += 1;
    if (index >= lines.length || !validateSubtitleTimingLine((lines[index] || '').trim(), 'srt')) {
      return diagnosticAt(starts, Math.min(index, lines.length - 1));
    }
    index += 1;
    const textStart = index;
    while (index < lines.length && (lines[index] || '').trim()) index += 1;
    if (index === textStart) return diagnosticAt(starts, Math.max(0, index - 1));
  }
  return null;
}

function getWebVttDiagnostic(lines: string[], starts: number[]): LineFormatDiagnosticPosition | null {
  const firstLine = (lines[0] || '').replace(/^\uFEFF/u, '');
  if (!/^WEBVTT(?:[ \t].*)?$/u.test(firstLine)) return diagnosticAt(starts, 0);

  let index = 1;
  while (index < lines.length) {
    while (index < lines.length && !(lines[index] || '').trim()) index += 1;
    if (index >= lines.length) break;

    const current = (lines[index] || '').trim();
    if (/^(NOTE|STYLE|REGION)\b/u.test(current)) {
      index += 1;
      while (index < lines.length && (lines[index] || '').trim()) index += 1;
      continue;
    }

    let timingIndex = index;
    if (!current.includes('-->')) {
      timingIndex += 1;
    }
    const timingLine = (lines[timingIndex] || '').trim();
    if (!timingLine.includes('-->') || !validateSubtitleTimingLine(timingLine, 'webvtt')) {
      return diagnosticAt(starts, Math.min(timingIndex, lines.length - 1));
    }

    index = timingIndex + 1;
    const textStart = index;
    while (index < lines.length && (lines[index] || '').trim()) index += 1;
    if (index === textStart) return diagnosticAt(starts, timingIndex);
  }
  return null;
}

function getLrcDiagnostic(lines: string[], starts: number[]): LineFormatDiagnosticPosition | null {
  const validTag = /^(?:\[(?:(?:\d{1,3}:)?\d{2}(?:[.:]\d{1,3})?|[a-z][a-z0-9-]*:[^\]]*)\])+/iu;
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = (lines[index] || '').trim();
    if (trimmed.startsWith('[') && !validTag.test(trimmed)) return diagnosticAt(starts, index);
  }
  return null;
}

export function getLineOrientedFormatDiagnostic(
  content: string,
  format: LineOrientedFormatId
): LineFormatDiagnosticPosition | null {
  if (!content.trim()) return null;
  const lines = content.split(/\r?\n/u);
  const starts = getLineStarts(content);
  if (format === 'ini') return getIniDiagnostic(lines, starts);
  if (format === 'properties') return getPropertiesDiagnostic(lines, starts);
  if (format === 'dotenv') return getDotenvDiagnostic(lines, starts);
  if (format === 'srt') return getSrtDiagnostic(lines, starts);
  if (format === 'webvtt') return getWebVttDiagnostic(lines, starts);
  if (format === 'lrc') return getLrcDiagnostic(lines, starts);
  return null;
}
