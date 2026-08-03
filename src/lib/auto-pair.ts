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
