import type { SettingsThemePalette } from './settings-transfer';

const hexColorPattern = /^#[0-9a-fA-F]{6}$/;

export function getSystemDefaultColors(isDark: boolean): SettingsThemePalette {
  return isDark ? {
    renderBg: '#0a0a0b',
    renderText: '#d6eaf0',
    renderFontWeight: '400',
    codeBg: '#1e293b',
    codeText: '#94a3b8',
    keyStrong: '#0284c7',
    keyMedium: '#38bdf8',
    keyLight: '#7dd3fc',
    string: '#F3AF82',
    number: '#dffe8b',
    listMarker: '#A5B4FC',
    comment: '#64748b',
    guide: '#334155',
    paren: '#ECA7BC',
    bracket: '#C87EBA',
    brace: '#CD81E9'
  } : {
    renderBg: '#f8fafc',
    renderText: '#0f172a',
    renderFontWeight: '500',
    codeBg: '#e2e8f0',
    codeText: '#0284c7',
    keyStrong: '#0369a1',
    keyMedium: '#0284c7',
    keyLight: '#38bdf8',
    string: '#b91c1c',
    number: '#d97706',
    listMarker: '#4F46E5',
    comment: '#475569',
    guide: '#cbd5e1',
    paren: '#a57800',
    bracket: '#b31c62',
    brace: '#097a70'
  };
}

export function normalizeHexColor(value: string): string | null {
  const normalized = value.trim();
  return hexColorPattern.test(normalized) ? normalized.toUpperCase() : null;
}

export function getColorInputValue(value: string): string {
  return normalizeHexColor(value) ?? '#000000';
}

export function formatColorCode(value: string): string {
  return normalizeHexColor(value) ?? (value.trim().toUpperCase() || '#000000');
}

export function getReadableTextColor(value: string): string {
  const hex = getColorInputValue(value).slice(1);
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const toLinear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * toLinear(red) + 0.7152 * toLinear(green) + 0.0722 * toLinear(blue);
  return luminance > 0.179 ? '#000000' : '#ffffff';
}

export function getColorCodeStyle(value: string): string {
  const backgroundColor = getColorInputValue(value);
  return `background-color: ${backgroundColor}; color: ${getReadableTextColor(backgroundColor)};`;
}
