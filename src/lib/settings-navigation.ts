import {
  configurableDocumentFormatCategories,
  configurableDocumentFormats,
  type DocumentFormatCategoryId,
  type DocumentFormatId
} from './document-formats';
import { translate, type AppLocale, type TranslationKey } from './i18n';
import { additionalRenderThemeFields } from './render-theme-fields';
import type { SettingsThemePalette } from './settings-transfer';

export type SettingsView = 'general' | 'sourceAppearance' | 'renderAppearance' | 'renderColors'
  | 'renderEditing' | 'transfer' | `category:${DocumentFormatCategoryId}` | `format:${DocumentFormatId}`;
export type ColorField = Exclude<keyof SettingsThemePalette, 'renderFontWeight'>;
type ColorSetting = { field: ColorField; label: TranslationKey; id: string };

const baseColorSettings: ColorSetting[] = [
  { field: 'renderBg', label: 'settings.color.renderBackground', id: 'render-bg' },
  { field: 'renderText', label: 'settings.color.renderText', id: 'render-text' },
  { field: 'guide', label: 'settings.color.indentGuide', id: 'indent-guide' },
  { field: 'codeBg', label: 'settings.color.codeBackground', id: 'hl-code-bg' },
  { field: 'codeText', label: 'settings.color.codeText', id: 'hl-code-text' },
  { field: 'keyStrong', label: 'settings.color.keyStrong', id: 'hl-key-strong' },
  { field: 'keyMedium', label: 'settings.color.keyMedium', id: 'hl-key-medium' },
  { field: 'keyLight', label: 'settings.color.keyLight', id: 'hl-key-light' },
  { field: 'string', label: 'settings.color.string', id: 'hl-string' },
  { field: 'number', label: 'settings.color.number', id: 'hl-number' },
  { field: 'listMarker', label: 'settings.color.listMarker', id: 'hl-list-marker' },
  { field: 'comment', label: 'settings.color.comment', id: 'hl-comment' },
  { field: 'paren', label: 'settings.color.parenthesis', id: 'hl-paren' },
  { field: 'bracket', label: 'settings.color.bracket', id: 'hl-bracket' },
  { field: 'brace', label: 'settings.color.brace', id: 'hl-brace' }
];
const allColorSettings: ColorSetting[] = [
  ...baseColorSettings,
  ...additionalRenderThemeFields.map(item => ({ field: item.field, label: item.label, id: item.field }))
];

function colorGroup(field: ColorField): string {
  if (field.startsWith('script')) return 'scripts';
  if (field.startsWith('boolean')) return 'values';
  if (field.startsWith('table')) return 'table';
  if (['error', 'warning', 'success', 'colorBorder'].includes(field)) return 'feedback';
  if (['renderBg', 'renderText', 'guide', 'selection', 'caret', 'gutterText', 'gutterBorder', 'searchHighlight', 'searchCurrentHighlight'].includes(field)) return 'editor';
  return 'syntax';
}

export const settingsColorGroups = ([
  { id: 'editor', label: 'settings.colors.editor' },
  { id: 'syntax', label: 'settings.colors.syntax' },
  { id: 'scripts', label: 'settings.colors.scripts' },
  { id: 'values', label: 'settings.colors.values' },
  { id: 'feedback', label: 'settings.colors.feedback' },
  { id: 'table', label: 'category.table.label' }
] satisfies { id: string; label: TranslationKey }[]).map(group => ({
  ...group,
  fields: allColorSettings.filter(item => colorGroup(item.field) === group.id)
}));

export interface SettingsPage {
  id: SettingsView;
  title: string;
  path: string[];
  description: string;
  terms: string[];
}

export function getSettingsPages(locale: AppLocale): SettingsPage[] {
  const t = (key: TranslationKey) => translate(locale, key);
  const page = (id: SettingsView, title: TranslationKey, path: TranslationKey[], description: TranslationKey,
    keys: TranslationKey[], aliases = ''): SettingsPage => ({
    id, title: t(title), path: path.map(t), description: t(description),
    terms: [...keys.map(t), ...keys.map(key => translate('en', key)),
      translate('en', title), ...path.map(key => translate('en', key)), translate('en', description), aliases]
  });
  const pages: SettingsPage[] = [
    page('general', 'settings.general', [], 'settings.generalDescription', [
      'settings.languageLabel', 'settings.languageDescription', 'settings.defaultNewDocumentFormat',
      'settings.defaultNewDocumentFormatDescription'
    ], 'language locale system new document default format 언어 기본 새 문서'),
    page('sourceAppearance', 'settings.fontSettings', ['settings.editor', 'settings.sourceMode'], 'settings.sourceDescription', [
      'settings.fontSize'
    ], 'source font size 원문 글꼴 크기'),
    page('renderAppearance', 'settings.fontSettings', ['settings.editor', 'settings.renderMode'], 'settings.fontDescription', [
      'settings.fontSize', 'settings.renderFont', 'settings.indentWidth'
    ], 'render font typography indentation 글꼴 폰트 들여쓰기'),
    page('renderColors', 'settings.colors', ['settings.editor', 'settings.renderMode'], 'settings.colorsDescription', [
      ...allColorSettings.map(item => item.label), ...settingsColorGroups.map(group => group.label),
      'settings.fontWeight', 'settings.resetColors', 'settings.themeLight', 'settings.themeDark'
    ], 'color colour theme palette light dark 색상 테마'),
    page('renderEditing', 'settings.editing', ['settings.editor', 'settings.renderMode'], 'settings.editingDescription', [
      'settings.autoPair.title', 'settings.autoPair.description', 'settings.autoPair.followingTitle',
      'settings.autoPair.followingDescription', 'settings.autoSymbols.title', 'settings.autoSymbols.description',
      'settings.preserveIndent.title', 'settings.preserveIndent.description'
    ], 'typing auto pair brackets quotes indent enter 편집 괄호 따옴표 자동 입력'),
    page('transfer', 'settings.transfer.title', [], 'settings.transfer.description', [
      'settings.transfer.import', 'settings.transfer.export'
    ], 'backup restore import export json 백업 복원 가져오기 내보내기')
  ];
  for (const category of configurableDocumentFormatCategories) {
    pages.push(page(`category:${category.id}`, category.labelKey, ['settings.fileFormats'], category.descriptionKey,
      category.id === 'table' ? [
        'settings.table.highlightHeader.title', 'settings.table.highlightHeader.description',
        'settings.table.rowNumbers.title', 'settings.table.rowNumbers.description',
        'settings.table.reorder.title', 'settings.table.reorder.description', 'settings.table.reorder.duration'
      ] : [], category.formatIds.join(' ')));
    for (const format of configurableDocumentFormats.filter(item => category.formatIds.includes(item.id))) {
      pages.push(page(`format:${format.id}`, format.labelKey, ['settings.fileFormats', category.labelKey], format.renderDescriptionKey,
        [format.editDescriptionKey, 'settings.renderDisplay.title', 'settings.renderEditing.title',
          ...(format.id === 'markdown' ? [
            'settings.markdown.headings', 'settings.markdown.hideMarkers.title', 'settings.markdown.hideMarkers.description',
            'settings.markdown.dividers.title', 'settings.markdown.dividers.description', 'settings.markdown.sizePercent', 'settings.fontWeight'
          ] as TranslationKey[] : [])], `${format.id} ${format.extensions.map(extension => `.${extension}`).join(' ')}`));
    }
  }
  return pages;
}

export function getSettingsSearchTokens(query: string): string[] {
  return query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
}

export function matchesSettingsSearch(text: string, tokens: string[]): boolean {
  const normalized = text.normalize('NFKC').toLocaleLowerCase();
  return tokens.every(token => normalized.includes(token));
}

export function searchSettingsPages(pages: SettingsPage[], query: string): SettingsPage[] {
  const tokens = getSettingsSearchTokens(query);
  return pages.filter(page => matchesSettingsSearch([page.title, ...page.path, page.description, ...page.terms].join(' '), tokens));
}
