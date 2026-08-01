import supportedTextFormatManifest from '../../supported-text-formats.json';
import {
  tokenizeLineWithState,
  type BlockCommentRule,
  type CommentSyntax,
  type LineCommentRule,
  type Token,
  type TokenizeState
} from './render-tokenizer';
import { parseAllDocuments as parseYamlDocuments, type YAMLParseError } from 'yaml';
import { parse as parseJsonc, type ParseError as JsoncParseError } from 'jsonc-parser';
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
import {
  getLineOrientedFormatDiagnostic,
  parseLineOrientedFormat,
  type LineOrientedFormatId
} from './line-oriented-formats';
import type { MarkdownRenderSettings } from './markdown-settings';
import { getDelimitedTableSyntaxError } from './delimited-table';
import {
  getTextConfigurationDiagnostic,
  parseTextConfigurationFormat,
  type TextConfigurationFormatId
} from './text-configuration-formats';
import {
  createXmlRenderCache,
  getXmlDiagnostic,
  parseXmlFormat,
  type XmlRenderCache
} from './xml-format';
import {
  getSpecializedTextDiagnostic,
  parseSpecializedTextFormat,
  type SpecializedTextFormatId
} from './specialized-text-formats';

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
  | 'jsonc'
  | 'jsonlines'
  | 'xml'
  | 'gettext'
  | 'csv'
  | 'tsv'
  | 'yaml'
  | 'toml'
  | 'ini'
  | 'conf'
  | 'properties'
  | 'dotenv'
  | 'registry'
  | 'sshconfig'
  | 'systemd'
  | 'hosts'
  | 'log'
  | 'srt'
  | 'webvtt'
  | 'lrc'
  | 'gitignore'
  | 'gitattributes'
  | 'gitconfig'
  | 'editorconfig'
  | 'npmrc'
  | 'dockerignore'
  | 'ignore'
  | 'codeowners'
  | 'gitmessage'
  | 'gitmailmap'
  | 'gitblame';

export type DocumentFormatCategoryId = 'document' | 'structured' | 'project' | 'table' | 'subtitle';

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

export interface DocumentRenderCache {
  xml: XmlRenderCache;
}

export function createDocumentRenderCache(): DocumentRenderCache {
  return { xml: createXmlRenderCache() };
}

interface ParseDocumentOptions {
  pathOrName: string | null | undefined;
  tabSize: number;
  lineStartOffsets: number[];
  lineRange?: DocumentLineRange;
  renderEnabled?: boolean;
  featureSettings?: DocumentFeatureSettings;
  markdownSettings?: MarkdownRenderSettings;
  renderCache?: DocumentRenderCache;
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

interface SupportedTextFormatManifestEntry {
  id: DocumentFormatId;
  extensions: string[];
  fileNames?: string[];
  fileNamePatterns?: string[];
  pathPatterns?: string[];
  sample: string;
}

const supportedManifestFormats = supportedTextFormatManifest.formats as SupportedTextFormatManifestEntry[];
const supportedExtensionsByFormat = new Map(
  supportedManifestFormats.map((entry) => [entry.id, entry.extensions])
);

function getSupportedExtensions(formatId: DocumentFormatId, fallback: string[]): string[] {
  return supportedExtensionsByFormat.get(formatId) || fallback;
}

const plainTextFormat: DocumentFormat = {
  id: 'plain',
  labelKey: 'format.plain.label',
  extensions: getSupportedExtensions('plain', ['txt']),
  defaultExtension: 'txt',
  validatesSyntax: false,
  renderDescriptionKey: 'format.render.generic',
  editDescriptionKey: 'format.edit.generic'
};

const markdownFormat: DocumentFormat = {
  id: 'markdown',
  labelKey: 'format.markdown.label',
  extensions: getSupportedExtensions('markdown', ['md']),
  defaultExtension: 'md',
  validatesSyntax: false,
  renderDescriptionKey: 'format.markdown.render',
  editDescriptionKey: 'format.markdown.edit',
  commentSyntax: { block: [htmlBlockComment] }
};

const jsonFormat: DocumentFormat = {
  id: 'json',
  labelKey: 'format.json.label',
  extensions: getSupportedExtensions('json', ['json']),
  defaultExtension: 'json',
  validatesSyntax: true,
  renderDescriptionKey: 'format.json.render',
  editDescriptionKey: 'format.json.edit'
};

const jsoncFormat: DocumentFormat = {
  id: 'jsonc',
  labelKey: 'format.jsonc.label',
  extensions: getSupportedExtensions('jsonc', ['jsonc']),
  defaultExtension: 'jsonc',
  validatesSyntax: true,
  renderDescriptionKey: 'format.json.render',
  editDescriptionKey: 'format.json.edit',
  commentSyntax: cFamilyCommentSyntax
};

const jsonLinesFormat: DocumentFormat = {
  id: 'jsonlines',
  labelKey: 'format.jsonlines.label',
  extensions: getSupportedExtensions('jsonlines', ['jsonl', 'ndjson']),
  defaultExtension: 'jsonl',
  validatesSyntax: true,
  renderDescriptionKey: 'format.jsonlines.render',
  editDescriptionKey: 'format.jsonlines.edit'
};

const xmlFormat: DocumentFormat = {
  id: 'xml',
  labelKey: 'format.xml.label',
  extensions: getSupportedExtensions('xml', ['xml']),
  defaultExtension: 'xml',
  validatesSyntax: true,
  renderDescriptionKey: 'format.markup.render',
  editDescriptionKey: 'format.markup.edit',
  commentSyntax: { block: [htmlBlockComment] }
};

const gettextFormat: DocumentFormat = {
  id: 'gettext',
  labelKey: 'format.gettext.label',
  extensions: getSupportedExtensions('gettext', ['po', 'pot']),
  defaultExtension: 'po',
  validatesSyntax: true,
  renderDescriptionKey: 'format.translation.render',
  editDescriptionKey: 'format.translation.edit',
  commentSyntax: hashCommentSyntax
};

const csvFormat: DocumentFormat = {
  id: 'csv',
  labelKey: 'format.csv.label',
  extensions: getSupportedExtensions('csv', ['csv']),
  defaultExtension: 'csv',
  validatesSyntax: true,
  renderDescriptionKey: 'format.csv.render',
  editDescriptionKey: 'format.csv.edit'
};

const tsvFormat: DocumentFormat = {
  id: 'tsv',
  labelKey: 'format.tsv.label',
  extensions: getSupportedExtensions('tsv', ['tsv']),
  defaultExtension: 'tsv',
  validatesSyntax: true,
  renderDescriptionKey: 'format.tsv.render',
  editDescriptionKey: 'format.tsv.edit'
};

const yamlFormat: DocumentFormat = {
  id: 'yaml',
  labelKey: 'format.yaml.label',
  extensions: getSupportedExtensions('yaml', ['yaml', 'yml']),
  defaultExtension: 'yaml',
  validatesSyntax: true,
  renderDescriptionKey: 'format.yaml.render',
  editDescriptionKey: 'format.yaml.edit',
  commentSyntax: hashCommentSyntax
};

const tomlFormat: DocumentFormat = {
  id: 'toml',
  labelKey: 'format.toml.label',
  extensions: getSupportedExtensions('toml', ['toml']),
  defaultExtension: 'toml',
  validatesSyntax: true,
  renderDescriptionKey: 'format.config.render',
  editDescriptionKey: 'format.config.edit',
  commentSyntax: hashCommentSyntax
};

const iniFormat: DocumentFormat = {
  id: 'ini',
  labelKey: 'format.ini.label',
  extensions: getSupportedExtensions('ini', ['ini', 'cfg']),
  defaultExtension: 'ini',
  validatesSyntax: true,
  renderDescriptionKey: 'format.config.render',
  editDescriptionKey: 'format.config.edit',
  commentSyntax: { line: [semicolonLineComment, iniHashLineComment] }
};

const confFormat: DocumentFormat = {
  id: 'conf',
  labelKey: 'format.conf.label',
  extensions: getSupportedExtensions('conf', ['conf']),
  defaultExtension: 'conf',
  validatesSyntax: false,
  renderDescriptionKey: 'format.config.render',
  editDescriptionKey: 'format.config.edit',
  commentSyntax: { line: [semicolonLineComment, iniHashLineComment] }
};

const propertiesFormat: DocumentFormat = {
  id: 'properties',
  labelKey: 'format.properties.label',
  extensions: getSupportedExtensions('properties', ['properties']),
  defaultExtension: 'properties',
  validatesSyntax: true,
  renderDescriptionKey: 'format.config.render',
  editDescriptionKey: 'format.config.edit',
  commentSyntax: hashCommentSyntax
};

const dotenvFormat: DocumentFormat = {
  id: 'dotenv',
  labelKey: 'format.dotenv.label',
  extensions: getSupportedExtensions('dotenv', ['env']),
  defaultExtension: 'env',
  validatesSyntax: true,
  renderDescriptionKey: 'format.config.render',
  editDescriptionKey: 'format.config.edit',
  commentSyntax: hashCommentSyntax
};

const registryFormat: DocumentFormat = {
  id: 'registry',
  labelKey: 'format.registry.label',
  extensions: getSupportedExtensions('registry', ['reg']),
  defaultExtension: 'reg',
  validatesSyntax: true,
  renderDescriptionKey: 'format.registry.render',
  editDescriptionKey: 'format.registry.edit',
  commentSyntax: { line: [semicolonLineComment] }
};

const sshConfigFormat: DocumentFormat = {
  id: 'sshconfig',
  labelKey: 'format.sshconfig.label',
  extensions: getSupportedExtensions('sshconfig', []),
  defaultExtension: '',
  validatesSyntax: true,
  renderDescriptionKey: 'format.directive.render',
  editDescriptionKey: 'format.directive.edit',
  commentSyntax: hashCommentSyntax
};

const systemdFormat: DocumentFormat = {
  id: 'systemd',
  labelKey: 'format.systemd.label',
  extensions: getSupportedExtensions('systemd', ['service']),
  defaultExtension: 'service',
  validatesSyntax: true,
  renderDescriptionKey: 'format.directive.render',
  editDescriptionKey: 'format.directive.edit',
  commentSyntax: { line: [hashLineComment, semicolonLineComment] }
};

const hostsFormat: DocumentFormat = {
  id: 'hosts',
  labelKey: 'format.hosts.label',
  extensions: getSupportedExtensions('hosts', []),
  defaultExtension: '',
  validatesSyntax: true,
  renderDescriptionKey: 'format.hosts.render',
  editDescriptionKey: 'format.hosts.edit',
  commentSyntax: hashCommentSyntax
};

const gitIgnoreFormat: DocumentFormat = {
  id: 'gitignore',
  labelKey: 'format.gitignore.label',
  extensions: getSupportedExtensions('gitignore', ['gitignore']),
  defaultExtension: 'gitignore',
  validatesSyntax: true,
  renderDescriptionKey: 'format.pattern.render',
  editDescriptionKey: 'format.pattern.edit',
  commentSyntax: hashCommentSyntax
};

const gitAttributesFormat: DocumentFormat = {
  id: 'gitattributes',
  labelKey: 'format.gitattributes.label',
  extensions: getSupportedExtensions('gitattributes', ['gitattributes']),
  defaultExtension: 'gitattributes',
  validatesSyntax: true,
  renderDescriptionKey: 'format.pattern.render',
  editDescriptionKey: 'format.pattern.edit',
  commentSyntax: hashCommentSyntax
};

const gitConfigFormat: DocumentFormat = {
  id: 'gitconfig',
  labelKey: 'format.gitconfig.label',
  extensions: getSupportedExtensions('gitconfig', ['gitconfig', 'gitmodules']),
  defaultExtension: 'gitconfig',
  validatesSyntax: true,
  renderDescriptionKey: 'format.config.render',
  editDescriptionKey: 'format.config.edit',
  commentSyntax: { line: [semicolonLineComment, iniHashLineComment] }
};

const editorConfigFormat: DocumentFormat = {
  id: 'editorconfig',
  labelKey: 'format.editorconfig.label',
  extensions: getSupportedExtensions('editorconfig', ['editorconfig']),
  defaultExtension: 'editorconfig',
  validatesSyntax: true,
  renderDescriptionKey: 'format.config.render',
  editDescriptionKey: 'format.config.edit',
  commentSyntax: { line: [semicolonLineComment, iniHashLineComment] }
};

const npmRcFormat: DocumentFormat = {
  id: 'npmrc',
  labelKey: 'format.npmrc.label',
  extensions: getSupportedExtensions('npmrc', ['npmrc']),
  defaultExtension: 'npmrc',
  validatesSyntax: true,
  renderDescriptionKey: 'format.config.render',
  editDescriptionKey: 'format.config.edit',
  commentSyntax: { line: [semicolonLineComment, iniHashLineComment] }
};

const dockerIgnoreFormat: DocumentFormat = {
  id: 'dockerignore',
  labelKey: 'format.dockerignore.label',
  extensions: getSupportedExtensions('dockerignore', ['dockerignore']),
  defaultExtension: 'dockerignore',
  validatesSyntax: true,
  renderDescriptionKey: 'format.pattern.render',
  editDescriptionKey: 'format.pattern.edit',
  commentSyntax: hashCommentSyntax
};

const ignoreFormat: DocumentFormat = {
  id: 'ignore',
  labelKey: 'format.ignore.label',
  extensions: getSupportedExtensions('ignore', ['ignore']),
  defaultExtension: 'ignore',
  validatesSyntax: true,
  renderDescriptionKey: 'format.pattern.render',
  editDescriptionKey: 'format.pattern.edit',
  commentSyntax: hashCommentSyntax
};

const codeOwnersFormat: DocumentFormat = {
  id: 'codeowners',
  labelKey: 'format.codeowners.label',
  extensions: getSupportedExtensions('codeowners', []),
  defaultExtension: '',
  validatesSyntax: true,
  renderDescriptionKey: 'format.pattern.render',
  editDescriptionKey: 'format.pattern.edit',
  commentSyntax: hashCommentSyntax
};

const gitMessageFormat: DocumentFormat = {
  id: 'gitmessage',
  labelKey: 'format.gitmessage.label',
  extensions: getSupportedExtensions('gitmessage', ['gitmessage']),
  defaultExtension: 'gitmessage',
  validatesSyntax: false,
  renderDescriptionKey: 'format.gitmessage.render',
  editDescriptionKey: 'format.gitmessage.edit',
  commentSyntax: hashCommentSyntax
};

const gitMailmapFormat: DocumentFormat = {
  id: 'gitmailmap',
  labelKey: 'format.gitmailmap.label',
  extensions: getSupportedExtensions('gitmailmap', ['mailmap']),
  defaultExtension: 'mailmap',
  validatesSyntax: true,
  renderDescriptionKey: 'format.identity.render',
  editDescriptionKey: 'format.identity.edit',
  commentSyntax: hashCommentSyntax
};

const gitBlameFormat: DocumentFormat = {
  id: 'gitblame',
  labelKey: 'format.gitblame.label',
  extensions: getSupportedExtensions('gitblame', []),
  defaultExtension: '',
  validatesSyntax: true,
  renderDescriptionKey: 'format.hashlist.render',
  editDescriptionKey: 'format.hashlist.edit',
  commentSyntax: hashCommentSyntax
};

const logFormat: DocumentFormat = {
  id: 'log',
  labelKey: 'format.log.label',
  extensions: getSupportedExtensions('log', ['log']),
  defaultExtension: 'log',
  validatesSyntax: false,
  renderDescriptionKey: 'format.log.render',
  editDescriptionKey: 'format.log.edit'
};

const srtFormat: DocumentFormat = {
  id: 'srt',
  labelKey: 'format.srt.label',
  extensions: getSupportedExtensions('srt', ['srt']),
  defaultExtension: 'srt',
  validatesSyntax: true,
  renderDescriptionKey: 'format.subtitle.render',
  editDescriptionKey: 'format.subtitle.edit'
};

const webVttFormat: DocumentFormat = {
  id: 'webvtt',
  labelKey: 'format.webvtt.label',
  extensions: getSupportedExtensions('webvtt', ['vtt']),
  defaultExtension: 'vtt',
  validatesSyntax: true,
  renderDescriptionKey: 'format.subtitle.render',
  editDescriptionKey: 'format.subtitle.edit'
};

const lrcFormat: DocumentFormat = {
  id: 'lrc',
  labelKey: 'format.lrc.label',
  extensions: getSupportedExtensions('lrc', ['lrc']),
  defaultExtension: 'lrc',
  validatesSyntax: true,
  renderDescriptionKey: 'format.subtitle.render',
  editDescriptionKey: 'format.subtitle.edit'
};

export const configurableDocumentFormats = [
  plainTextFormat,
  markdownFormat,
  jsonFormat,
  jsoncFormat,
  jsonLinesFormat,
  xmlFormat,
  gettextFormat,
  csvFormat,
  tsvFormat,
  yamlFormat,
  tomlFormat,
  iniFormat,
  confFormat,
  propertiesFormat,
  dotenvFormat,
  registryFormat,
  sshConfigFormat,
  systemdFormat,
  hostsFormat,
  gitIgnoreFormat,
  gitAttributesFormat,
  gitConfigFormat,
  editorConfigFormat,
  npmRcFormat,
  dockerIgnoreFormat,
  ignoreFormat,
  codeOwnersFormat,
  gitMessageFormat,
  gitMailmapFormat,
  gitBlameFormat,
  logFormat,
  srtFormat,
  webVttFormat,
  lrcFormat
];

export const configurableDocumentFormatCategories: DocumentFormatCategory[] = [
  {
    id: 'document',
    labelKey: 'category.document.label',
    descriptionKey: 'category.document.description',
    formatIds: ['plain', 'markdown', 'gettext', 'log']
  },
  {
    id: 'structured',
    labelKey: 'category.structured.label',
    descriptionKey: 'category.structured.description',
    formatIds: ['json', 'jsonc', 'jsonlines', 'xml', 'yaml', 'toml', 'ini', 'conf', 'properties', 'dotenv', 'registry', 'sshconfig', 'systemd', 'hosts']
  },
  {
    id: 'project',
    labelKey: 'category.project.label',
    descriptionKey: 'category.project.description',
    formatIds: ['gitignore', 'gitattributes', 'gitconfig', 'gitmessage', 'gitmailmap', 'gitblame', 'editorconfig', 'npmrc', 'dockerignore', 'ignore', 'codeowners']
  },
  {
    id: 'table',
    labelKey: 'category.table.label',
    descriptionKey: 'category.table.description',
    formatIds: ['csv', 'tsv']
  },
  {
    id: 'subtitle',
    labelKey: 'category.subtitle.label',
    descriptionKey: 'category.subtitle.description',
    formatIds: ['srt', 'webvtt', 'lrc']
  }
];

export const productSupportedDocumentFormats = supportedManifestFormats.map((entry) =>
  configurableDocumentFormats.find((format) => format.id === entry.id)
).filter((format): format is DocumentFormat => !!format);

export function createDefaultDocumentFeatureSettings(): DocumentFeatureSettings {
  return {
    plain: { render: true, edit: true },
    markdown: { render: true, edit: true },
    json: { render: true, edit: true },
    jsonc: { render: true, edit: true },
    jsonlines: { render: true, edit: true },
    xml: { render: true, edit: true },
    gettext: { render: true, edit: true },
    csv: { render: true, edit: true },
    tsv: { render: true, edit: true },
    yaml: { render: true, edit: true },
    toml: { render: true, edit: true },
    ini: { render: true, edit: true },
    conf: { render: true, edit: true },
    properties: { render: true, edit: true },
    dotenv: { render: true, edit: true },
    registry: { render: true, edit: true },
    sshconfig: { render: true, edit: true },
    systemd: { render: true, edit: true },
    hosts: { render: true, edit: true },
    gitignore: { render: true, edit: true },
    gitattributes: { render: true, edit: true },
    gitconfig: { render: true, edit: true },
    editorconfig: { render: true, edit: true },
    npmrc: { render: true, edit: true },
    dockerignore: { render: true, edit: true },
    ignore: { render: true, edit: true },
    codeowners: { render: true, edit: true },
    gitmessage: { render: true, edit: true },
    gitmailmap: { render: true, edit: true },
    gitblame: { render: true, edit: true },
    log: { render: true, edit: true },
    srt: { render: true, edit: true },
    webvtt: { render: true, edit: true },
    lrc: { render: true, edit: true }
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
    },
    {
      name: translate(locale, 'filter.allFiles'),
      extensions: ['*']
    }
  ];
}

export function getSaveFileDialogFilters(locale: AppLocale) {
  return [
    ...productSupportedDocumentFormats.filter((format) => format.extensions.length > 0).map((format) => ({
      name: translate(locale, format.labelKey),
      extensions: format.extensions
    })),
    {
      name: translate(locale, 'filter.allSupportedTextFiles'),
      extensions: supportedTextExtensions
    },
    {
      name: translate(locale, 'filter.allFiles'),
      extensions: ['*']
    }
  ];
}

function globPatternToRegExp(pattern: string): RegExp {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] || '';
    const next = pattern[index + 1] || '';
    if (char === '*' && next === '*') {
      if (pattern[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&');
    }
  }
  return new RegExp(`${source}$`, 'u');
}

function matchesManifestEntry(pathOrName: string, entry: SupportedTextFormatManifestEntry): boolean {
  const normalizedPath = pathOrName.split(/[?#]/u)[0].replaceAll('\\', '/');
  const fileName = normalizedPath.split('/').pop() || normalizedPath;
  if (entry.fileNames?.includes(fileName)) return true;
  if (entry.fileNamePatterns?.some((pattern) => globPatternToRegExp(pattern).test(fileName))) return true;
  return entry.pathPatterns?.some((pattern) => globPatternToRegExp(pattern).test(normalizedPath)) ?? false;
}

export function getFileExtension(pathOrName: string | null | undefined): string {
  if (!pathOrName) return '';
  const fileName = pathOrName.split(/[?#]/)[0].split(/[/\\]/).pop() || pathOrName;
  const match = fileName.toLowerCase().match(/\.([^.]+)$/);
  return match?.[1] || '';
}

export function getDocumentFormatForPath(pathOrName: string | null | undefined): DocumentFormat {
  if (pathOrName) {
    const namedEntry = supportedManifestFormats.find((entry) => matchesManifestEntry(pathOrName, entry));
    const namedFormat = configurableDocumentFormats.find((format) => format.id === namedEntry?.id);
    if (namedFormat) return namedFormat;
  }
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

export function looksLikeXmlContent(content: string): boolean {
  return /^(?:<\?xml\b|<!DOCTYPE\b)/iu.test(content.trimStart());
}

export function looksLikeGettextContent(content: string): boolean {
  return /^(?:#[^\n]*\n)*msgid\s+"/u.test(content.trimStart());
}

export function looksLikeRegistryContent(content: string): boolean {
  return /^(?:\uFEFF)?(?:Windows Registry Editor Version 5\.00|REGEDIT4)$/mu.test(content.split(/\r?\n/u)[0] || '');
}

export function getDocumentFormatForContent(
  content: string,
  pathOrName: string | null | undefined
): DocumentFormat {
  const namedFormat = getDocumentFormatForPath(pathOrName);
  if (namedFormat.id !== 'plain') return namedFormat;
  if (looksLikeJsonContent(content)) return jsonFormat;
  if (looksLikeYamlContent(content)) return yamlFormat;
  if (looksLikeXmlContent(content)) return xmlFormat;
  if (looksLikeGettextContent(content)) return gettextFormat;
  if (looksLikeRegistryContent(content)) return registryFormat;
  return namedFormat;
}

export function getSuggestedFileExtensionForContent(content: string): string {
  if (looksLikeJsonContent(content)) return jsonFormat.defaultExtension;
  if (looksLikeYamlContent(content)) return yamlFormat.defaultExtension;
  if (looksLikeXmlContent(content)) return xmlFormat.defaultExtension;
  if (looksLikeGettextContent(content)) return gettextFormat.defaultExtension;
  if (looksLikeRegistryContent(content)) return registryFormat.defaultExtension;
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

function findNextJsonSignificant(content: string, start: number, allowComments: boolean): number {
  let i = start;
  while (i < content.length) {
    while (i < content.length && isJsonWhitespaceChar(content[i])) i += 1;
    if (!allowComments || content[i] !== '/') break;
    if (content[i + 1] === '/') {
      i += 2;
      while (i < content.length && content[i] !== '\r' && content[i] !== '\n') i += 1;
      continue;
    }
    if (content[i + 1] === '*') {
      const end = content.indexOf('*/', i + 2);
      i = end === -1 ? content.length : end + 2;
      continue;
    }
    break;
  }
  return i;
}

function scanJsonTokens(
  content: string,
  range?: { start: number; end: number },
  allowComments = false
): FlatToken[] {
  const tokens: FlatToken[] = [];
  let i = allowComments ? 0 : range ? Math.max(0, Math.min(range.start, content.length)) : 0;
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

    if (allowComments && char === '/' && (content[i + 1] === '/' || content[i + 1] === '*')) {
      const start = i;
      if (content[i + 1] === '/') {
        i += 2;
        while (i < content.length && content[i] !== '\r' && content[i] !== '\n') i += 1;
      } else {
        const end = content.indexOf('*/', i + 2);
        i = end === -1 ? content.length : end + 2;
      }
      const token = { type: 'comment', text: content.slice(start, i), start, end: i } satisfies FlatToken;
      if (shouldKeepFlatToken(token, range)) tokens.push(token);
      continue;
    }

    if (char === '"') {
      const token = readJsonStringToken(content, i);
      if (token.type === 'string' && content[findNextJsonSignificant(content, token.end, allowComments)] === ':') {
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

function getJsonLinesDiagnostic(content: string, locale: AppLocale): DocumentDiagnostic | null {
  const lines = content.split(/\r?\n/u);
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || '';
    if (!line.trim() && index === lines.length - 1) break;
    if (!line.trim()) {
      return {
        severity: 'error',
        message: translate(locale, 'diagnostic.formatSyntax', { format: translate(locale, jsonLinesFormat.labelKey), line: index + 1, column: 1 }),
        line: index + 1,
        column: 1,
        offset
      };
    }
    try {
      JSON.parse(line);
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      const lineOffset = getJsonErrorOffset(line, rawMessage);
      const column = lineOffset + 1;
      return {
        severity: 'error',
        message: translate(locale, 'diagnostic.formatSyntax', { format: translate(locale, jsonLinesFormat.labelKey), line: index + 1, column }),
        line: index + 1,
        column,
        offset: offset + lineOffset
      };
    }
    offset += line.length + 1;
  }
  return null;
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

function getJsoncDiagnostic(content: string, locale: AppLocale): DocumentDiagnostic | null {
  const errors: JsoncParseError[] = [];
  parseJsonc(content, errors, {
    allowTrailingComma: true,
    allowEmptyContent: false,
    disallowComments: false
  });
  const firstError = errors[0];
  if (!firstError) return null;

  const offset = Math.max(0, Math.min(content.length, firstError.offset));
  const position = offsetToLineColumn(content, offset);
  return {
    severity: 'error',
    message: translate(locale, 'diagnostic.formatSyntax', {
      format: translate(locale, jsoncFormat.labelKey),
      line: position.line,
      column: position.column
    }),
    line: position.line,
    column: position.column,
    offset
  };
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
  if (format.id === 'jsonc') return getJsoncDiagnostic(content, options.locale);
  if (format.id === 'jsonlines') return getJsonLinesDiagnostic(content, options.locale);
  if (format.id === 'yaml') return getYamlDiagnostic(content, options.locale);
  if (format.id === 'xml') {
    const position = getXmlDiagnostic(content);
    if (!position) return null;
    return {
      severity: 'error',
      message: translate(options.locale, 'diagnostic.formatSyntax', {
        format: translate(options.locale, format.labelKey),
        line: position.line,
        column: position.column
      }),
      ...position
    };
  }
  if (format.id === 'csv' || format.id === 'tsv') {
    const position = getDelimitedTableSyntaxError(content, format.id === 'csv' ? ',' : '\t');
    if (!position) return null;
    return {
      severity: 'error',
      message: translate(options.locale, 'diagnostic.formatSyntax', {
        format: translate(options.locale, format.labelKey),
        line: position.line,
        column: position.column
      }),
      ...position
    };
  }
  if (['ini', 'properties', 'dotenv', 'srt', 'webvtt', 'lrc'].includes(format.id)) {
    const position = getLineOrientedFormatDiagnostic(content, format.id as LineOrientedFormatId);
    if (!position) return null;
    return {
      severity: 'error',
      message: translate(options.locale, 'diagnostic.formatSyntax', {
        format: translate(options.locale, format.labelKey),
        line: position.line,
        column: position.column
      }),
      ...position
    };
  }
  if (['toml', 'gitignore', 'gitattributes', 'gitconfig', 'editorconfig', 'npmrc', 'dockerignore', 'ignore', 'codeowners'].includes(format.id)) {
    const position = getTextConfigurationDiagnostic(content, format.id as TextConfigurationFormatId);
    if (!position) return null;
    return {
      severity: 'error',
      message: translate(options.locale, 'diagnostic.formatSyntax', {
        format: translate(options.locale, format.labelKey),
        line: position.line,
        column: position.column
      }),
      ...position
    };
  }
  if (['gettext', 'registry', 'sshconfig', 'systemd', 'gitmessage', 'gitmailmap', 'gitblame', 'hosts'].includes(format.id)) {
    const position = getSpecializedTextDiagnostic(content, format.id as SpecializedTextFormatId);
    if (!position) return null;
    return {
      severity: 'error',
      message: translate(options.locale, 'diagnostic.formatSyntax', {
        format: translate(options.locale, format.labelKey),
        line: position.line,
        column: position.column
      }),
      ...position
    };
  }
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

  if (format.id === 'json' || format.id === 'jsonc' || format.id === 'jsonlines') {
    return {
      format,
      lines: splitFlatTokensIntoLines(
        content,
        scanJsonTokens(content, lineRangeOffsets, format.id === 'jsonc'),
        options.tabSize,
        options.lineStartOffsets,
        lineRange,
        getJsonRenderDepth
      ),
      diagnostic: null
    };
  }

  if (format.id === 'xml') {
    return {
      format,
      lines: parseXmlFormat(content, {
        tabSize: options.tabSize,
        lineStartOffsets: options.lineStartOffsets,
        lineRange
      }, options.renderCache?.xml),
      diagnostic: null
    };
  }

  if (['toml', 'gitignore', 'gitattributes', 'gitconfig', 'editorconfig', 'npmrc', 'dockerignore', 'ignore', 'codeowners'].includes(format.id)) {
    return {
      format,
      lines: parseTextConfigurationFormat(content, format.id as TextConfigurationFormatId, {
        tabSize: options.tabSize,
        lineStartOffsets: options.lineStartOffsets,
        lineRange
      }),
      diagnostic: null
    };
  }

  if (['gettext', 'registry', 'sshconfig', 'systemd', 'gitmessage', 'gitmailmap', 'gitblame', 'hosts'].includes(format.id)) {
    return {
      format,
      lines: parseSpecializedTextFormat(content, format.id as SpecializedTextFormatId, {
        tabSize: options.tabSize,
        lineStartOffsets: options.lineStartOffsets,
        lineRange
      }),
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

  if (['markdown', 'ini', 'conf', 'properties', 'dotenv', 'log', 'srt', 'webvtt', 'lrc'].includes(format.id)) {
    return {
      format,
      lines: parseLineOrientedFormat(content, format.id as LineOrientedFormatId, {
        tabSize: options.tabSize,
        lineStartOffsets: options.lineStartOffsets,
        lineRange,
        hideMarkdownHeadingMarkers: options.markdownSettings?.hideHeadingMarkers ?? true,
        commentSyntax: format.commentSyntax || null
      }),
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
