import {
  configurableDocumentFormats,
  normalizeDocumentFeatureSettings,
  type DocumentFeatureSettings
} from './document-formats';
import { isAppLocale, type LanguagePreference } from './i18n';
import { normalizeAutoPairAllowedFollowingStrings } from './auto-pair';
import {
  markdownHeadingLevels,
  normalizeMarkdownRenderSettings,
  type MarkdownRenderSettings
} from './markdown-settings';

export const settingsFileFormat = 'text-pad-settings';
export const settingsSchemaVersion = 1;
export const maximumSettingsFileBytes = 1024 * 1024;

export type ThemeMode = 'system' | 'light' | 'dark';

export interface SettingsThemePalette {
  codeBg: string;
  codeText: string;
  keyStrong: string;
  keyMedium: string;
  keyLight: string;
  string: string;
  number: string;
  listMarker: string;
  comment: string;
  guide: string;
  renderBg: string;
  renderText: string;
  renderFontWeight: string;
  paren: string;
  bracket: string;
  brace: string;
}

export interface AppSettingsSnapshot {
  general: {
    language: LanguagePreference;
    theme: ThemeMode;
  };
  source: {
    fontSize: number;
  };
  render: {
    fontSize: number;
    indentWidth: number;
    fontFamily: string;
    editing: {
      autoPair: boolean;
      autoPairAllowedFollowingStrings: string[];
      autoSymbols: boolean;
      preserveIndent: boolean;
    };
    colors: {
      light: SettingsThemePalette;
      dark: SettingsThemePalette;
    };
    formats: {
      features: DocumentFeatureSettings;
      markdown: MarkdownRenderSettings;
      table: {
        highlightHeader: boolean;
        showRowIndices: boolean;
        animateReorder: boolean;
        reorderDurationMs: number;
      };
    };
  };
}

export type SettingsImportErrorReason =
  | 'invalid_json'
  | 'invalid_structure'
  | 'unsupported_format'
  | 'file_too_large';

export type SettingsImportResult =
  | {
      ok: true;
      settings: AppSettingsSnapshot;
      sourceVersion: number;
      applied: number;
      skipped: number;
      newerVersion: boolean;
    }
  | {
      ok: false;
      reason: SettingsImportErrorReason;
    };

interface ImportStatistics {
  applied: number;
  skipped: number;
}

type UnknownRecord = Record<string, unknown>;

const colorFields = [
  'codeBg',
  'codeText',
  'keyStrong',
  'keyMedium',
  'keyLight',
  'string',
  'number',
  'listMarker',
  'comment',
  'guide',
  'renderBg',
  'renderText',
  'paren',
  'bracket',
  'brace'
] as const satisfies readonly (Exclude<keyof SettingsThemePalette, 'renderFontWeight'>)[];

const themeWeights = new Set(['300', '400', '500', '600', '700']);
const markdownWeights = new Set(['400', '500', '600', '700', '800']);
const renderFontFamilies = new Set([
  'nanum-gothic',
  'notepad',
  'jetbrains-mono',
  'd2coding',
  'nanum-gothic-coding',
  'fira-code',
  'roboto-mono',
  'cascadia-mono',
  'consolas'
]);
const hexColorPattern = /^#[0-9a-fA-F]{6}$/;
const hasOwn = (record: UnknownRecord, key: string) => Object.prototype.hasOwnProperty.call(record, key);

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function cloneSettings(settings: AppSettingsSnapshot): AppSettingsSnapshot {
  return {
    general: { ...settings.general },
    source: { ...settings.source },
    render: {
      ...settings.render,
      editing: {
        ...settings.render.editing,
        autoPairAllowedFollowingStrings: [...settings.render.editing.autoPairAllowedFollowingStrings]
      },
      colors: {
        light: { ...settings.render.colors.light },
        dark: { ...settings.render.colors.dark }
      },
      formats: {
        features: normalizeDocumentFeatureSettings(settings.render.formats.features),
        markdown: normalizeMarkdownRenderSettings(settings.render.formats.markdown),
        table: { ...settings.render.formats.table }
      }
    }
  };
}

function markUnknownKeys(record: UnknownRecord, allowedKeys: readonly string[], statistics: ImportStatistics) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) statistics.skipped += 1;
  }
}

function getSection(
  record: UnknownRecord,
  key: string,
  statistics: ImportStatistics
): UnknownRecord | null {
  if (!hasOwn(record, key)) return null;
  const section = asRecord(record[key]);
  if (!section) statistics.skipped += 1;
  return section;
}

function applyValue<T>(
  record: UnknownRecord,
  key: string,
  normalize: (value: unknown) => T | null,
  apply: (value: T) => void,
  statistics: ImportStatistics
) {
  if (!hasOwn(record, key)) return;
  const normalized = normalize(record[key]);
  if (normalized === null) {
    statistics.skipped += 1;
    return;
  }
  apply(normalized);
  statistics.applied += 1;
}

function normalizeBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function normalizeBoundedNumber(value: unknown, minimum: number, maximum: number, step = 1): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const stepped = Math.round(value / step) * step;
  return Math.max(minimum, Math.min(maximum, stepped));
}

function normalizeLanguage(value: unknown): LanguagePreference | null {
  return value === 'system' || (typeof value === 'string' && isAppLocale(value)) ? value : null;
}

function normalizeTheme(value: unknown): ThemeMode | null {
  return value === 'system' || value === 'light' || value === 'dark' ? value : null;
}

function normalizeFontFamily(value: unknown): string | null {
  return typeof value === 'string' && renderFontFamilies.has(value) ? value : null;
}

function normalizeHexColor(value: unknown): string | null {
  return typeof value === 'string' && hexColorPattern.test(value) ? value.toUpperCase() : null;
}

function normalizeWeight(value: unknown, weights: Set<string>): string | null {
  return typeof value === 'string' && weights.has(value) ? value : null;
}

function applyPalette(
  candidate: UnknownRecord,
  target: SettingsThemePalette,
  statistics: ImportStatistics
) {
  markUnknownKeys(candidate, [...colorFields, 'renderFontWeight'], statistics);
  for (const field of colorFields) {
    applyValue(candidate, field, normalizeHexColor, (value) => target[field] = value, statistics);
  }
  applyValue(
    candidate,
    'renderFontWeight',
    (value) => normalizeWeight(value, themeWeights),
    (value) => target.renderFontWeight = value,
    statistics
  );
}

function applyDocumentFeatures(
  candidate: UnknownRecord,
  target: DocumentFeatureSettings,
  statistics: ImportStatistics
) {
  const knownFormatIds = configurableDocumentFormats.map((format) => format.id);
  markUnknownKeys(candidate, knownFormatIds, statistics);
  for (const format of configurableDocumentFormats) {
    if (!hasOwn(candidate, format.id)) continue;
    const formatSettings = asRecord(candidate[format.id]);
    if (!formatSettings) {
      statistics.skipped += 1;
      continue;
    }
    markUnknownKeys(formatSettings, ['render', 'edit'], statistics);
    applyValue(formatSettings, 'render', normalizeBoolean, (value) => target[format.id].render = value, statistics);
    applyValue(formatSettings, 'edit', normalizeBoolean, (value) => target[format.id].edit = value, statistics);
  }
}

function applyMarkdownSettings(
  candidate: UnknownRecord,
  target: MarkdownRenderSettings,
  statistics: ImportStatistics
) {
  markUnknownKeys(candidate, ['hideHeadingMarkers', 'showHeadingDividers', 'headings'], statistics);
  applyValue(
    candidate,
    'hideHeadingMarkers',
    normalizeBoolean,
    (value) => target.hideHeadingMarkers = value,
    statistics
  );
  applyValue(
    candidate,
    'showHeadingDividers',
    normalizeBoolean,
    (value) => target.showHeadingDividers = value,
    statistics
  );

  const headings = getSection(candidate, 'headings', statistics);
  if (!headings) return;
  markUnknownKeys(headings, markdownHeadingLevels.map(String), statistics);
  for (const level of markdownHeadingLevels) {
    const heading = getSection(headings, String(level), statistics);
    if (!heading) continue;
    markUnknownKeys(heading, ['sizePercent', 'fontWeight'], statistics);
    applyValue(
      heading,
      'sizePercent',
      (value) => normalizeBoundedNumber(value, 80, 145),
      (value) => target.headings[level].sizePercent = value,
      statistics
    );
    applyValue(
      heading,
      'fontWeight',
      (value) => normalizeWeight(value, markdownWeights) as MarkdownRenderSettings['headings'][typeof level]['fontWeight'] | null,
      (value) => target.headings[level].fontWeight = value,
      statistics
    );
  }
}

function assignLegacyValue(target: UnknownRecord, key: string, source: UnknownRecord, sourceKey: string) {
  if (hasOwn(source, sourceKey)) target[key] = source[sourceKey];
}

function migrateLegacySettings(candidate: UnknownRecord): UnknownRecord {
  if (hasOwn(candidate, 'general') || hasOwn(candidate, 'source') || hasOwn(candidate, 'render')) {
    return candidate;
  }

  const general: UnknownRecord = {};
  const source: UnknownRecord = {};
  const render: UnknownRecord = {};
  const editing: UnknownRecord = {};
  const colors: UnknownRecord = {};
  const formats: UnknownRecord = {};
  const table: UnknownRecord = {};

  assignLegacyValue(general, 'language', candidate, 'languagePreference');
  assignLegacyValue(general, 'theme', candidate, 'themeMode');
  assignLegacyValue(source, 'fontSize', candidate, 'sourceFontSize');
  assignLegacyValue(render, 'fontSize', candidate, 'renderFontSize');
  assignLegacyValue(render, 'indentWidth', candidate, 'tabSize');
  assignLegacyValue(render, 'fontFamily', candidate, 'renderFontFamily');
  assignLegacyValue(editing, 'autoPair', candidate, 'renderAutoPairEditing');
  assignLegacyValue(
    editing,
    'autoPairAllowedFollowingStrings',
    candidate,
    'renderAutoPairAllowedFollowingStrings'
  );
  assignLegacyValue(editing, 'autoSymbols', candidate, 'renderAutoSymbolSubstitution');
  assignLegacyValue(editing, 'preserveIndent', candidate, 'renderPreserveIndentOnEnter');
  assignLegacyValue(colors, 'light', candidate, 'lightColors');
  assignLegacyValue(colors, 'dark', candidate, 'darkColors');
  assignLegacyValue(formats, 'features', candidate, 'documentFeatureSettings');
  assignLegacyValue(formats, 'markdown', candidate, 'markdownRenderSettings');
  assignLegacyValue(table, 'highlightHeader', candidate, 'delimitedTableHighlightHeader');
  assignLegacyValue(table, 'showRowIndices', candidate, 'delimitedTableShowRowIndices');
  assignLegacyValue(table, 'animateReorder', candidate, 'delimitedTableAnimateReorder');
  assignLegacyValue(table, 'reorderDurationMs', candidate, 'delimitedTableReorderDurationMs');

  if (Object.keys(editing).length > 0) render.editing = editing;
  if (Object.keys(colors).length > 0) render.colors = colors;
  if (Object.keys(table).length > 0) formats.table = table;
  if (Object.keys(formats).length > 0) render.formats = formats;

  const migrated: UnknownRecord = {};
  if (Object.keys(general).length > 0) migrated.general = general;
  if (Object.keys(source).length > 0) migrated.source = source;
  if (Object.keys(render).length > 0) migrated.render = render;
  return migrated;
}

function applySettingsCandidate(
  candidate: UnknownRecord,
  current: AppSettingsSnapshot
): { settings: AppSettingsSnapshot; statistics: ImportStatistics } {
  const settings = cloneSettings(current);
  const statistics: ImportStatistics = { applied: 0, skipped: 0 };
  markUnknownKeys(candidate, ['general', 'source', 'render'], statistics);

  const general = getSection(candidate, 'general', statistics);
  if (general) {
    markUnknownKeys(general, ['language', 'theme'], statistics);
    applyValue(general, 'language', normalizeLanguage, (value) => settings.general.language = value, statistics);
    applyValue(general, 'theme', normalizeTheme, (value) => settings.general.theme = value, statistics);
  }

  const source = getSection(candidate, 'source', statistics);
  if (source) {
    markUnknownKeys(source, ['fontSize'], statistics);
    applyValue(
      source,
      'fontSize',
      (value) => normalizeBoundedNumber(value, 6, 72),
      (value) => settings.source.fontSize = value,
      statistics
    );
  }

  const render = getSection(candidate, 'render', statistics);
  if (!render) return { settings, statistics };
  markUnknownKeys(render, ['fontSize', 'indentWidth', 'fontFamily', 'editing', 'colors', 'formats'], statistics);
  applyValue(
    render,
    'fontSize',
    (value) => normalizeBoundedNumber(value, 6, 72),
    (value) => settings.render.fontSize = value,
    statistics
  );
  applyValue(
    render,
    'indentWidth',
    (value) => value === 2 || value === 4 || value === 8 ? value : null,
    (value) => settings.render.indentWidth = value,
    statistics
  );
  applyValue(render, 'fontFamily', normalizeFontFamily, (value) => settings.render.fontFamily = value, statistics);

  const editing = getSection(render, 'editing', statistics);
  if (editing) {
    markUnknownKeys(
      editing,
      ['autoPair', 'autoPairAllowedFollowingStrings', 'autoSymbols', 'preserveIndent'],
      statistics
    );
    applyValue(editing, 'autoPair', normalizeBoolean, (value) => settings.render.editing.autoPair = value, statistics);
    applyValue(
      editing,
      'autoPairAllowedFollowingStrings',
      normalizeAutoPairAllowedFollowingStrings,
      (value) => settings.render.editing.autoPairAllowedFollowingStrings = value,
      statistics
    );
    applyValue(editing, 'autoSymbols', normalizeBoolean, (value) => settings.render.editing.autoSymbols = value, statistics);
    applyValue(editing, 'preserveIndent', normalizeBoolean, (value) => settings.render.editing.preserveIndent = value, statistics);
  }

  const colors = getSection(render, 'colors', statistics);
  if (colors) {
    markUnknownKeys(colors, ['light', 'dark'], statistics);
    const light = getSection(colors, 'light', statistics);
    if (light) applyPalette(light, settings.render.colors.light, statistics);
    const dark = getSection(colors, 'dark', statistics);
    if (dark) applyPalette(dark, settings.render.colors.dark, statistics);
  }

  const formats = getSection(render, 'formats', statistics);
  if (formats) {
    markUnknownKeys(formats, ['features', 'markdown', 'table'], statistics);
    const features = getSection(formats, 'features', statistics);
    if (features) applyDocumentFeatures(features, settings.render.formats.features, statistics);
    const markdown = getSection(formats, 'markdown', statistics);
    if (markdown) applyMarkdownSettings(markdown, settings.render.formats.markdown, statistics);
    const table = getSection(formats, 'table', statistics);
    if (table) {
      markUnknownKeys(table, ['highlightHeader', 'showRowIndices', 'animateReorder', 'reorderDurationMs'], statistics);
      applyValue(table, 'highlightHeader', normalizeBoolean, (value) => settings.render.formats.table.highlightHeader = value, statistics);
      applyValue(table, 'showRowIndices', normalizeBoolean, (value) => settings.render.formats.table.showRowIndices = value, statistics);
      applyValue(table, 'animateReorder', normalizeBoolean, (value) => settings.render.formats.table.animateReorder = value, statistics);
      applyValue(
        table,
        'reorderDurationMs',
        (value) => normalizeBoundedNumber(value, 50, 2000, 50),
        (value) => settings.render.formats.table.reorderDurationMs = value,
        statistics
      );
    }
  }

  return { settings, statistics };
}

export function serializeSettingsFile(
  settings: AppSettingsSnapshot,
  appVersion: string,
  exportedAt = new Date()
): string {
  return JSON.stringify({
    format: settingsFileFormat,
    schemaVersion: settingsSchemaVersion,
    appVersion,
    exportedAt: exportedAt.toISOString(),
    settings
  }, null, 2);
}

export function parseSettingsFile(
  content: string,
  current: AppSettingsSnapshot
): SettingsImportResult {
  if (new TextEncoder().encode(content).byteLength > maximumSettingsFileBytes) {
    return { ok: false, reason: 'file_too_large' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  const document = asRecord(parsed);
  if (!document) return { ok: false, reason: 'invalid_structure' };
  if (hasOwn(document, 'format') && document.format !== settingsFileFormat) {
    return { ok: false, reason: 'unsupported_format' };
  }

  let sourceVersion = 0;
  let candidate: UnknownRecord | null = null;
  if (hasOwn(document, 'format')) {
    if (!Number.isInteger(document.schemaVersion) || (document.schemaVersion as number) < 1) {
      return { ok: false, reason: 'invalid_structure' };
    }
    sourceVersion = document.schemaVersion as number;
    candidate = asRecord(document.settings);
  } else if (hasOwn(document, 'settings')) {
    if (hasOwn(document, 'schemaVersion')) {
      if (!Number.isInteger(document.schemaVersion) || (document.schemaVersion as number) < 0) {
        return { ok: false, reason: 'invalid_structure' };
      }
      sourceVersion = document.schemaVersion as number;
    }
    const legacySettings = asRecord(document.settings);
    candidate = legacySettings ? migrateLegacySettings(legacySettings) : null;
  } else {
    candidate = migrateLegacySettings(document);
  }

  if (!candidate || (!hasOwn(document, 'format') && Object.keys(candidate).length === 0)) {
    return { ok: false, reason: 'invalid_structure' };
  }
  const { settings, statistics } = applySettingsCandidate(candidate, current);
  return {
    ok: true,
    settings,
    sourceVersion,
    applied: statistics.applied,
    skipped: statistics.skipped,
    newerVersion: sourceVersion > settingsSchemaVersion
  };
}
