import { parse as parseToml, TomlError } from 'smol-toml';
import {
  getIndentInfo,
  getLineText,
  type DocumentLineRange,
  type ParsedLine
} from './structured-rendering';
import type { Token } from './render-tokenizer';

export type TextConfigurationFormatId =
  | 'toml'
  | 'gitignore'
  | 'gitattributes'
  | 'gitconfig'
  | 'editorconfig'
  | 'npmrc'
  | 'dockerignore'
  | 'ignore'
  | 'codeowners';

export interface TextConfigurationDiagnosticPosition {
  line: number;
  column: number;
  offset: number;
}

interface ParseTextConfigurationOptions {
  tabSize: number;
  lineStartOffsets: number[];
  lineRange: DocumentLineRange;
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
  const previous = tokens[tokens.length - 1];
  if (previous?.type === type && previous.end === start && !previous.children) {
    previous.text = (previous.text || '') + text;
    previous.end = start + text.length;
    return;
  }
  tokens.push(createToken(type, text, start));
}

function splitFieldsWithOffsets(line: string): FieldRange[] {
  const fields: FieldRange[] = [];
  let index = 0;

  while (index < line.length) {
    while (index < line.length && /\s/u.test(line[index] || '')) index += 1;
    if (index >= line.length) break;

    const start = index;
    let quote: '"' | null = null;
    let escaped = false;
    while (index < line.length) {
      const char = line[index];
      if (escaped) {
        escaped = false;
        index += 1;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        index += 1;
        continue;
      }
      if (quote) {
        if (char === quote) quote = null;
        index += 1;
        continue;
      }
      if (char === '"') {
        quote = '"';
        index += 1;
        continue;
      }
      if (/\s/u.test(char || '')) break;
      index += 1;
    }
    fields.push({ start, end: index, text: line.slice(start, index) });
  }

  return fields;
}

function tokenizePathPattern(pattern: string, absoluteStart: number): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let literalStart = 0;

  const flushLiteral = (end: number) => {
    appendToken(tokens, 'pattern', pattern.slice(literalStart, end), absoluteStart + literalStart);
  };

  while (index < pattern.length) {
    const char = pattern[index];
    if (char === '\\' && index + 1 < pattern.length) {
      index += 2;
      continue;
    }

    if (char === '*' || char === '?' || char === '[' || char === '/') {
      flushLiteral(index);
      if (char === '*') {
        const end = pattern[index + 1] === '*' ? index + 2 : index + 1;
        appendToken(tokens, 'keyword', pattern.slice(index, end), absoluteStart + index);
        index = end;
      } else if (char === '?') {
        appendToken(tokens, 'keyword', char, absoluteStart + index);
        index += 1;
      } else if (char === '/') {
        appendToken(tokens, 'punctuation', char, absoluteStart + index);
        index += 1;
      } else {
        const closeIndex = pattern.indexOf(']', index + 1);
        const end = closeIndex === -1 ? index + 1 : closeIndex + 1;
        appendToken(tokens, closeIndex === -1 ? 'invalid' : 'keyword', pattern.slice(index, end), absoluteStart + index);
        index = end;
      }
      literalStart = index;
      continue;
    }
    index += 1;
  }

  flushLiteral(pattern.length);
  return tokens;
}

function tokenizeRuleLine(
  line: string,
  lineStartOffset: number
): { tokens: Token[]; lineKind?: ParsedLine['lineKind'] } {
  if (!line) return { tokens: [] };
  if (line.startsWith('#')) {
    return { tokens: [createToken('comment', line, lineStartOffset)] };
  }

  const tokens: Token[] = [];
  let patternStart = 0;
  let negated = false;
  if (line.startsWith('!')) {
    appendToken(tokens, 'operator', '!', lineStartOffset);
    patternStart = 1;
    negated = true;
  }

  const pattern = line.slice(patternStart);
  tokens.push(...tokenizePathPattern(pattern, lineStartOffset + patternStart));
  return {
    tokens,
    lineKind: negated ? 'negated-rule' : 'rule'
  };
}

function tokenizeAttribute(attribute: FieldRange, lineStartOffset: number): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;
  if (attribute.text[0] === '-' || attribute.text[0] === '!') {
    appendToken(tokens, 'operator', attribute.text[0], lineStartOffset + attribute.start);
    cursor = 1;
  }
  const equalsIndex = attribute.text.indexOf('=', cursor);
  const nameEnd = equalsIndex === -1 ? attribute.text.length : equalsIndex;
  appendToken(
    tokens,
    'attribute',
    attribute.text.slice(cursor, nameEnd),
    lineStartOffset + attribute.start + cursor
  );
  if (equalsIndex !== -1) {
    appendToken(tokens, 'operator', '=', lineStartOffset + attribute.start + equalsIndex);
    appendToken(
      tokens,
      'string',
      attribute.text.slice(equalsIndex + 1),
      lineStartOffset + attribute.start + equalsIndex + 1
    );
  }
  return tokens;
}

function tokenizeColumnsLine(
  line: string,
  lineStartOffset: number,
  format: 'gitattributes' | 'codeowners'
): { tokens: Token[]; lineKind?: ParsedLine['lineKind'] } {
  if (!line) return { tokens: [] };
  const leadingLength = line.match(/^[ \t]*/u)?.[0].length || 0;
  if (line.slice(leadingLength).startsWith('#')) {
    return { tokens: [createToken('comment', line, lineStartOffset)] };
  }

  const fields = splitFieldsWithOffsets(line);
  if (fields.length === 0) return { tokens: [createToken('text', line, lineStartOffset)] };

  const tokens: Token[] = [];
  let cursor = 0;
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    appendToken(tokens, 'text', line.slice(cursor, field.start), lineStartOffset + cursor);
    if (index === 0) {
      tokens.push(...tokenizePathPattern(field.text, lineStartOffset + field.start));
    } else if (format === 'gitattributes') {
      tokens.push(...tokenizeAttribute(field, lineStartOffset));
    } else {
      appendToken(tokens, 'owner', field.text, lineStartOffset + field.start);
    }
    cursor = field.end;
  }
  appendToken(tokens, 'text', line.slice(cursor), lineStartOffset + cursor);

  return { tokens, lineKind: 'rule' };
}

function findUnquotedCharacter(text: string, expected: string): number {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
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
    if (char === expected) return index;
  }
  return -1;
}

function findInlineCommentStart(value: string, markers: string[]): number {
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
    if (markers.includes(char || '') && (index === 0 || /\s/u.test(value[index - 1] || ''))) return index;
  }
  return -1;
}

function tokenizeConfigurationValue(
  value: string,
  absoluteStart: number,
  commentMarkers: string[]
): Token[] {
  const tokens: Token[] = [];
  const commentStart = findInlineCommentStart(value, commentMarkers);
  const valueEnd = commentStart === -1 ? value.length : commentStart;
  let index = 0;

  while (index < valueEnd) {
    const char = value[index] || '';
    if (/\s/u.test(char)) {
      const start = index;
      while (index < valueEnd && /\s/u.test(value[index] || '')) index += 1;
      appendToken(tokens, 'text', value.slice(start, index), absoluteStart + start);
      continue;
    }
    if (char === '"' || char === "'") {
      const start = index;
      const triple = value.slice(index, index + 3) === char.repeat(3);
      const delimiter = triple ? char.repeat(3) : char;
      index += delimiter.length;
      let escaped = false;
      while (index < valueEnd) {
        if (!escaped && value.startsWith(delimiter, index)) {
          index += delimiter.length;
          break;
        }
        if (char === '"' && value[index] === '\\' && !escaped) {
          escaped = true;
        } else {
          escaped = false;
        }
        index += 1;
      }
      appendToken(tokens, 'string', value.slice(start, index), absoluteStart + start);
      continue;
    }
    if ('[]{},'.includes(char)) {
      appendToken(tokens, 'punctuation', char, absoluteStart + index);
      index += 1;
      continue;
    }

    const start = index;
    while (
      index < valueEnd
      && !/\s/u.test(value[index] || '')
      && !'[]{},"\''.includes(value[index] || '')
    ) {
      index += 1;
    }
    const word = value.slice(start, index);
    const lower = word.toLowerCase();
    const type: Token['type'] = lower === 'true' || lower === 'false'
      ? 'boolean'
      : /^[-+]?(?:0|[1-9][0-9_]*)(?:\.[0-9_]+)?(?:[eE][-+]?[0-9_]+)?$/u.test(word)
        ? 'number'
        : /^(?:null|yes|no|on|off)$/iu.test(word)
          ? 'literal'
          : 'string';
    appendToken(tokens, type, word, absoluteStart + start);
  }

  if (commentStart !== -1) {
    appendToken(tokens, 'comment', value.slice(commentStart), absoluteStart + commentStart);
  }
  return tokens;
}

function tokenizeAssignmentLine(
  line: string,
  lineStartOffset: number,
  format: 'toml' | 'gitconfig' | 'editorconfig' | 'npmrc'
): { tokens: Token[]; lineKind?: ParsedLine['lineKind'] } {
  const leading = line.match(/^[ \t]*/u)?.[0] || '';
  const body = line.slice(leading.length);
  const commentMarkers = format === 'toml' ? ['#'] : ['#', ';'];
  if (!body) return { tokens: leading ? [createToken('text', leading, lineStartOffset)] : [] };
  if (commentMarkers.some((marker) => body.startsWith(marker))) {
    return { tokens: [createToken('comment', line, lineStartOffset)] };
  }

  const tableMatch = format === 'toml'
    ? body.match(/^(\[\[?)(.+)(\]\]?)(\s*(?:#.*)?)$/u)
    : format !== 'npmrc'
      ? body.match(/^(\[)(.+)(\])(\s*(?:[;#].*)?)$/u)
      : null;
  if (tableMatch) {
    const opening = tableMatch[1] || '';
    const section = tableMatch[2] || '';
    const closing = tableMatch[3] || '';
    const rest = tableMatch[4] || '';
    const tokens = leading ? [createToken('text', leading, lineStartOffset)] : [];
    const openingStart = lineStartOffset + leading.length;
    appendToken(tokens, 'punctuation', opening, openingStart);
    appendToken(tokens, 'section', section, openingStart + opening.length);
    appendToken(tokens, 'punctuation', closing, openingStart + opening.length + section.length);
    if (rest) {
      const restStart = openingStart + opening.length + section.length + closing.length;
      const commentStart = rest.search(/[;#]/u);
      if (commentStart > 0) appendToken(tokens, 'text', rest.slice(0, commentStart), restStart);
      if (commentStart >= 0) appendToken(tokens, 'comment', rest.slice(commentStart), restStart + commentStart);
      else appendToken(tokens, 'text', rest, restStart);
    }
    return { tokens, lineKind: 'section' };
  }

  let separatorIndex = findUnquotedCharacter(body, '=');
  let separatorLength = separatorIndex === -1 ? 0 : 1;
  if (separatorIndex === -1 && format === 'gitconfig') {
    const whitespace = body.search(/[ \t]/u);
    if (whitespace !== -1) {
      separatorIndex = whitespace;
      separatorLength = body.slice(whitespace).match(/^[ \t]+/u)?.[0].length || 1;
    }
  }
  if (separatorIndex === -1) {
    const tokens = leading ? [createToken('text', leading, lineStartOffset)] : [];
    appendToken(tokens, format === 'gitconfig' ? 'key' : 'text', body, lineStartOffset + leading.length);
    return { tokens };
  }

  const rawKey = body.slice(0, separatorIndex);
  const key = rawKey.trimEnd();
  const keySpacing = rawKey.slice(key.length);
  const tokens = leading ? [createToken('text', leading, lineStartOffset)] : [];
  const bodyStart = lineStartOffset + leading.length;
  appendToken(tokens, 'key', key, bodyStart);
  appendToken(tokens, 'text', keySpacing, bodyStart + key.length);
  appendToken(tokens, 'operator', body.slice(separatorIndex, separatorIndex + separatorLength), bodyStart + separatorIndex);
  tokens.push(...tokenizeConfigurationValue(
    body.slice(separatorIndex + separatorLength),
    bodyStart + separatorIndex + separatorLength,
    commentMarkers
  ));
  return { tokens };
}

function findTomlMultilineClosing(line: string, delimiter: '"""' | "'''"): number {
  let searchStart = 0;
  while (searchStart < line.length) {
    const index = line.indexOf(delimiter, searchStart);
    if (index === -1 || delimiter === "'''") return index;
    let backslashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor -= 1) {
      backslashCount += 1;
    }
    if (backslashCount % 2 === 0) return index;
    searchStart = index + delimiter.length;
  }
  return -1;
}

export function parseTextConfigurationFormat(
  content: string,
  format: TextConfigurationFormatId,
  options: ParseTextConfigurationOptions
): ParsedLine[] {
  const lines: ParsedLine[] = [];
  let tomlMultilineDelimiter: '"""' | "'''" | null = null;
  for (let lineIndex = 0; lineIndex <= options.lineRange.endLine; lineIndex += 1) {
    const line = getLineText(content, options.lineStartOffsets, lineIndex);
    const lineStartOffset = options.lineStartOffsets[lineIndex] ?? 0;
    let parsed: { tokens: Token[]; lineKind?: ParsedLine['lineKind'] };
    if (format === 'toml' && tomlMultilineDelimiter) {
      const closingIndex = findTomlMultilineClosing(line, tomlMultilineDelimiter);
      if (closingIndex === -1) {
        parsed = { tokens: line ? [createToken('string', line, lineStartOffset)] : [] };
      } else {
        const closingEnd = closingIndex + tomlMultilineDelimiter.length;
        parsed = {
          tokens: [
            createToken('string', line.slice(0, closingEnd), lineStartOffset),
            ...tokenizeConfigurationValue(line.slice(closingEnd), lineStartOffset + closingEnd, ['#'])
          ]
        };
        tomlMultilineDelimiter = null;
      }
    } else {
      parsed = format === 'gitignore' || format === 'dockerignore' || format === 'ignore'
        ? tokenizeRuleLine(line, lineStartOffset)
        : format === 'gitattributes' || format === 'codeowners'
          ? tokenizeColumnsLine(line, lineStartOffset, format)
          : tokenizeAssignmentLine(line, lineStartOffset, format);
      if (format === 'toml') {
        const unclosedMultilineString = parsed.tokens.find((token) => {
          if (token.type !== 'string' || !token.text) return false;
          const delimiter = token.text.startsWith('"""') ? '"""' : token.text.startsWith("'''") ? "'''" : null;
          return delimiter !== null
            && !(token.text.length >= delimiter.length * 2 && token.text.endsWith(delimiter));
        });
        if (unclosedMultilineString?.text) {
          tomlMultilineDelimiter = unclosedMultilineString.text.startsWith('"""') ? '"""' : "'''";
        }
      }
    }
    if (lineIndex < options.lineRange.startLine) continue;
    lines.push({
      id: lineIndex,
      ...getIndentInfo(line, options.tabSize),
      tokens: parsed.tokens,
      lineKind: parsed.lineKind
    });
  }
  return lines;
}

function getLineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function diagnosticAt(
  lineStarts: number[],
  lineIndex: number,
  columnIndex = 0
): TextConfigurationDiagnosticPosition {
  return {
    line: lineIndex + 1,
    column: columnIndex + 1,
    offset: (lineStarts[lineIndex] ?? 0) + columnIndex
  };
}

function hasUnclosedCharacterClass(pattern: string): boolean {
  let escaped = false;
  let open = false;
  for (const char of pattern) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '[') open = true;
    if (char === ']') open = false;
  }
  return open;
}

function getRuleDiagnostic(
  content: string,
  format: 'gitignore' | 'dockerignore' | 'ignore'
): TextConfigurationDiagnosticPosition | null {
  const lines = content.split(/\r?\n/u);
  const starts = getLineStarts(content);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || '';
    if (!line || line.startsWith('#')) continue;
    const pattern = line.startsWith('!') ? line.slice(1) : line;
    if (!pattern) return diagnosticAt(starts, index);
    if (hasUnclosedCharacterClass(pattern)) return diagnosticAt(starts, index, line.indexOf('['));
  }
  return null;
}

function getColumnsDiagnostic(
  content: string,
  format: 'gitattributes' | 'codeowners'
): TextConfigurationDiagnosticPosition | null {
  const lines = content.split(/\r?\n/u);
  const starts = getLineStarts(content);
  const attributePattern = /^[-!]?[A-Za-z0-9][A-Za-z0-9_.-]*(?:=.*)?$/u;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || '';
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const fields = splitFieldsWithOffsets(line);
    if (fields.length < 2) return diagnosticAt(starts, index);
    const pattern = fields[0]?.text || '';
    if (pattern.startsWith('!')) return diagnosticAt(starts, index, fields[0]?.start || 0);
    if (format === 'gitattributes') {
      const invalid = fields.slice(1).find((field) => !attributePattern.test(field.text));
      if (invalid) return diagnosticAt(starts, index, invalid.start);
    } else {
      if (pattern.includes('[') || pattern.includes(']')) {
        return diagnosticAt(starts, index, Math.max(0, line.search(/[\[\]]/u)));
      }
      const invalid = fields.slice(1).find((field) => !field.text.startsWith('@') && !field.text.includes('@'));
      if (invalid) return diagnosticAt(starts, index, invalid.start);
    }
  }
  return null;
}

function getAssignmentDiagnostic(
  content: string,
  format: 'gitconfig' | 'editorconfig' | 'npmrc'
): TextConfigurationDiagnosticPosition | null {
  const lines = content.split(/\r?\n/u);
  const starts = getLineStarts(content);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || '';
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    if (trimmed.startsWith('[')) {
      if (format === 'npmrc' || !trimmed.endsWith(']')) return diagnosticAt(starts, index);
      continue;
    }
    const equalsIndex = findUnquotedCharacter(trimmed, '=');
    if (format === 'gitconfig') {
      if (!/^[A-Za-z][A-Za-z0-9-]*/u.test(trimmed)) return diagnosticAt(starts, index);
      continue;
    }
    if (equalsIndex <= 0) return diagnosticAt(starts, index);
    if (format === 'editorconfig' && !/^[A-Za-z0-9_.-]+\s*=/u.test(trimmed)) {
      return diagnosticAt(starts, index);
    }
  }
  return null;
}

export function getTextConfigurationDiagnostic(
  content: string,
  format: TextConfigurationFormatId
): TextConfigurationDiagnosticPosition | null {
  if (!content.trim()) return null;
  if (format === 'toml') {
    try {
      parseToml(content);
      return null;
    } catch (error) {
      if (error instanceof TomlError) {
        const starts = getLineStarts(content);
        return diagnosticAt(starts, Math.max(0, error.line - 1), Math.max(0, error.column - 1));
      }
      return diagnosticAt(getLineStarts(content), 0);
    }
  }
  if (format === 'gitignore' || format === 'dockerignore' || format === 'ignore') {
    return getRuleDiagnostic(content, format);
  }
  if (format === 'gitattributes' || format === 'codeowners') {
    return getColumnsDiagnostic(content, format);
  }
  return getAssignmentDiagnostic(content, format);
}
