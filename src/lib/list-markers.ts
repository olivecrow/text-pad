export interface ListMarker {
  indent: string;
  label: string;
  separator: ListMarkerSeparator;
  spacing: string;
  marker: string;
}

export type ListMarkerSeparator = 'dot' | 'right-parenthesis' | 'parentheses';
export type ListMarkerKind = 'upper-roman' | 'upper-alpha' | 'decimal' | 'lower-roman' | 'lower-alpha';

interface ListMarkerStyle {
  kind: ListMarkerKind;
  separator: ListMarkerSeparator;
}

const listMarkerAtStartRegex = /^([ \t]*)(?:\(([A-Za-z]+|\d+)\)|([A-Za-z]+|\d+)([.)]))([ \t]+)/;
const romanNumeralRegex = /^(?=[mdclxvi]+$)m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;
const romanDigitValues: ReadonlyArray<readonly [number, string]> = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I']
];
const initialListMarkerStyles: ReadonlyArray<ListMarkerStyle> = [
  { kind: 'upper-roman', separator: 'dot' },
  { kind: 'upper-alpha', separator: 'dot' },
  { kind: 'decimal', separator: 'dot' },
  { kind: 'lower-roman', separator: 'dot' },
  { kind: 'lower-alpha', separator: 'dot' },
  { kind: 'decimal', separator: 'right-parenthesis' },
  { kind: 'lower-alpha', separator: 'right-parenthesis' },
  { kind: 'decimal', separator: 'parentheses' },
  { kind: 'lower-alpha', separator: 'parentheses' }
];
const repeatingListMarkerStyles: ReadonlyArray<ListMarkerStyle> = [
  { kind: 'decimal', separator: 'dot' },
  { kind: 'lower-alpha', separator: 'dot' },
  { kind: 'decimal', separator: 'right-parenthesis' },
  { kind: 'lower-alpha', separator: 'right-parenthesis' },
  { kind: 'decimal', separator: 'parentheses' },
  { kind: 'lower-alpha', separator: 'parentheses' }
];

export function isListMarkerLabel(label: string): boolean {
  if (/^\d+$/.test(label)) return true;
  if (/^[A-Za-z]$/.test(label)) return true;
  return romanNumeralRegex.test(label);
}

export function getListMarkerAtStart(text: string): ListMarker | null {
  const match = text.match(listMarkerAtStartRegex);
  if (!match) return null;

  const wrappedLabel = match[2] || '';
  const plainLabel = match[3] || '';
  const label = wrappedLabel || plainLabel;
  if (!isListMarkerLabel(label)) return null;

  const separator: ListMarkerSeparator = wrappedLabel
    ? 'parentheses'
    : match[4] === ')'
      ? 'right-parenthesis'
      : 'dot';
  const spacing = match[5] || '';
  return {
    indent: match[1] || '',
    label,
    separator,
    spacing,
    marker: formatListMarker(label, separator, spacing)
  };
}

export function formatListMarker(
  label: string,
  separator: ListMarkerSeparator,
  spacing = ' '
): string {
  if (separator === 'parentheses') return `(${label})${spacing}`;
  if (separator === 'right-parenthesis') return `${label})${spacing}`;
  return `${label}.${spacing}`;
}

function getInitialLabel(kind: ListMarkerKind): string {
  if (kind === 'upper-roman') return 'I';
  if (kind === 'upper-alpha') return 'A';
  if (kind === 'lower-roman') return 'i';
  if (kind === 'lower-alpha') return 'a';
  return '1';
}

function getListMarkerStyleForIndentLevel(indentLevel: number): ListMarkerStyle {
  const safeIndentLevel = Math.max(0, Math.floor(indentLevel));
  if (safeIndentLevel < initialListMarkerStyles.length) {
    return initialListMarkerStyles[safeIndentLevel];
  }

  return repeatingListMarkerStyles[
    (safeIndentLevel - initialListMarkerStyles.length) % repeatingListMarkerStyles.length
  ];
}

export function getListMarkerForIndentLevel(indentLevel: number, spacing = ' '): string {
  const style = getListMarkerStyleForIndentLevel(indentLevel);
  return formatListMarker(getInitialLabel(style.kind), style.separator, spacing);
}

function incrementDecimalLabel(label: string): string {
  const digits = label.split('');
  let carry = 1;

  for (let index = digits.length - 1; index >= 0 && carry > 0; index--) {
    const nextDigit = Number(digits[index]) + carry;
    digits[index] = String(nextDigit % 10);
    carry = nextDigit >= 10 ? 1 : 0;
  }

  if (carry > 0) digits.unshift('1');
  return digits.join('');
}

function incrementAlphabeticLabel(label: string): string | null {
  if (!/^[A-Za-z]$/.test(label)) return null;

  const code = label.charCodeAt(0);
  const lastCode = label === label.toUpperCase()
    ? 'Z'.charCodeAt(0)
    : 'z'.charCodeAt(0);
  if (code >= lastCode) return null;

  return String.fromCharCode(code + 1);
}

function romanLabelToNumber(label: string): number | null {
  if (!romanNumeralRegex.test(label)) return null;

  const normalized = label.toUpperCase();
  let value = 0;
  let index = 0;

  for (const [digitValue, digitLabel] of romanDigitValues) {
    while (normalized.startsWith(digitLabel, index)) {
      value += digitValue;
      index += digitLabel.length;
    }
  }

  return index === normalized.length ? value : null;
}

function numberToRomanLabel(value: number, lowercase: boolean): string | null {
  if (!Number.isInteger(value) || value < 1 || value > 3999) return null;

  let remainder = value;
  let result = '';
  for (const [digitValue, digitLabel] of romanDigitValues) {
    while (remainder >= digitValue) {
      result += digitLabel;
      remainder -= digitValue;
    }
  }

  return lowercase ? result.toLowerCase() : result;
}

function isAlphabeticSequenceStep(previousLabel: string, currentLabel: string): boolean {
  return incrementAlphabeticLabel(previousLabel) === currentLabel;
}

function isRomanSequenceStep(previousLabel: string, currentLabel: string): boolean {
  const previousValue = romanLabelToNumber(previousLabel);
  const currentValue = romanLabelToNumber(currentLabel);
  return previousValue !== null && currentValue === previousValue + 1;
}

export function getNextListMarkerLabel(label: string, previousLabel: string | null = null): string | null {
  if (/^\d+$/.test(label)) return incrementDecimalLabel(label);

  if (label.length > 1) {
    const romanValue = romanLabelToNumber(label);
    return romanValue === null
      ? null
      : numberToRomanLabel(romanValue + 1, label === label.toLowerCase());
  }

  if (previousLabel) {
    if (isAlphabeticSequenceStep(previousLabel, label)) {
      return incrementAlphabeticLabel(label);
    }

    if (isRomanSequenceStep(previousLabel, label)) {
      const romanValue = romanLabelToNumber(label);
      return romanValue === null
        ? null
        : numberToRomanLabel(romanValue + 1, label === label.toLowerCase());
    }
  }

  if (label === 'I' || label === 'i') {
    return label === 'I' ? 'II' : 'ii';
  }

  return incrementAlphabeticLabel(label);
}
