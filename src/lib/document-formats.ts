import {
  tokenizeLineWithState,
  type BlockCommentRule,
  type CommentSyntax,
  type LineCommentRule,
  type Token,
  type TokenizeState
} from './render-tokenizer';
import { parseAllDocuments as parseYamlDocuments, type YAMLParseError } from 'yaml';
import {
  getIndentDepth,
  getIndentInfo,
  getLineRangeOffsets,
  getLineText,
  normalizeLineRange,
  shouldKeepFlatToken,
  splitFlatTokensIntoLines,
  type DocumentLineRange as StructuredDocumentLineRange,
  type FlatToken,
  type ParsedLine as StructuredParsedLine
} from './structured-rendering';
import { translate, type AppLocale, type TranslationKey } from './i18n';

export type ParsedLine = StructuredParsedLine;

export interface DocumentDiagnostic {
  severity: 'error';
  message: string;
  line: number;
  column: number;
  offset: number;
}

export type DocumentFormatId =
  | 'plain'
  | 'markdown'
  | 'json'
  | 'csv'
  | 'tsv'
  | 'yaml'
  | 'ini'
  | 'log'
  | 'javascript'
  | 'typescript'
  | 'rust'
  | 'html'
  | 'css';

export type DocumentFormatCategoryId = 'document' | 'structured' | 'table' | 'code';

export interface DocumentFormatCategory {
  id: DocumentFormatCategoryId;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  formatIds: DocumentFormatId[];
}

export interface DocumentFormatFeatureSettings {
  render: boolean;
  edit: boolean;
}

export type DocumentFeatureSettings = Record<DocumentFormatId, DocumentFormatFeatureSettings>;

export interface DocumentFormat {
  id: DocumentFormatId;
  labelKey: TranslationKey;
  extensions: string[];
  defaultExtension: string;
  validatesSyntax: boolean;
  renderDescriptionKey: TranslationKey;
  editDescriptionKey: TranslationKey;
  commentSyntax?: CommentSyntax;
}

export interface DocumentRenderResult {
  format: DocumentFormat;
  lines: ParsedLine[];
  diagnostic: DocumentDiagnostic | null;
}

export type DocumentLineRange = StructuredDocumentLineRange;

interface ParseDocumentOptions {
  pathOrName: string | null | undefined;
  tabSize: number;
  lineStartOffsets: number[];
  lineRange?: DocumentLineRange;
  renderEnabled?: boolean;
  featureSettings?: DocumentFeatureSettings;
}

const cBlockComment: BlockCommentRule = { start: '/*', end: '*/' };
const htmlBlockComment: BlockCommentRule = { start: '<!--', end: '-->' };
const hashLineComment: LineCommentRule = { marker: '#' };
const slashLineComment: LineCommentRule = { marker: '//' };
const semicolonLineComment: LineCommentRule = { marker: ';', anchored: true };
const iniHashLineComment: LineCommentRule = { marker: '#', anchored: true };

const cFamilyCommentSyntax: CommentSyntax = {
  line: [slashLineComment],
  block: [cBlockComment]
};

const hashCommentSyntax: CommentSyntax = {
  line: [hashLineComment]
};

const plainTextFormat: DocumentFormat = {
  id: 'plain',
  labelKey: 'format.plain.label',
  extensions: ['txt'],
  defaultExtension: 'txt',
  validatesSyntax: false,
  renderDescriptionKey: 'format.render.generic',
  editDescriptionKey: 'format.edit.generic'
};

const markdownFormat: DocumentFormat = {
  id: 'markdown',
  labelKey: 'format.markdown.label',
  extensions: ['md'],
  defaultExtension: 'md',
  validatesSyntax: false,
  renderDescriptionKey: 'format.render.generic',
  editDescriptionKey: 'format.edit.generic',
  commentSyntax: { block: [htmlBlockComment] }
};

const jsonFormat: DocumentFormat = {
  id: 'json',
  labelKey: 'format.json.label',
  extensions: ['json'],
  defaultExtension: 'json',
  validatesSyntax: true,
  renderDescriptionKey: 'format.json.render',
  editDescriptionKey: 'format.json.edit'
};

const csvFormat: DocumentFormat = {
  id: 'csv',
  labelKey: 'format.csv.label',
  extensions: ['csv'],
  defaultExtension: 'csv',
  validatesSyntax: false,
  renderDescriptionKey: 'format.csv.render',
  editDescriptionKey: 'format.csv.edit'
};

const tsvFormat: DocumentFormat = {
  id: 'tsv',
  labelKey: 'format.tsv.label',
  extensions: ['tsv'],
  defaultExtension: 'tsv',
  validatesSyntax: false,
  renderDescriptionKey: 'format.tsv.render',
  editDescriptionKey: 'format.tsv.edit'
};

const yamlFormat: DocumentFormat = {
  id: 'yaml',
  labelKey: 'format.yaml.label',
  extensions: ['yaml', 'yml'],
  defaultExtension: 'yaml',
  validatesSyntax: true,
  renderDescriptionKey: 'format.yaml.render',
  editDescriptionKey: 'format.yaml.edit',
  commentSyntax: hashCommentSyntax
};

const iniFormat: DocumentFormat = {
  id: 'ini',
  labelKey: 'format.ini.label',
  extensions: ['ini', 'cfg'],
  defaultExtension: 'ini',
  validatesSyntax: false,
  renderDescriptionKey: 'format.render.generic',
  editDescriptionKey: 'format.edit.generic',
  commentSyntax: { line: [semicolonLineComment, iniHashLineComment] }
};

const logFormat: DocumentFormat = {
  id: 'log',
  labelKey: 'format.log.label',
  extensions: ['log'],
  defaultExtension: 'log',
  validatesSyntax: false,
  renderDescriptionKey: 'format.render.generic',
  editDescriptionKey: 'format.edit.generic'
};

const javascriptFormat: DocumentFormat = {
  id: 'javascript',
  labelKey: 'format.javascript.label',
  extensions: ['js'],
  defaultExtension: 'js',
  validatesSyntax: false,
  renderDescriptionKey: 'format.render.generic',
  editDescriptionKey: 'format.edit.generic',
  commentSyntax: cFamilyCommentSyntax
};

const typescriptFormat: DocumentFormat = {
  id: 'typescript',
  labelKey: 'format.typescript.label',
  extensions: ['ts'],
  defaultExtension: 'ts',
  validatesSyntax: false,
  renderDescriptionKey: 'format.render.generic',
  editDescriptionKey: 'format.edit.generic',
  commentSyntax: cFamilyCommentSyntax
};

const rustFormat: DocumentFormat = {
  id: 'rust',
  labelKey: 'format.rust.label',
  extensions: ['rs'],
  defaultExtension: 'rs',
  validatesSyntax: false,
  renderDescriptionKey: 'format.render.generic',
  editDescriptionKey: 'format.edit.generic',
  commentSyntax: cFamilyCommentSyntax
};

const htmlFormat: DocumentFormat = {
  id: 'html',
  labelKey: 'format.html.label',
  extensions: ['html'],
  defaultExtension: 'html',
  validatesSyntax: false,
  renderDescriptionKey: 'format.render.generic',
  editDescriptionKey: 'format.edit.generic',
  commentSyntax: { block: [htmlBlockComment] }
};

const cssFormat: DocumentFormat = {
  id: 'css',
  labelKey: 'format.css.label',
  extensions: ['css'],
  defaultExtension: 'css',
  validatesSyntax: false,
  renderDescriptionKey: 'format.render.generic',
  editDescriptionKey: 'format.edit.generic',
  commentSyntax: { block: [cBlockComment] }
};

export const configurableDocumentFormats = [
  plainTextFormat,
  markdownFormat,
  jsonFormat,
  csvFormat,
  tsvFormat,
  yamlFormat,
  iniFormat,
  logFormat,
  javascriptFormat,
  typescriptFormat,
  rustFormat,
  htmlFormat,
  cssFormat
];

export const configurableDocumentFormatCategories: DocumentFormatCategory[] = [
  {
    id: 'document',
    labelKey: 'category.document.label',
    descriptionKey: 'category.document.description',
    formatIds: ['plain', 'markdown', 'log']
  },
  {
    id: 'structured',
    labelKey: 'category.structured.label',
    descriptionKey: 'category.structured.description',
    formatIds: ['json', 'yaml', 'ini']
  },
  {
    id: 'table',
    labelKey: 'category.table.label',
    descriptionKey: 'category.table.description',
    formatIds: ['csv', 'tsv']
  },
  {
    id: 'code',
    labelKey: 'category.code.label',
    descriptionKey: 'category.code.description',
    formatIds: ['javascript', 'typescript', 'rust', 'html', 'css']
  }
];

const productSupportedDocumentFormats = [
  plainTextFormat,
  jsonFormat,
  csvFormat,
  tsvFormat,
  yamlFormat
];

export function createDefaultDocumentFeatureSettings(): DocumentFeatureSettings {
  return {
    plain: { render: true, edit: true },
    markdown: { render: true, edit: true },
    json: { render: true, edit: true },
    csv: { render: true, edit: true },
    tsv: { render: true, edit: true },
    yaml: { render: true, edit: true },
    ini: { render: true, edit: true },
    log: { render: true, edit: true },
    javascript: { render: true, edit: true },
    typescript: { render: true, edit: true },
    rust: { render: true, edit: true },
    html: { render: true, edit: true },
    css: { render: true, edit: true }
  };
}

export function normalizeDocumentFeatureSettings(input: unknown): DocumentFeatureSettings {
  const defaults = createDefaultDocumentFeatureSettings();
  if (!input || typeof input !== 'object') return defaults;

  const candidate = input as Partial<Record<DocumentFormatId, Partial<DocumentFormatFeatureSettings>>>;
  const normalized = createDefaultDocumentFeatureSettings();

  for (const format of configurableDocumentFormats) {
    const current = candidate[format.id];
    normalized[format.id] = {
      render: typeof current?.render === 'boolean' ? current.render : defaults[format.id].render,
      edit: typeof current?.edit === 'boolean' ? current.edit : defaults[format.id].edit
    };
  }

  return normalized;
}

export function isDocumentFormatRenderEnabled(
  format: DocumentFormat,
  featureSettings?: DocumentFeatureSettings
): boolean {
  return featureSettings?.[format.id]?.render ?? true;
}

export function isDocumentFormatEditEnabled(
  format: DocumentFormat,
  featureSettings?: DocumentFeatureSettings
): boolean {
  return featureSettings?.[format.id]?.edit ?? true;
}

export const supportedTextExtensions = [
  ...new Set(productSupportedDocumentFormats.flatMap((format) => format.extensions))
];

export function getOpenFileDialogFilters(locale: AppLocale) {
  return [
    {
      name: translate(locale, 'filter.textFiles'),
      extensions: supportedTextExtensions
    }
  ];
}

export function getSaveFileDialogFilters(locale: AppLocale) {
  return [
    {
      name: translate(locale, 'filter.textFiles'),
      extensions: ['txt']
    },
    {
      name: translate(locale, 'filter.jsonFiles'),
      extensions: ['json']
    },
    {
      name: translate(locale, 'filter.csvFiles'),
      extensions: ['csv']
    },
    {
      name: translate(locale, 'filter.tsvFiles'),
      extensions: ['tsv']
    },
    {
      name: translate(locale, 'filter.yamlFiles'),
      extensions: ['yaml', 'yml']
    },
    {
      name: translate(locale, 'filter.allSupportedTextFiles'),
      extensions: supportedTextExtensions
    }
  ];
}

export function getFileExtension(pathOrName: string | null | undefined): string {
  if (!pathOrName) return '';
  const fileName = pathOrName.split(/[?#]/)[0].split(/[/\\]/).pop() || pathOrName;
  const match = fileName.toLowerCase().match(/\.([^.]+)$/);
  return match?.[1] || '';
}

export function getDocumentFormatForPath(pathOrName: string | null | undefined): DocumentFormat {
  const extension = getFileExtension(pathOrName);
  return configurableDocumentFormats.find((format) => format.extensions.includes(extension)) || plainTextFormat;
}

export function looksLikeJsonContent(content: string): boolean {
  const firstChar = content.trimStart()[0];
  return firstChar === '{' || firstChar === '[';
}

export function looksLikeYamlContent(content: string): boolean {
  return /^(?:%YAML\b|---(?:\s|$))/u.test(content.trimStart());
}

export function getDocumentFormatForContent(
  content: string,
  pathOrName: string | null | undefined
): DocumentFormat {
  const namedFormat = getDocumentFormatForPath(pathOrName);
  if (namedFormat.id !== 'plain') return namedFormat;
  if (looksLikeJsonContent(content)) return jsonFormat;
  if (looksLikeYamlContent(content)) return yamlFormat;
  return namedFormat;
}

export function getSuggestedFileExtensionForContent(content: string): string {
  if (looksLikeJsonContent(content)) return jsonFormat.defaultExtension;
  if (looksLikeYamlContent(content)) return yamlFormat.defaultExtension;
  return plainTextFormat.defaultExtension;
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
      tokens: tokenized.tokens,
      fencedCodePosition: tokenized.fencedCodePosition
    },
    state: tokenized.state
  };
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

function parseBasicLines(
  content: string,
  tabSize: number,
  lineStartOffsets: number[],
  lineRange: DocumentLineRange
): ParsedLine[] {
  const parsedLines: ParsedLine[] = [];

  for (let idx = lineRange.startLine; idx <= lineRange.endLine; idx++) {
    const lineText = getLineText(content, lineStartOffsets, idx);
    const lineStartOffset = lineStartOffsets[idx] ?? 0;
    parsedLines.push({
      id: idx,
      ...getIndentInfo(lineText, tabSize),
      tokens: [
        {
          type: 'text',
          text: lineText,
          start: lineStartOffset,
          end: lineStartOffset + lineText.length
        }
      ]
    });
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
      if (shouldKeepFlatToken(token, range)) tokens.push(token);
      continue;
    }

    if (char === '"') {
      const token = readJsonStringToken(content, i);
      if (token.type === 'string' && content[findNextNonJsonWhitespace(content, token.end)] === ':') {
        token.type = 'key';
      }
      if (shouldKeepFlatToken(token, range)) tokens.push(token);
      i = token.end;
      continue;
    }

    if (char === '-' || /\d/u.test(char)) {
      const token = readJsonNumberToken(content, i);
      if (shouldKeepFlatToken(token, range)) tokens.push(token);
      i = token.end;
      continue;
    }

    const literalToken = readJsonLiteralToken(content, i);
    if (literalToken) {
      if (shouldKeepFlatToken(literalToken, range)) tokens.push(literalToken);
      i = literalToken.end;
      continue;
    }

    if (char === '{' || char === '[') {
      const type = char === '{' ? 'brace' : 'bracket';
      const token = { type, text: char, start: i, end: i + 1 } satisfies FlatToken;
      if (shouldKeepFlatToken(token, range)) tokens.push(token);
      i += 1;
      continue;
    }

    if (char === '}' || char === ']') {
      const expected = char === '}' ? 'brace' : 'bracket';
      const token = { type: expected, text: char, start: i, end: i + 1 } satisfies FlatToken;
      if (shouldKeepFlatToken(token, range)) tokens.push(token);
      i += 1;
      continue;
    }

    if (char === ':' || char === ',') {
      const token = { type: 'punctuation', text: char, start: i, end: i + 1 } satisfies FlatToken;
      if (shouldKeepFlatToken(token, range)) tokens.push(token);
      i += 1;
      continue;
    }

    const token = { type: 'invalid', text: char, start: i, end: i + 1 } satisfies FlatToken;
    if (shouldKeepFlatToken(token, range)) tokens.push(token);
    i += 1;
  }

  return tokens;
}

interface YamlBlockScalarState {
  parentIndentColumns: number;
  contentIndentColumns: number | null;
}

type LineTokenEmitter = (type: Token['type'], start: number, end: number) => void;

function isHorizontalWhitespaceChar(char: string | undefined): boolean {
  return char === ' ' || char === '\t';
}

function findFirstNonHorizontalWhitespace(lineText: string): number {
  for (let i = 0; i < lineText.length; i += 1) {
    if (!isHorizontalWhitespaceChar(lineText[i])) return i;
  }

  return -1;
}

function findNextNonHorizontalWhitespace(lineText: string, start: number, end: number): number {
  for (let i = start; i < end; i += 1) {
    if (!isHorizontalWhitespaceChar(lineText[i])) return i;
  }

  return -1;
}

function trimHorizontalWhitespaceEnd(lineText: string, start: number, end: number): number {
  let i = end;
  while (i > start && isHorizontalWhitespaceChar(lineText[i - 1])) i -= 1;
  return i;
}

function isYamlMappingSeparator(lineText: string, index: number, end: number): boolean {
  const next = lineText[index + 1];
  return index + 1 >= end || isHorizontalWhitespaceChar(next);
}

function findYamlCommentStart(lineText: string, start: number, end = lineText.length): number {
  let quote: '"' | "'" | null = null;

  for (let i = start; i < end; i += 1) {
    const char = lineText[i];

    if (quote) {
      if (quote === '"' && char === '\\') {
        i += 1;
        continue;
      }
      if (quote === "'" && char === "'" && lineText[i + 1] === "'") {
        i += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '#' && (i === 0 || isHorizontalWhitespaceChar(lineText[i - 1]))) {
      return i;
    }
  }

  return -1;
}

function findYamlKeySeparator(lineText: string, start: number, end: number): number {
  let quote: '"' | "'" | null = null;
  let flowDepth = 0;

  for (let i = start; i < end; i += 1) {
    const char = lineText[i];

    if (quote) {
      if (quote === '"' && char === '\\') {
        i += 1;
        continue;
      }
      if (quote === "'" && char === "'" && lineText[i + 1] === "'") {
        i += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '[' || char === '{') {
      flowDepth += 1;
      continue;
    }
    if (char === ']' || char === '}') {
      flowDepth = Math.max(0, flowDepth - 1);
      continue;
    }

    if (char === ':' && flowDepth === 0 && isYamlMappingSeparator(lineText, i, end)) {
      return i;
    }
  }

  return -1;
}

function isYamlDocumentMarker(lineText: string, start: number, end: number): boolean {
  const marker = lineText.slice(start, start + 3);
  if (marker !== '---' && marker !== '...') return false;
  const next = lineText[start + 3];
  return start + 3 >= end || isHorizontalWhitespaceChar(next);
}

function getYamlSequenceMarkerEnd(lineText: string, start: number, end: number): number | null {
  if (lineText[start] !== '-') return null;
  if (lineText.startsWith('---', start)) return null;
  const next = lineText[start + 1];
  return start + 1 >= end || isHorizontalWhitespaceChar(next) ? start + 1 : null;
}

function readYamlQuotedScalarEnd(lineText: string, start: number, end: number): number {
  const quote = lineText[start];
  let i = start + 1;

  while (i < end) {
    const char = lineText[i];
    if (quote === '"' && char === '\\') {
      i += 2;
      continue;
    }
    if (quote === "'" && char === "'" && lineText[i + 1] === "'") {
      i += 2;
      continue;
    }
    if (char === quote) {
      return i + 1;
    }
    i += 1;
  }

  return end;
}

function isYamlPlainScalarBreak(lineText: string, index: number, end: number): boolean {
  const char = lineText[index];
  if (isHorizontalWhitespaceChar(char)) return true;
  if (char === '[' || char === ']' || char === '{' || char === '}' || char === ',') return true;
  return char === ':' && isYamlMappingSeparator(lineText, index, end);
}

function readYamlPlainScalarEnd(lineText: string, start: number, end: number): number {
  let i = start;
  while (i < end && !isYamlPlainScalarBreak(lineText, i, end)) i += 1;
  return i;
}

function isYamlBlockScalarIndicator(text: string): boolean {
  return /^[|>](?:[+-]?\d?|\d?[+-]?)$/.test(text);
}

function getYamlScalarTokenType(text: string): Token['type'] {
  const lowerText = text.toLowerCase();
  if (text === 'true' || text === 'false') return 'boolean';
  if (lowerText === 'null' || text === '~') return 'literal';
  if (/^[-+]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(text)) return 'number';
  if (/^[-+]?\.(?:inf|nan)$/i.test(text)) return 'number';
  if (/^[&*][A-Za-z0-9_-]+$/.test(text) || /^![A-Za-z0-9_!./:-]+$/.test(text)) return 'literal';
  return 'string';
}

function tokenizeYamlValueTokens(
  lineText: string,
  start: number,
  end: number,
  addToken: LineTokenEmitter
): { startsBlockScalar: boolean } {
  let i = start;
  let hasValueToken = false;
  let startsBlockScalar = false;

  while (i < end) {
    const char = lineText[i];

    if (isHorizontalWhitespaceChar(char)) {
      i += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      const tokenEnd = readYamlQuotedScalarEnd(lineText, i, end);
      addToken('string', i, tokenEnd);
      i = tokenEnd;
      hasValueToken = true;
      continue;
    }

    if (char === '[' || char === ']') {
      addToken('bracket', i, i + 1);
      i += 1;
      hasValueToken = true;
      continue;
    }

    if (char === '{' || char === '}') {
      addToken('brace', i, i + 1);
      i += 1;
      hasValueToken = true;
      continue;
    }

    if (char === ',' || (char === ':' && isYamlMappingSeparator(lineText, i, end))) {
      addToken('punctuation', i, i + 1);
      i += 1;
      continue;
    }

    const tokenEnd = readYamlPlainScalarEnd(lineText, i, end);
    const tokenText = lineText.slice(i, tokenEnd);
    const isBlockScalarIndicator = !hasValueToken && isYamlBlockScalarIndicator(tokenText);

    addToken(isBlockScalarIndicator ? 'literal' : getYamlScalarTokenType(tokenText), i, tokenEnd);
    if (isBlockScalarIndicator && findNextNonHorizontalWhitespace(lineText, tokenEnd, end) === -1) {
      startsBlockScalar = true;
    }

    i = tokenEnd;
    hasValueToken = true;
  }

  return { startsBlockScalar };
}

function scanYamlLineTokens(
  lineText: string,
  lineStartOffset: number,
  shouldEmit: boolean,
  tokens: FlatToken[]
): { startsBlockScalar: boolean } {
  const firstNonWhitespace = findFirstNonHorizontalWhitespace(lineText);
  let cursor = 0;

  const pushToken = (type: Token['type'], start: number, end: number) => {
    if (!shouldEmit || end <= start) return;
    tokens.push({
      type,
      text: lineText.slice(start, end),
      start: lineStartOffset + start,
      end: lineStartOffset + end
    });
  };

  const addTextUntil = (end: number) => {
    pushToken('text', cursor, end);
    cursor = end;
  };

  const addToken: LineTokenEmitter = (type, start, end) => {
    addTextUntil(start);
    pushToken(type, start, end);
    cursor = end;
  };

  if (firstNonWhitespace === -1) {
    addTextUntil(lineText.length);
    return { startsBlockScalar: false };
  }

  const commentStart = findYamlCommentStart(lineText, firstNonWhitespace);
  const codeEnd = commentStart === -1 ? lineText.length : commentStart;

  if (firstNonWhitespace >= codeEnd) {
    addTextUntil(codeEnd);
    if (commentStart !== -1) addToken('comment', commentStart, lineText.length);
    return { startsBlockScalar: false };
  }

  let valueStart = firstNonWhitespace;
  let startsBlockScalar = false;

  if (isYamlDocumentMarker(lineText, firstNonWhitespace, codeEnd)) {
    addToken('punctuation', firstNonWhitespace, firstNonWhitespace + 3);
    const valueResult = tokenizeYamlValueTokens(lineText, firstNonWhitespace + 3, codeEnd, addToken);
    startsBlockScalar = valueResult.startsBlockScalar;
  } else {
    const sequenceMarkerEnd = getYamlSequenceMarkerEnd(lineText, firstNonWhitespace, codeEnd);
    if (sequenceMarkerEnd !== null) {
      addToken('list-marker', firstNonWhitespace, sequenceMarkerEnd);
      valueStart = sequenceMarkerEnd;
    }

    const keyStart = findNextNonHorizontalWhitespace(lineText, valueStart, codeEnd);
    const keySeparator = keyStart === -1 ? -1 : findYamlKeySeparator(lineText, keyStart, codeEnd);

    if (keySeparator !== -1 && keyStart !== -1) {
      const keyEnd = trimHorizontalWhitespaceEnd(lineText, keyStart, keySeparator);
      if (keyEnd > keyStart) {
        addToken('key', keyStart, keyEnd);
      } else {
        addToken('invalid', keySeparator, keySeparator + 1);
      }
      addTextUntil(keySeparator);
      addToken('punctuation', keySeparator, keySeparator + 1);
      const valueResult = tokenizeYamlValueTokens(lineText, keySeparator + 1, codeEnd, addToken);
      startsBlockScalar = valueResult.startsBlockScalar;
    } else {
      const valueResult = tokenizeYamlValueTokens(lineText, valueStart, codeEnd, addToken);
      startsBlockScalar = valueResult.startsBlockScalar;
    }
  }

  addTextUntil(codeEnd);
  if (commentStart !== -1) {
    addToken('comment', commentStart, lineText.length);
  } else {
    addTextUntil(lineText.length);
  }

  return { startsBlockScalar };
}

function scanYamlTokens(
  content: string,
  tabSize: number,
  lineStartOffsets: number[],
  lineRange: DocumentLineRange
): FlatToken[] {
  const tokens: FlatToken[] = [];
  let blockScalarState: YamlBlockScalarState | null = null;

  for (let lineIndex = 0; lineIndex <= lineRange.endLine; lineIndex += 1) {
    const lineText = getLineText(content, lineStartOffsets, lineIndex);
    const lineStartOffset = lineStartOffsets[lineIndex] ?? 0;
    const shouldEmit = lineIndex >= lineRange.startLine;
    const indentInfo = getIndentInfo(lineText, tabSize);
    const trimmedLineLength = lineText.trim().length;

    if (blockScalarState) {
      if (trimmedLineLength === 0) {
        if (shouldEmit && lineText.length > 0) {
          tokens.push({
            type: 'string',
            text: lineText,
            start: lineStartOffset,
            end: lineStartOffset + lineText.length
          });
        }
        continue;
      }

      if (blockScalarState.contentIndentColumns === null) {
        if (indentInfo.indentColumns > blockScalarState.parentIndentColumns) {
          blockScalarState.contentIndentColumns = indentInfo.indentColumns;
        } else {
          blockScalarState = null;
        }
      }

      if (
        blockScalarState
        && blockScalarState.contentIndentColumns !== null
        && indentInfo.indentColumns >= blockScalarState.contentIndentColumns
      ) {
        if (shouldEmit) {
          tokens.push({
            type: 'string',
            text: lineText,
            start: lineStartOffset,
            end: lineStartOffset + lineText.length
          });
        }
        continue;
      }

      blockScalarState = null;
    }

    const lineResult = scanYamlLineTokens(lineText, lineStartOffset, shouldEmit, tokens);
    if (lineResult.startsBlockScalar) {
      blockScalarState = {
        parentIndentColumns: indentInfo.indentColumns,
        contentIndentColumns: null
      };
    }
  }

  return tokens;
}

function getYamlRenderDepth(token: FlatToken, line: ParsedLine, indentUnit: number): number | undefined {
  if (token.type === 'key' || token.type === 'list-marker') {
    return getIndentDepth(line, indentUnit);
  }

  if (token.type === 'brace' || token.type === 'bracket') {
    return token.depth ?? getIndentDepth(line, indentUnit);
  }

  return token.depth;
}

function getJsonRenderDepth(token: FlatToken, line: ParsedLine, indentUnit: number): number | undefined {
  if (token.type === 'key') {
    return getIndentDepth(line, indentUnit, -1);
  }

  if (token.type === 'brace' || token.type === 'bracket') {
    return getIndentDepth(line, indentUnit, -1);
  }

  return token.depth;
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

function getJsonDiagnostic(content: string, locale: AppLocale): DocumentDiagnostic | null {
  if (content.trim().length === 0) {
    return {
      severity: 'error',
      message: translate(locale, 'diagnostic.jsonEmpty'),
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
      message: translate(locale, 'diagnostic.jsonSyntax', { line: position.line, column: position.column }),
      line: position.line,
      column: position.column,
      offset
    };
  }
}

function getYamlDiagnosticPosition(
  content: string,
  error: YAMLParseError
): { line: number; column: number; offset: number } {
  const linePosition = error.linePos?.[0];
  if (linePosition) {
    return {
      line: linePosition.line,
      column: linePosition.col,
      offset: offsetFromLineColumn(content, linePosition.line, linePosition.col)
    };
  }

  const offset = Math.max(0, Math.min(content.length, error.pos?.[0] ?? 0));
  const position = offsetToLineColumn(content, offset);
  return {
    line: position.line,
    column: position.column,
    offset
  };
}

function getYamlDiagnostic(content: string, locale: AppLocale): DocumentDiagnostic | null {
  if (content.trim().length === 0) return null;

  try {
    const documents = parseYamlDocuments(content, { prettyErrors: false });
    const firstError = documents.flatMap((document) => document.errors)[0];
    if (!firstError) return null;

    const position = getYamlDiagnosticPosition(content, firstError);
    return {
      severity: 'error',
      message: translate(locale, 'diagnostic.yamlSyntax', { line: position.line, column: position.column }),
      line: position.line,
      column: position.column,
      offset: position.offset
    };
  } catch (err) {
    const position = offsetToLineColumn(content, 0);
    return {
      severity: 'error',
      message: translate(locale, 'diagnostic.yamlSyntax', { line: position.line, column: position.column }),
      line: position.line,
      column: position.column,
      offset: 0
    };
  }
}

export function getDocumentDiagnostic(
  content: string,
  options: Pick<ParseDocumentOptions, 'pathOrName' | 'featureSettings'> & { locale: AppLocale }
): DocumentDiagnostic | null {
  const format = getDocumentFormatForContent(content, options.pathOrName);
  if (!isDocumentFormatRenderEnabled(format, options.featureSettings)) return null;
  if (format.id === 'json') return getJsonDiagnostic(content, options.locale);
  if (format.id === 'yaml') return getYamlDiagnostic(content, options.locale);
  return null;
}

export function parseDocumentForRender(content: string, options: ParseDocumentOptions): DocumentRenderResult {
  const format = getDocumentFormatForContent(content, options.pathOrName);
  const lineRange = normalizeLineRange(options.lineStartOffsets.length, options.lineRange);
  const lineRangeOffsets = getLineRangeOffsets(content, options.lineStartOffsets, lineRange);
  const renderEnabled = options.renderEnabled
    ?? isDocumentFormatRenderEnabled(format, options.featureSettings);

  if (!renderEnabled) {
    return {
      format,
      lines: parseBasicLines(content, options.tabSize, options.lineStartOffsets, lineRange),
      diagnostic: null
    };
  }

  if (format.id === 'json') {
    return {
      format,
      lines: splitFlatTokensIntoLines(
        content,
        scanJsonTokens(content, lineRangeOffsets),
        options.tabSize,
        options.lineStartOffsets,
        lineRange,
        getJsonRenderDepth
      ),
      diagnostic: null
    };
  }

  if (format.id === 'yaml') {
    return {
      format,
      lines: splitFlatTokensIntoLines(
        content,
        scanYamlTokens(content, options.tabSize, options.lineStartOffsets, lineRange),
        options.tabSize,
        options.lineStartOffsets,
        lineRange,
        getYamlRenderDepth
      ),
      diagnostic: null
    };
  }

  return {
    format,
    lines: parsePlainLines(
      content,
      options.tabSize,
      format.commentSyntax || null,
      options.lineStartOffsets,
      lineRange
    ),
    diagnostic: null
  };
}
