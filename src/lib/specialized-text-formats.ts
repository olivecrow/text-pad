import type { Token } from './render-tokenizer';
import {
  getIndentInfo,
  getLineText,
  type DocumentLineRange,
  type ParsedLine
} from './structured-rendering';

export type SpecializedTextFormatId =
  | 'gettext'
  | 'registry'
  | 'sshconfig'
  | 'systemd'
  | 'gitmessage'
  | 'gitmailmap'
  | 'gitblame'
  | 'hosts';

export interface SpecializedDiagnosticPosition {
  line: number;
  column: number;
  offset: number;
}

interface ParseOptions {
  tabSize: number;
  lineStartOffsets: number[];
  lineRange: DocumentLineRange;
}

interface ParsedSpecialLine {
  tokens: Token[];
  lineKind?: ParsedLine['lineKind'];
}

interface FieldRange {
  start: number;
  end: number;
  text: string;
}

function createToken(type: Token['type'], text: string, start: number): Token {
  return { type, text, start, end: start + text.length };
}

function appendToken(tokens: Token[], type: Token['type'], text: string, start: number) {
  if (!text) return;
  tokens.push(createToken(type, text, start));
}

function splitFields(line: string): FieldRange[] {
  const fields: FieldRange[] = [];
  let cursor = 0;
  while (cursor < line.length) {
    while (cursor < line.length && /\s/u.test(line[cursor] || '')) cursor += 1;
    if (cursor >= line.length) break;
    const start = cursor;
    let quote: '"' | "'" | null = null;
    let escaped = false;
    while (cursor < line.length) {
      const char = line[cursor] || '';
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (/\s/u.test(char)) {
        break;
      }
      cursor += 1;
    }
    fields.push({ start, end: cursor, text: line.slice(start, cursor) });
  }
  return fields;
}

function findInlineComment(line: string, marker: string): number {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] || '';
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
    if (char === marker && (index === 0 || /\s/u.test(line[index - 1] || ''))) return index;
  }
  return -1;
}

function tokenizeValue(value: string, start: number, commentMarker?: string): Token[] {
  const tokens: Token[] = [];
  const commentIndex = commentMarker ? findInlineComment(value, commentMarker) : -1;
  const valueEnd = commentIndex === -1 ? value.length : commentIndex;
  const matcher = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\$\{[^}\r\n]+\}|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z%]|\b(?:true|false|yes|no|on|off|null)\b|[-+]?\b\d+(?:\.\d+)?\b)/giu;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(value)) !== null && match.index < valueEnd) {
    if (match.index > cursor) appendToken(tokens, 'text', value.slice(cursor, match.index), start + cursor);
    const text = match[0];
    const lower = text.toLowerCase();
    const type: Token['type'] = text.startsWith('"') || text.startsWith("'")
      ? 'string'
      : text.startsWith('$') || text.startsWith('%')
        ? 'keyword'
        : lower === 'true' || lower === 'false'
          ? 'boolean'
          : /^(?:yes|no|on|off|null)$/iu.test(text)
            ? 'literal'
            : 'number';
    appendToken(tokens, type, text, start + match.index);
    cursor = match.index + text.length;
  }
  if (cursor < valueEnd) appendToken(tokens, 'text', value.slice(cursor, valueEnd), start + cursor);
  if (commentIndex !== -1) appendToken(tokens, 'comment', value.slice(commentIndex), start + commentIndex);
  return tokens;
}

function tokenizeGettextLine(line: string, lineStart: number): ParsedSpecialLine {
  const leading = line.match(/^[ \t]*/u)?.[0] || '';
  const body = line.slice(leading.length);
  const tokens: Token[] = [];
  appendToken(tokens, 'text', leading, lineStart);
  const bodyStart = lineStart + leading.length;
  if (!body) return { tokens };
  if (body.startsWith('#')) {
    const marker = body.match(/^#(?:[.,:|~]|[ \t])?/u)?.[0] || '#';
    appendToken(tokens, marker === '#~' ? 'comment' : 'keyword', marker, bodyStart);
    appendToken(tokens, 'comment', body.slice(marker.length), bodyStart + marker.length);
    return { tokens };
  }
  const directive = body.match(/^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)([ \t]+)(.*)$/u);
  if (directive) {
    const name = directive[1] || '';
    const spacing = directive[2] || '';
    const value = directive[3] || '';
    appendToken(tokens, 'directive', name, bodyStart);
    appendToken(tokens, 'text', spacing, bodyStart + name.length);
    appendToken(tokens, /^"(?:\\.|[^"\\])*"$/u.test(value) ? 'string' : 'invalid', value, bodyStart + name.length + spacing.length);
    const lineKind = name.startsWith('msgstr')
      ? value === '""' ? 'translation-empty' : 'translation-target'
      : name.startsWith('msgid') ? 'translation-source' : undefined;
    return { tokens, lineKind };
  }
  if (/^"(?:\\.|[^"\\])*"$/u.test(body)) {
    appendToken(tokens, 'string', body, bodyStart);
    return { tokens };
  }
  appendToken(tokens, 'invalid', body, bodyStart);
  return { tokens };
}

function tokenizeRegistryValue(value: string, valueStart: number): Token[] {
  const tokens: Token[] = [];
  if (value === '-') return [createToken('operator', value, valueStart)];
  const prefix = value.match(/^(dword:|hex(?:\([0-9a-fA-F]+\))?:)/u)?.[0] || '';
  if (prefix) {
    appendToken(tokens, 'directive', prefix, valueStart);
    const rest = value.slice(prefix.length);
    const matcher = /[0-9a-fA-F]+|[,\\]/gu;
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(rest)) !== null) {
      if (match.index > cursor) appendToken(tokens, 'text', rest.slice(cursor, match.index), valueStart + prefix.length + cursor);
      appendToken(tokens, match[0] === ',' || match[0] === '\\' ? 'punctuation' : 'number', match[0], valueStart + prefix.length + match.index);
      cursor = match.index + match[0].length;
    }
    appendToken(tokens, 'text', rest.slice(cursor), valueStart + prefix.length + cursor);
    return tokens;
  }
  appendToken(tokens, /^"(?:\\.|[^"\\])*"$/u.test(value) ? 'string' : 'invalid', value, valueStart);
  return tokens;
}

function tokenizeRegistryLine(line: string, lineStart: number, lineIndex: number, continuation: boolean): ParsedSpecialLine {
  const trimmed = line.trim();
  const leadingLength = line.indexOf(trimmed);
  if (!trimmed) return { tokens: line ? [createToken('text', line, lineStart)] : [] };
  if (trimmed.startsWith(';')) return { tokens: [createToken('comment', line, lineStart)] };
  if (lineIndex === 0 && /^(?:\uFEFF)?(?:Windows Registry Editor Version 5\.00|REGEDIT4)$/u.test(line)) {
    return { tokens: [createToken('directive', line, lineStart)], lineKind: 'section' };
  }
  if (continuation) {
    const tokens: Token[] = [];
    const matcher = /[0-9a-fA-F]{2}|[,\\]/gu;
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(line)) !== null) {
      appendToken(tokens, 'text', line.slice(cursor, match.index), lineStart + cursor);
      appendToken(tokens, match[0] === ',' || match[0] === '\\' ? 'punctuation' : 'number', match[0], lineStart + match.index);
      cursor = match.index + match[0].length;
    }
    appendToken(tokens, 'text', line.slice(cursor), lineStart + cursor);
    return { tokens };
  }
  const section = line.match(/^([ \t]*)(\[)(-?)([^\]]+)(\])([ \t]*)$/u);
  if (section) {
    const leading = section[1] || '';
    const open = section[2] || '';
    const deletion = section[3] || '';
    const name = section[4] || '';
    const close = section[5] || '';
    const trailing = section[6] || '';
    const tokens: Token[] = [];
    appendToken(tokens, 'text', leading, lineStart);
    appendToken(tokens, 'punctuation', open, lineStart + leading.length);
    appendToken(tokens, 'operator', deletion, lineStart + leading.length + open.length);
    appendToken(tokens, 'section', name, lineStart + leading.length + open.length + deletion.length);
    appendToken(tokens, 'punctuation', close, lineStart + leading.length + open.length + deletion.length + name.length);
    appendToken(tokens, 'text', trailing, lineStart + line.length - trailing.length);
    return { tokens, lineKind: 'section' };
  }
  const assignment = line.match(/^([ \t]*)(@|"(?:\\.|[^"\\])*")([ \t]*)(=)([ \t]*)(.*)$/u);
  if (assignment) {
    const leading = assignment[1] || '';
    const name = assignment[2] || '';
    const beforeEquals = assignment[3] || '';
    const equals = assignment[4] || '';
    const afterEquals = assignment[5] || '';
    const value = assignment[6] || '';
    const tokens: Token[] = [];
    appendToken(tokens, 'text', leading, lineStart);
    appendToken(tokens, name === '@' ? 'keyword' : 'key', name, lineStart + leading.length);
    appendToken(tokens, 'text', beforeEquals, lineStart + leading.length + name.length);
    appendToken(tokens, 'operator', equals, lineStart + leading.length + name.length + beforeEquals.length);
    appendToken(tokens, 'text', afterEquals, lineStart + leading.length + name.length + beforeEquals.length + equals.length);
    tokens.push(...tokenizeRegistryValue(value, lineStart + line.length - value.length));
    return { tokens };
  }
  return { tokens: [createToken('invalid', line, lineStart + Math.max(0, leadingLength))] };
}

function tokenizeDirectiveLine(
  line: string,
  lineStart: number,
  format: 'sshconfig' | 'systemd',
  continuation = false
): ParsedSpecialLine {
  const leading = line.match(/^[ \t]*/u)?.[0] || '';
  const body = line.slice(leading.length);
  const tokens: Token[] = [];
  appendToken(tokens, 'text', leading, lineStart);
  const bodyStart = lineStart + leading.length;
  if (!body) return { tokens };
  if (body.startsWith('#') || (format === 'systemd' && body.startsWith(';'))) {
    appendToken(tokens, 'comment', body, bodyStart);
    return { tokens };
  }
  if (format === 'systemd' && continuation) {
    tokens.push(...tokenizeValue(body, bodyStart));
    return { tokens };
  }
  if (format === 'systemd') {
    const section = body.match(/^(\[)([^\]]+)(\])([ \t]*)$/u);
    if (section) {
      const opening = section[1] || '';
      const name = section[2] || '';
      const closing = section[3] || '';
      const trailing = section[4] || '';
      appendToken(tokens, 'punctuation', opening, bodyStart);
      appendToken(tokens, 'section', name, bodyStart + opening.length);
      appendToken(tokens, 'punctuation', closing, bodyStart + opening.length + name.length);
      appendToken(tokens, 'text', trailing, bodyStart + opening.length + name.length + closing.length);
      return { tokens, lineKind: 'section' };
    }
    const assignment = body.match(/^([A-Za-z][A-Za-z0-9-]*)([ \t]*)(=)(.*)$/u);
    if (assignment) {
      const key = assignment[1] || '';
      const spacing = assignment[2] || '';
      const equals = assignment[3] || '';
      const value = assignment[4] || '';
      appendToken(tokens, 'directive', key, bodyStart);
      appendToken(tokens, 'text', spacing, bodyStart + key.length);
      appendToken(tokens, 'operator', equals, bodyStart + key.length + spacing.length);
      tokens.push(...tokenizeValue(value, bodyStart + key.length + spacing.length + equals.length));
      return { tokens };
    }
    appendToken(tokens, 'invalid', body, bodyStart);
    return { tokens };
  }

  const directive = body.match(/^([A-Za-z][A-Za-z0-9-]*)([ \t]*=[ \t]*|[ \t]+)(.*)$/u);
  if (!directive) {
    appendToken(tokens, 'invalid', body, bodyStart);
    return { tokens };
  }
  const name = directive[1] || '';
  const separator = directive[2] || '';
  const value = directive[3] || '';
  appendToken(tokens, 'directive', name, bodyStart);
  appendToken(tokens, 'operator', separator, bodyStart + name.length);
  const valueStart = bodyStart + name.length + separator.length;
  const commentIndex = findInlineComment(value, '#');
  const valueEnd = commentIndex === -1 ? value.length : commentIndex;
  const fields = splitFields(value.slice(0, valueEnd));
  let cursor = 0;
  for (const field of fields) {
    appendToken(tokens, 'text', value.slice(cursor, field.start), valueStart + cursor);
    appendToken(tokens, /^(?:Host|Match)$/iu.test(name) ? 'pattern' : 'string', field.text, valueStart + field.start);
    cursor = field.end;
  }
  appendToken(tokens, 'text', value.slice(cursor, valueEnd), valueStart + cursor);
  if (commentIndex !== -1) appendToken(tokens, 'comment', value.slice(commentIndex), valueStart + commentIndex);
  return { tokens, lineKind: /^(?:Host|Match)$/iu.test(name) ? 'section' : undefined };
}

function tokenizeGitMessageLine(line: string, lineStart: number, subjectSeen: boolean): ParsedSpecialLine {
  if (/^[ \t]*#/u.test(line)) {
    const scissors = /^# -+ >8 -+/u.test(line.trim());
    return { tokens: [createToken(scissors ? 'keyword' : 'comment', line, lineStart)] };
  }
  if (!line.trim()) return { tokens: line ? [createToken('text', line, lineStart)] : [] };
  if (!subjectSeen) return { tokens: [createToken('text', line, lineStart)], lineKind: 'subject' };
  const trailer = line.match(/^([A-Za-z][A-Za-z0-9-]*)(:)([ \t]+)(.*)$/u);
  if (trailer) {
    const key = trailer[1] || '';
    const colon = trailer[2] || '';
    const spacing = trailer[3] || '';
    const value = trailer[4] || '';
    return {
      tokens: [
        createToken('directive', key, lineStart),
        createToken('operator', colon, lineStart + key.length),
        createToken('text', spacing, lineStart + key.length + colon.length),
        createToken('string', value, lineStart + key.length + colon.length + spacing.length)
      ]
    };
  }
  return { tokens: [createToken('text', line, lineStart)] };
}

function tokenizeMailmapLine(line: string, lineStart: number): ParsedSpecialLine {
  if (!line.trim()) return { tokens: line ? [createToken('text', line, lineStart)] : [] };
  if (/^[ \t]*#/u.test(line)) return { tokens: [createToken('comment', line, lineStart)] };
  const tokens: Token[] = [];
  const matcher = /<[^<>\r\n]+>/gu;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(line)) !== null) {
    appendToken(tokens, 'text', line.slice(cursor, match.index), lineStart + cursor);
    appendToken(tokens, 'owner', match[0], lineStart + match.index);
    cursor = match.index + match[0].length;
  }
  appendToken(tokens, 'text', line.slice(cursor), lineStart + cursor);
  return { tokens, lineKind: 'rule' };
}

function tokenizeGitBlameLine(line: string, lineStart: number): ParsedSpecialLine {
  if (!line.trim()) return { tokens: line ? [createToken('text', line, lineStart)] : [] };
  if (/^[ \t]*#/u.test(line)) return { tokens: [createToken('comment', line, lineStart)] };
  const match = line.match(/^([ \t]*)([0-9a-fA-F]+)([ \t]*)(#.*)?$/u);
  if (!match) return { tokens: [createToken('invalid', line, lineStart)] };
  const leading = match[1] || '';
  const hash = match[2] || '';
  const spacing = match[3] || '';
  const comment = match[4] || '';
  return {
    tokens: [
      ...(leading ? [createToken('text', leading, lineStart)] : []),
      createToken('hash', hash, lineStart + leading.length),
      ...(spacing ? [createToken('text', spacing, lineStart + leading.length + hash.length)] : []),
      ...(comment ? [createToken('comment', comment, lineStart + leading.length + hash.length + spacing.length)] : [])
    ]
  };
}

function tokenizeHostsLine(line: string, lineStart: number): ParsedSpecialLine {
  if (!line.trim()) return { tokens: line ? [createToken('text', line, lineStart)] : [] };
  if (/^[ \t]*#/u.test(line)) return { tokens: [createToken('comment', line, lineStart)] };
  const commentIndex = findInlineComment(line, '#');
  const contentEnd = commentIndex === -1 ? line.length : commentIndex;
  const fields = splitFields(line.slice(0, contentEnd));
  const tokens: Token[] = [];
  let cursor = 0;
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    appendToken(tokens, 'text', line.slice(cursor, field.start), lineStart + cursor);
    appendToken(tokens, index === 0 ? 'keyword' : 'host', field.text, lineStart + field.start);
    cursor = field.end;
  }
  appendToken(tokens, 'text', line.slice(cursor, contentEnd), lineStart + cursor);
  if (commentIndex !== -1) appendToken(tokens, 'comment', line.slice(commentIndex), lineStart + commentIndex);
  return { tokens, lineKind: 'rule' };
}

export function parseSpecializedTextFormat(
  content: string,
  format: SpecializedTextFormatId,
  options: ParseOptions
): ParsedLine[] {
  const parsedLines: ParsedLine[] = [];
  let registryContinuation = false;
  let systemdContinuation = false;
  let gitSubjectSeen = false;
  let gettextHeaderEntry = false;
  for (let lineIndex = 0; lineIndex <= options.lineRange.endLine; lineIndex += 1) {
    const line = getLineText(content, options.lineStartOffsets, lineIndex);
    const lineStart = options.lineStartOffsets[lineIndex] ?? 0;
    let parsed: ParsedSpecialLine;
    if (format === 'gettext') {
      parsed = tokenizeGettextLine(line, lineStart);
      const trimmed = line.trim();
      if (!trimmed) gettextHeaderEntry = false;
      if (/^msgid\s+""$/u.test(trimmed)) gettextHeaderEntry = true;
      if (/^msgid\s+".+"$/u.test(trimmed)) gettextHeaderEntry = false;
      if (parsed.lineKind === 'translation-empty') {
        const nextLine = lineIndex + 1 < options.lineStartOffsets.length
          ? getLineText(content, options.lineStartOffsets, lineIndex + 1).trim()
          : '';
        if (gettextHeaderEntry || (/^"(?:\\.|[^"\\])+"$/u.test(nextLine) && nextLine !== '""')) {
          parsed.lineKind = 'translation-target';
        }
      }
    }
    else if (format === 'registry') parsed = tokenizeRegistryLine(line, lineStart, lineIndex, registryContinuation);
    else if (format === 'sshconfig' || format === 'systemd') parsed = tokenizeDirectiveLine(line, lineStart, format, systemdContinuation);
    else if (format === 'gitmessage') parsed = tokenizeGitMessageLine(line, lineStart, gitSubjectSeen);
    else if (format === 'gitmailmap') parsed = tokenizeMailmapLine(line, lineStart);
    else if (format === 'gitblame') parsed = tokenizeGitBlameLine(line, lineStart);
    else parsed = tokenizeHostsLine(line, lineStart);

    if (format === 'registry') registryContinuation = /\\[ \t]*$/u.test(line);
    if (format === 'systemd') systemdContinuation = /\\[ \t]*$/u.test(line);
    if (format === 'gitmessage' && !gitSubjectSeen && line.trim() && !/^[ \t]*#/u.test(line)) gitSubjectSeen = true;
    if (lineIndex < options.lineRange.startLine) continue;
    parsedLines.push({
      id: lineIndex,
      ...getIndentInfo(line, options.tabSize),
      tokens: parsed.tokens,
      lineKind: parsed.lineKind
    });
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

function diagnosticAt(starts: number[], lineIndex: number, columnIndex = 0): SpecializedDiagnosticPosition {
  return {
    line: lineIndex + 1,
    column: columnIndex + 1,
    offset: (starts[lineIndex] ?? 0) + columnIndex
  };
}

function hasClosedQuotedValue(value: string): boolean {
  if (!value.startsWith('"')) return false;
  let escaped = false;
  for (let index = 1; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) escaped = false;
    else if (char === '\\') escaped = true;
    else if (char === '"') return index === value.length - 1;
  }
  return false;
}

function getGettextDiagnostic(lines: string[], starts: number[]): SpecializedDiagnosticPosition | null {
  let seenMsgid = false;
  let seenMsgstr = false;
  let lastDirective: string | null = null;
  let lastMsgidLine = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = (lines[index] || '').trim();
    if (!trimmed) {
      if (seenMsgid && !seenMsgstr) return diagnosticAt(starts, lastMsgidLine);
      seenMsgid = false;
      seenMsgstr = false;
      lastDirective = null;
      continue;
    }
    if (trimmed.startsWith('#')) continue;
    const directive = trimmed.match(/^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)\s+(.*)$/u);
    if (directive) {
      const name = directive[1] || '';
      const value = directive[2] || '';
      if (!hasClosedQuotedValue(value)) return diagnosticAt(starts, index, Math.max(0, (lines[index] || '').indexOf(value)));
      if (name === 'msgid') {
        if (seenMsgid && !seenMsgstr) return diagnosticAt(starts, index);
        seenMsgid = true;
        seenMsgstr = false;
        lastMsgidLine = index;
      } else if (name.startsWith('msgstr')) {
        if (!seenMsgid) return diagnosticAt(starts, index);
        seenMsgstr = true;
      } else if (name === 'msgid_plural' && !seenMsgid) {
        return diagnosticAt(starts, index);
      }
      lastDirective = name;
      continue;
    }
    if (trimmed.startsWith('"')) {
      if (!lastDirective || !hasClosedQuotedValue(trimmed)) return diagnosticAt(starts, index);
      continue;
    }
    return diagnosticAt(starts, index);
  }
  return seenMsgid && !seenMsgstr ? diagnosticAt(starts, lastMsgidLine) : null;
}

function getRegistryDiagnostic(lines: string[], starts: number[]): SpecializedDiagnosticPosition | null {
  const first = lines.findIndex((line) => line.trim() && !line.trim().startsWith(';'));
  if (first === -1 || !/^(?:\uFEFF)?(?:Windows Registry Editor Version 5\.00|REGEDIT4)$/u.test(lines[first] || '')) {
    return diagnosticAt(starts, Math.max(0, first));
  }
  let continuation = false;
  for (let index = first + 1; index < lines.length; index += 1) {
    const line = lines[index] || '';
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';')) continue;
    if (continuation) {
      if (!/^(?:[0-9a-fA-F]{2},?\s*)+(?:\\)?$/u.test(trimmed)) return diagnosticAt(starts, index);
      continuation = /\\$/u.test(trimmed);
      continue;
    }
    if (trimmed.startsWith('[')) {
      if (!/^\[-?(?:HKEY_[A-Z_]+|HK[A-Z]+)(?:\\[^\]]*)?\]$/u.test(trimmed)) return diagnosticAt(starts, index);
      continue;
    }
    const assignment = trimmed.match(/^(@|"(?:\\.|[^"\\])*")\s*=\s*(.*)$/u);
    if (!assignment) return diagnosticAt(starts, index);
    const value = assignment[2] || '';
    if (/^dword:/iu.test(value) && !/^dword:[0-9a-fA-F]{8}$/u.test(value)) return diagnosticAt(starts, index, line.indexOf(value));
    if (value.startsWith('"') && !hasClosedQuotedValue(value)) return diagnosticAt(starts, index, line.indexOf(value));
    continuation = /\\[ \t]*$/u.test(value);
  }
  return continuation ? diagnosticAt(starts, lines.length - 1) : null;
}

function hasUnclosedQuote(value: string): boolean {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (const char of value) {
    if (escaped) escaped = false;
    else if (char === '\\') escaped = true;
    else if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
  }
  return quote !== null;
}

function getDirectiveDiagnostic(
  lines: string[],
  starts: number[],
  format: 'sshconfig' | 'systemd'
): SpecializedDiagnosticPosition | null {
  let continuation = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || '';
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || (format === 'systemd' && trimmed.startsWith(';'))) continue;
    if (format === 'systemd') {
      if (continuation) {
        continuation = /\\$/u.test(trimmed);
        continue;
      }
      if (trimmed.startsWith('[')) {
        if (!/^\[[^\]]+\]$/u.test(trimmed)) return diagnosticAt(starts, index);
        continue;
      }
      if (!/^[A-Za-z][A-Za-z0-9-]*\s*=/u.test(trimmed)) return diagnosticAt(starts, index);
      continuation = /\\$/u.test(trimmed);
      if (hasUnclosedQuote(trimmed)) return diagnosticAt(starts, index);
      continue;
    }
    const directive = trimmed.match(/^([A-Za-z][A-Za-z0-9-]*)(?:\s*=\s*|\s+)(.*)$/u);
    if (!directive || !(directive[2] || '').trim()) return diagnosticAt(starts, index);
    if (hasUnclosedQuote(directive[2] || '')) return diagnosticAt(starts, index);
  }
  return continuation ? diagnosticAt(starts, lines.length - 1) : null;
}

function getMailmapDiagnostic(lines: string[], starts: number[]): SpecializedDiagnosticPosition | null {
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = (lines[index] || '').trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const emails = trimmed.match(/<[^<>\s]+@[^<>\s]+>/gu) || [];
    if (emails.length < 1 || emails.length > 2 || (trimmed.match(/[<>]/gu) || []).length !== emails.length * 2) {
      return diagnosticAt(starts, index);
    }
  }
  return null;
}

function isValidIp(value: string): boolean {
  if (value.includes(':')) {
    const zoneParts = value.split('%');
    if (zoneParts.length > 2 || (zoneParts.length === 2 && !/^[A-Za-z0-9_.-]+$/u.test(zoneParts[1] || ''))) return false;
    const address = zoneParts[0] || '';
    if ((address.match(/::/gu) || []).length > 1) return false;
    const compressed = address.includes('::');
    let groups = address.split(':').filter(Boolean);
    const ipv4Tail = groups.at(-1)?.includes('.') ? groups.pop() || '' : '';
    if (ipv4Tail) {
      const ipv4Parts = ipv4Tail.split('.');
      if (ipv4Parts.length !== 4 || !ipv4Parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255)) return false;
      groups = [...groups, '0', '0'];
    }
    if (!groups.every((part) => /^[0-9a-fA-F]{1,4}$/u.test(part))) return false;
    return compressed ? groups.length < 8 : groups.length === 8;
  }
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255);
}

function getHostsDiagnostic(lines: string[], starts: number[]): SpecializedDiagnosticPosition | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || '';
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const comment = findInlineComment(line, '#');
    const fields = splitFields(comment === -1 ? line : line.slice(0, comment));
    if (fields.length < 2 || !isValidIp(fields[0]?.text || '')) return diagnosticAt(starts, index);
    const invalidHost = fields.slice(1).find((field) => !/^(?:\*|[A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_])?)$/u.test(field.text));
    if (invalidHost) return diagnosticAt(starts, index, invalidHost.start);
  }
  return null;
}

export function getSpecializedTextDiagnostic(
  content: string,
  format: SpecializedTextFormatId
): SpecializedDiagnosticPosition | null {
  if (!content.trim()) return null;
  const lines = content.split(/\r?\n/u);
  const starts = getLineStarts(content);
  if (format === 'gettext') return getGettextDiagnostic(lines, starts);
  if (format === 'registry') return getRegistryDiagnostic(lines, starts);
  if (format === 'sshconfig' || format === 'systemd') return getDirectiveDiagnostic(lines, starts, format);
  if (format === 'gitmailmap') return getMailmapDiagnostic(lines, starts);
  if (format === 'gitblame') {
    for (let index = 0; index < lines.length; index += 1) {
      const trimmed = (lines[index] || '').trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (!/^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})(?:\s+#.*)?$/u.test(trimmed)) return diagnosticAt(starts, index);
    }
  }
  if (format === 'hosts') return getHostsDiagnostic(lines, starts);
  return null;
}
