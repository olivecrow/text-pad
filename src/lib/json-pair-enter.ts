import { createScanner } from 'jsonc-parser';

export interface JsonPairEnterEdit {
  content: string;
  caret: number;
}

interface JsonPairTokenKinds {
  closing: string;
  openingKind: number;
  closingKind: number;
}

const jsonTokenKind = {
  openBrace: 1,
  closeBrace: 2,
  openBracket: 3,
  closeBracket: 4,
  eof: 17
} as const;

const jsonPairTokenKinds: Record<string, JsonPairTokenKinds> = {
  '{': {
    closing: '}',
    openingKind: jsonTokenKind.openBrace,
    closingKind: jsonTokenKind.closeBrace
  },
  '[': {
    closing: ']',
    openingKind: jsonTokenKind.openBracket,
    closingKind: jsonTokenKind.closeBracket
  }
};

function isJsonStructuralPair(
  content: string,
  openingOffset: number,
  closingOffset: number,
  pair: JsonPairTokenKinds
): boolean {
  const scanner = createScanner(content, true);
  let tokenKind = scanner.scan();

  while (tokenKind !== jsonTokenKind.eof) {
    const tokenOffset = scanner.getTokenOffset();
    if (tokenOffset > openingOffset) return false;

    if (tokenOffset === openingOffset) {
      if (tokenKind !== pair.openingKind || scanner.getTokenLength() !== 1) return false;

      const closingKind = scanner.scan();
      return closingKind === pair.closingKind
        && scanner.getTokenOffset() === closingOffset
        && scanner.getTokenLength() === 1;
    }

    tokenKind = scanner.scan();
  }

  return false;
}

export function getJsonPairEnterEdit(
  content: string,
  caret: number,
  newline: string,
  indentUnit: string
): JsonPairEnterEdit | null {
  if (
    !Number.isInteger(caret)
    || caret <= 0
    || caret >= content.length
    || (newline !== '\n' && newline !== '\r\n')
    || !/^[ \t]+$/u.test(indentUnit)
  ) return null;

  const opening = content[caret - 1];
  const pair = jsonPairTokenKinds[opening];
  if (!pair || content[caret] !== pair.closing) return null;
  if (!isJsonStructuralPair(content, caret - 1, caret, pair)) return null;

  const lineStart = content.lastIndexOf('\n', caret - 1) + 1;
  const lineIndent = content.slice(lineStart, caret - 1).match(/^[ \t]*/u)?.[0] ?? '';
  const innerIndent = `${lineIndent}${indentUnit}`;
  const insertion = `${newline}${innerIndent}${newline}${lineIndent}`;

  return {
    content: `${content.slice(0, caret)}${insertion}${content.slice(caret)}`,
    caret: caret + newline.length + innerIndent.length
  };
}
