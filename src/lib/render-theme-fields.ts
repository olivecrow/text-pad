import type { TranslationKey } from './i18n/en';

// 추가 색상의 설정 화면, 기본값, 저장 필드와 CSS 연결을 한 목록에서 관리한다.
export const additionalRenderThemeFields = [
  { field: 'selection', variable: '--color-selection', label: 'settings.color.selection', light: '#60A5FA', dark: '#BFDBFE' },
  { field: 'scriptLatin', variable: '--color-script-latin', label: 'settings.color.scriptLatin', light: '#1D4ED8', dark: '#93C5FD' },
  { field: 'scriptHangul', variable: '--color-script-hangul', label: 'settings.color.scriptHangul', light: '#0F766E', dark: '#5EEAD4' },
  { field: 'scriptHan', variable: '--color-script-han', label: 'settings.color.scriptHan', light: '#9A3412', dark: '#FDBA74' },
  { field: 'scriptKana', variable: '--color-script-kana', label: 'settings.color.scriptKana', light: '#7C3AED', dark: '#C4B5FD' },
  { field: 'scriptCyrillic', variable: '--color-script-cyrillic', label: 'settings.color.scriptCyrillic', light: '#BE185D', dark: '#F9A8D4' },
  { field: 'scriptGreek', variable: '--color-script-greek', label: 'settings.color.scriptGreek', light: '#0369A1', dark: '#7DD3FC' },
  { field: 'scriptArabic', variable: '--color-script-arabic', label: 'settings.color.scriptArabic', light: '#166534', dark: '#86EFAC' },
  { field: 'scriptDevanagari', variable: '--color-script-devanagari', label: 'settings.color.scriptDevanagari', light: '#92400E', dark: '#FCD34D' },
  { field: 'scriptThai', variable: '--color-script-thai', label: 'settings.color.scriptThai', light: '#7E22CE', dark: '#D8B4FE' },
  { field: 'searchHighlight', variable: '--color-search-highlight', label: 'settings.color.searchHighlight', light: '#FACC15', dark: '#FACC15' },
  { field: 'searchCurrentHighlight', variable: '--color-search-current-highlight', label: 'settings.color.searchCurrentHighlight', light: '#EAB308', dark: '#FDE047' },
  { field: 'caret', variable: '--color-caret', label: 'settings.color.caret', light: '#0F172A', dark: '#D6EAF0' },
  { field: 'gutterText', variable: '--color-gutter-text', label: 'settings.color.gutterText', light: '#8D8D8D', dark: '#858585' },
  { field: 'gutterBorder', variable: '--color-gutter-border', label: 'settings.color.gutterBorder', light: '#E5E5E5', dark: '#2C2C2C' },
  { field: 'mutedSyntax', variable: '--color-muted-syntax', label: 'settings.color.mutedSyntax', light: '#737373', dark: '#A3A3A3' },
  { field: 'pairHighlight', variable: '--color-pair-highlight', label: 'settings.color.pairHighlight', light: '#4F46E5', dark: '#A5B4FC' },
  { field: 'error', variable: '--color-error', label: 'settings.color.error', light: '#DC2626', dark: '#DC2626' },
  { field: 'warning', variable: '--color-warning', label: 'settings.color.warning', light: '#D97706', dark: '#D97706' },
  { field: 'success', variable: '--color-success', label: 'settings.color.success', light: '#16A34A', dark: '#16A34A' },
  { field: 'colorBorder', variable: '--color-color-border', label: 'settings.color.colorBorder', light: '#9CA3AF', dark: '#9CA3AF' },
  { field: 'booleanTrueText', variable: '--color-boolean-true-text', label: 'settings.color.booleanTrueText', light: '#166534', dark: '#BBF7D0' },
  { field: 'booleanTrueBg', variable: '--color-boolean-true-bg', label: 'settings.color.booleanTrueBg', light: '#DCFCE7', dark: '#123322' },
  { field: 'booleanFalseText', variable: '--color-boolean-false-text', label: 'settings.color.booleanFalseText', light: '#991B1B', dark: '#FECACA' },
  { field: 'booleanFalseBg', variable: '--color-boolean-false-bg', label: 'settings.color.booleanFalseBg', light: '#FEE2E2', dark: '#3C171B' },
  { field: 'booleanBorder', variable: '--color-boolean-border', label: 'settings.color.booleanBorder', light: '#6B7280', dark: '#9CA3AF' },
  { field: 'tableAccent', variable: '--color-table-accent', label: 'settings.color.tableAccent', light: '#0078D4', dark: '#0078D4' },
  { field: 'tableBorder', variable: '--color-table-border', label: 'settings.color.tableBorder', light: '#E5E5E5', dark: '#2C2C2C' },
] as const satisfies readonly { field: string; variable: string; label: TranslationKey; light: string; dark: string }[];

export type AdditionalRenderThemeField = typeof additionalRenderThemeFields[number]['field'];

export function getAdditionalRenderThemeDefaults(isDark: boolean): Record<AdditionalRenderThemeField, string> {
  return Object.fromEntries(additionalRenderThemeFields.map(item => [item.field, isDark ? item.dark : item.light])) as Record<AdditionalRenderThemeField, string>;
}

export function getAdditionalRenderThemeStyle(colors: Record<AdditionalRenderThemeField, string>): string {
  return additionalRenderThemeFields.map(item => `${item.variable}: ${colors[item.field]};`).join(' ');
}
