import { canOpenQuoteAt, findClosingQuote, isEscapedAt, type QuoteCharacter } from './quote-boundaries';

export const defaultAutoPairAllowedFollowingStrings = ['=', ':'] as const;
export const maximumAutoPairAllowedFollowingStringCount = 32;
export const maximumAutoPairAllowedFollowingStringLength = 32;

const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;

export function normalizeAutoPairAllowedFollowingString(value: string): string | null {
  const normalized = value.trim();
  if (!normalized || controlCharacterPattern.test(normalized)) return null;
  if ([...normalized].length > maximumAutoPairAllowedFollowingStringLength) return null;
  return normalized;
}

export function normalizeAutoPairAllowedFollowingStrings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > maximumAutoPairAllowedFollowingStringCount) return null;

  const normalized: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== 'string') return null;
    const entry = normalizeAutoPairAllowedFollowingString(candidate);
    if (!entry) return null;
    if (!normalized.includes(entry)) normalized.push(entry);
  }
  return normalized;
}

export function createDefaultAutoPairAllowedFollowingStrings(): string[] {
  return [...defaultAutoPairAllowedFollowingStrings];
}

export function parseAutoPairAllowedFollowingStrings(value: string | null): string[] {
  if (value === null) return createDefaultAutoPairAllowedFollowingStrings();

  try {
    return normalizeAutoPairAllowedFollowingStrings(JSON.parse(value))
      ?? createDefaultAutoPairAllowedFollowingStrings();
  } catch {
    return createDefaultAutoPairAllowedFollowingStrings();
  }
}

export function canInsertAutoPairAt(
  content: string,
  caretOffset: number,
  allowedFollowingStrings: readonly string[]
): boolean {
  const offset = Math.max(0, Math.min(caretOffset, content.length));
  if (offset === content.length) return true;
  if (/^\s/u.test(content.slice(offset))) return true;
  return allowedFollowingStrings.some((value) => content.startsWith(value, offset));
}

/** 미완성 인용은 원문의 현재 줄에서만 판정한다. */
export function hasOpenQuoteBeforeCaret(content: string, caret: number, quote: QuoteCharacter): boolean {
  const lineStart = caret <= 0 ? 0 : content.lastIndexOf('\n', caret - 1) + 1;
  const lineEnd = content.indexOf('\n', caret);
  const line = content.slice(lineStart, lineEnd < 0 ? content.length : lineEnd);
  const localCaret = caret - lineStart;
  for (let i = 0; i < localCaret; i++) {
    if (line[i] !== quote || isEscapedAt(line, i) || !canOpenQuoteAt(line, i)) continue;
    const closing = findClosingQuote(line, i, quote);
    if (closing < 0 || closing >= localCaret) return true;
    i = closing;
  }
  return false;
}

export function hasSymmetricRepeatedQuoteAtCaret(content: string, caret: number, quote: QuoteCharacter): boolean {
  let left = caret;
  let right = caret;
  while (left > 0 && content[left - 1] === quote && !isEscapedAt(content, left - 1)) left--;
  while (right < content.length && content[right] === quote && !isEscapedAt(content, right)) right++;
  return caret - left >= 2 && caret - left === right - caret;
}
