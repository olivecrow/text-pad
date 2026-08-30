import {
  normalizeSettingsSnapshot,
  parseSettingsFile,
  serializeSettingsSnapshot,
  settingsThemePaletteFields,
  type AppSettingsSnapshot,
  type SettingsThemePalette
} from './settings-transfer';

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SettingsRepositoryLoadOptions {
  legacySystemIsDark?: boolean;
}

export const settingsStorageKey = 'text-pad.settings';

const legacyScalarStorageKeys = [
  'pref_language',
  'pref_default_new_document_format',
  'pref_theme_mode',
  'pref_source_font_size',
  'pref_render_font_size',
  'pref_tab_size',
  'pref_render_auto_pair_editing',
  'pref_render_auto_pair_allowed_following_strings',
  'pref_render_auto_symbol_substitution',
  'pref_render_preserve_indent_on_enter',
  'pref_delimited_table_highlight_header',
  'pref_delimited_table_show_row_indices',
  'pref_delimited_table_animate_reorder',
  'pref_delimited_table_reorder_duration_ms',
  'pref_document_format_features',
  'pref_markdown_render_settings',
  'pref_render_font_family'
] as const;

const legacySingleThemeStorageKeys = [
  'pref_color_hl_code_bg',
  'pref_color_hl_code_text',
  'pref_color_hl_string',
  'pref_color_hl_number',
  'pref_color_hl_comment',
  'pref_color_indent_guide',
  'pref_color_render_bg',
  'pref_color_render_text',
  'pref_color_hl_paren',
  'pref_color_hl_bracket',
  'pref_color_hl_brace'
] as const;

export const legacySettingsStorageKeys: readonly string[] = [
  ...legacyScalarStorageKeys,
  ...settingsThemePaletteFields.flatMap((field) => [`pref_light_${field}`, `pref_dark_${field}`]),
  ...legacySingleThemeStorageKeys
];

const legacySingleThemeKeyByField: Partial<Record<keyof SettingsThemePalette, string>> = {
  codeBg: 'pref_color_hl_code_bg',
  codeText: 'pref_color_hl_code_text',
  string: 'pref_color_hl_string',
  number: 'pref_color_hl_number',
  comment: 'pref_color_hl_comment',
  guide: 'pref_color_indent_guide',
  renderBg: 'pref_color_render_bg',
  renderText: 'pref_color_render_text',
  paren: 'pref_color_hl_paren',
  bracket: 'pref_color_hl_bracket',
  brace: 'pref_color_hl_brace'
};

const previousLightCodeBgDefault = '#f1f5f9';
const previousDarkCodeTextDefaults = new Set(['#38bdf8', '#4fc1ff']);

type LegacySettingsCandidate = Record<string, unknown>;

function parseStoredSettings(
  content: string,
  defaults: AppSettingsSnapshot
): AppSettingsSnapshot | null {
  const parsed = parseSettingsFile(content, defaults);
  return parsed.ok ? parsed.settings : null;
}

function readLegacyValues(storage: SettingsStorage): Map<string, string> | null {
  const values = new Map<string, string>();
  for (const key of legacySettingsStorageKeys) {
    try {
      const value = storage.getItem(key);
      if (value !== null) values.set(key, value);
    } catch {
      return null;
    }
  }
  return values;
}

function assignLegacyString(
  candidate: LegacySettingsCandidate,
  targetKey: string,
  values: ReadonlyMap<string, string>,
  storageKey: string
) {
  const value = values.get(storageKey);
  if (value !== undefined) candidate[targetKey] = value;
}

function assignLegacyNumber(
  candidate: LegacySettingsCandidate,
  targetKey: string,
  values: ReadonlyMap<string, string>,
  storageKey: string
) {
  const value = values.get(storageKey);
  if (value === undefined || value.trim() === '') return;
  const parsed = Number(value);
  if (Number.isFinite(parsed)) candidate[targetKey] = parsed;
}

function assignLegacyBoolean(
  candidate: LegacySettingsCandidate,
  targetKey: string,
  values: ReadonlyMap<string, string>,
  storageKey: string
) {
  const value = values.get(storageKey);
  if (value === 'true') candidate[targetKey] = true;
  if (value === 'false') candidate[targetKey] = false;
}

function assignLegacyJson(
  candidate: LegacySettingsCandidate,
  targetKey: string,
  values: ReadonlyMap<string, string>,
  storageKey: string
) {
  const value = values.get(storageKey);
  if (value === undefined) return;
  try {
    candidate[targetKey] = JSON.parse(value);
  } catch {
    // 잘못된 이전 값은 공용 정규화 기본값으로 대체한다.
  }
}

function readLegacyPalette(
  theme: 'light' | 'dark',
  values: ReadonlyMap<string, string>,
  defaults: SettingsThemePalette,
  useSingleThemeFallback: boolean
): Partial<SettingsThemePalette> | null {
  const palette: Partial<SettingsThemePalette> = {};

  for (const field of settingsThemePaletteFields) {
    let value = values.get(`pref_${theme}_${field}`);
    if (value === undefined && theme === 'dark' && useSingleThemeFallback) {
      const fallbackKey = legacySingleThemeKeyByField[field];
      if (fallbackKey) value = values.get(fallbackKey);
    }
    if (value === undefined) continue;

    if (theme === 'light' && field === 'codeBg' && value.toLowerCase() === previousLightCodeBgDefault) {
      value = defaults.codeBg;
    }
    if (theme === 'dark' && field === 'codeText' && previousDarkCodeTextDefaults.has(value.toLowerCase())) {
      value = defaults.codeText;
    }
    palette[field] = value;
  }

  return Object.keys(palette).length > 0 ? palette : null;
}

function readLegacySettings(
  storage: SettingsStorage,
  defaults: AppSettingsSnapshot,
  options: SettingsRepositoryLoadOptions
): { found: boolean; candidate: LegacySettingsCandidate } {
  const values = readLegacyValues(storage);
  const candidate: LegacySettingsCandidate = {};
  if (!values) return { found: false, candidate };

  assignLegacyString(candidate, 'languagePreference', values, 'pref_language');
  assignLegacyString(candidate, 'defaultNewDocumentFormatId', values, 'pref_default_new_document_format');
  assignLegacyString(candidate, 'themeMode', values, 'pref_theme_mode');
  assignLegacyNumber(candidate, 'sourceFontSize', values, 'pref_source_font_size');
  assignLegacyNumber(candidate, 'renderFontSize', values, 'pref_render_font_size');
  assignLegacyNumber(candidate, 'tabSize', values, 'pref_tab_size');
  assignLegacyBoolean(candidate, 'renderAutoPairEditing', values, 'pref_render_auto_pair_editing');
  assignLegacyJson(
    candidate,
    'renderAutoPairAllowedFollowingStrings',
    values,
    'pref_render_auto_pair_allowed_following_strings'
  );
  assignLegacyBoolean(candidate, 'renderAutoSymbolSubstitution', values, 'pref_render_auto_symbol_substitution');
  assignLegacyBoolean(candidate, 'renderPreserveIndentOnEnter', values, 'pref_render_preserve_indent_on_enter');
  assignLegacyBoolean(candidate, 'delimitedTableHighlightHeader', values, 'pref_delimited_table_highlight_header');
  assignLegacyBoolean(candidate, 'delimitedTableShowRowIndices', values, 'pref_delimited_table_show_row_indices');
  assignLegacyBoolean(candidate, 'delimitedTableAnimateReorder', values, 'pref_delimited_table_animate_reorder');
  assignLegacyNumber(
    candidate,
    'delimitedTableReorderDurationMs',
    values,
    'pref_delimited_table_reorder_duration_ms'
  );
  assignLegacyJson(candidate, 'documentFeatureSettings', values, 'pref_document_format_features');
  assignLegacyJson(candidate, 'markdownRenderSettings', values, 'pref_markdown_render_settings');
  assignLegacyString(candidate, 'renderFontFamily', values, 'pref_render_font_family');

  const lightColors = readLegacyPalette('light', values, defaults.render.colors.light, false);
  const darkColors = readLegacyPalette(
    'dark',
    values,
    defaults.render.colors.dark,
    options.legacySystemIsDark === true
  );
  if (lightColors) candidate.lightColors = lightColors;
  if (darkColors) candidate.darkColors = darkColors;

  return { found: values.size > 0, candidate };
}

export class SettingsRepository {
  readonly storageKey: string;
  private defaults: AppSettingsSnapshot | null = null;
  private lastSerialized: string | null = null;

  constructor(
    private readonly storage: SettingsStorage,
    storageKey = settingsStorageKey
  ) {
    this.storageKey = storageKey;
  }

  load(
    defaults: AppSettingsSnapshot,
    options: SettingsRepositoryLoadOptions = {}
  ): AppSettingsSnapshot {
    this.defaults = normalizeSettingsSnapshot(defaults, defaults);
    const stored = this.read(this.storageKey);
    if (stored !== null) {
      const parsed = parseStoredSettings(stored, this.defaults);
      if (parsed) {
        // 더 새 버전의 알 수 없는 필드는 사용자가 실제로 설정을 바꾸기 전까지 보존한다.
        this.lastSerialized = serializeSettingsSnapshot(parsed);
        return parsed;
      }
    }

    const legacy = readLegacySettings(this.storage, this.defaults, options);
    if (legacy.found) {
      const migrated = normalizeSettingsSnapshot(legacy.candidate, this.defaults);
      if (this.write(migrated)) this.removeLegacySettings();
      return migrated;
    }

    this.lastSerialized = null;
    return normalizeSettingsSnapshot(this.defaults, this.defaults);
  }

  save(settings: AppSettingsSnapshot): boolean {
    if (!this.defaults) this.defaults = normalizeSettingsSnapshot(settings, settings);
    const normalized = normalizeSettingsSnapshot(settings, this.defaults);
    const serialized = serializeSettingsSnapshot(normalized);
    if (serialized === this.lastSerialized) return true;
    return this.writeSerialized(serialized);
  }

  parseStorageValue(value: string | null): AppSettingsSnapshot | null {
    if (value === null || !this.defaults) return null;
    const parsed = parseStoredSettings(value, this.defaults);
    if (!parsed) return null;
    this.lastSerialized = serializeSettingsSnapshot(parsed);
    return parsed;
  }

  private read(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  private write(settings: AppSettingsSnapshot): boolean {
    return this.writeSerialized(serializeSettingsSnapshot(settings));
  }

  private writeSerialized(serialized: string): boolean {
    try {
      this.storage.setItem(this.storageKey, serialized);
      this.lastSerialized = serialized;
      return true;
    } catch {
      return false;
    }
  }

  private removeLegacySettings() {
    for (const key of legacySettingsStorageKeys) {
      try {
        this.storage.removeItem(key);
      } catch {
        // 새 스냅샷 저장이 끝났으므로 지우지 못한 이전 키는 다음 실행에서 무시한다.
      }
    }
  }
}
