export interface TextChange {
  rangeStart: number;
  beforeText: string;
  afterText: string;
}

export function getTextChange(before: string, after: string): TextChange | null {
  if (before === after) return null;

  let prefixLength = 0;
  const minLength = Math.min(before.length, after.length);
  while (prefixLength < minLength && before[prefixLength] === after[prefixLength]) {
    prefixLength += 1;
  }

  let beforeSuffix = before.length;
  let afterSuffix = after.length;
  while (
    beforeSuffix > prefixLength
    && afterSuffix > prefixLength
    && before[beforeSuffix - 1] === after[afterSuffix - 1]
  ) {
    beforeSuffix -= 1;
    afterSuffix -= 1;
  }

  return {
    rangeStart: prefixLength,
    beforeText: before.slice(prefixLength, beforeSuffix),
    afterText: after.slice(prefixLength, afterSuffix)
  };
}

export function applyTextChange(content: string, change: TextChange): string {
  return content.slice(0, change.rangeStart)
    + change.afterText
    + content.slice(change.rangeStart + change.beforeText.length);
}

export function isTextChangeTransition(before: string, after: string, change: TextChange | null): boolean {
  if (!change) return before === after;
  if (change.rangeStart < 0 || change.rangeStart + change.beforeText.length > before.length) return false;
  if (before.slice(change.rangeStart, change.rangeStart + change.beforeText.length) !== change.beforeText) return false;
  return applyTextChange(before, change) === after;
}
