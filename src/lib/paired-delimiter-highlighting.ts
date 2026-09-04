export type PairedDelimiterKind = 'paren' | 'bracket' | 'brace' | 'quote';

export interface PairedDelimiterHighlight {
  opening: number;
  closing: number;
  kind: PairedDelimiterKind;
}

export interface PairedDelimiterIndex {
  openingOffsets: readonly number[];
  openingMatches: readonly number[];
  closingOffsets: readonly number[];
  closingMatches: readonly number[];
}

type OpeningBracket = '(' | '[' | '{';
type QuoteCharacter = '"' | "'";

interface BracketStackEntry {
  character: OpeningBracket;
  openingIndex: number;
}

const openingBrackets = new Set<OpeningBracket>(['(', '[', '{']);
const closingBrackets: Record<string, OpeningBracket> = {
  ')': '(',
  ']': '[',
  '}': '{'
};
const wordLikeCharacterPattern = /[\p{L}\p{M}\p{N}]/u;
const whitespacePattern = /\s/u;

function isWordLikeCharacter(character: string | undefined): boolean {
  return !!character && wordLikeCharacterPattern.test(character);
}

function isWhitespaceCharacter(character: string | undefined): boolean {
  return !!character && whitespacePattern.test(character);
}

function isEscapedAt(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function isLikelyApostrophe(text: string, index: number): boolean {
  const previousCharacter = text[index - 1];
  const nextCharacter = text[index + 1];

  if (!isWordLikeCharacter(previousCharacter)) return false;
  if (isWordLikeCharacter(nextCharacter)) return true;
  if (!nextCharacter || isWhitespaceCharacter(nextCharacter)) return true;

  return /[.,;:!?…)\]}]/u.test(nextCharacter);
}

function isSingleQuoteCloseCandidate(
  text: string,
  index: number,
  lineEnd: number
): boolean {
  if (isEscapedAt(text, index)) return false;

  const previousCharacter = text[index - 1];
  const nextCharacter = index + 1 < lineEnd ? text[index + 1] : undefined;

  if (!previousCharacter || isWhitespaceCharacter(previousCharacter)) return false;
  if (isWordLikeCharacter(previousCharacter) && isWordLikeCharacter(nextCharacter)) return false;

  return true;
}

function findClosingQuote(text: string, opening: number, quote: QuoteCharacter): number {
  const lineBreak = text.indexOf('\n', opening + 1);
  const lineEnd = lineBreak === -1 ? text.length : lineBreak;

  for (let index = opening + 1; index < lineEnd; index += 1) {
    if (text[index] !== quote || isEscapedAt(text, index)) continue;

    if (quote === '"') return index;
    if (isSingleQuoteCloseCandidate(text, index, lineEnd)) return index;
  }

  return -1;
}

function findExactOffset(offsets: readonly number[], target: number): number {
  let low = 0;
  let high = offsets.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const offset = offsets[middle] ?? -1;
    if (offset === target) return middle;
    if (offset < target) low = middle + 1;
    else high = middle - 1;
  }

  return -1;
}

function getDelimiterKind(character: string | undefined): PairedDelimiterKind {
  if (character === '(') return 'paren';
  if (character === '[') return 'bracket';
  if (character === '{') return 'brace';
  return 'quote';
}

export function createPairedDelimiterIndex(content: string): PairedDelimiterIndex {
  const openingOffsets: number[] = [];
  const openingMatches: number[] = [];
  const closingOffsets: number[] = [];
  const closingMatches: number[] = [];
  const bracketStack: BracketStackEntry[] = [];

  const addOpening = (offset: number): number => {
    openingOffsets.push(offset);
    openingMatches.push(-1);
    return openingOffsets.length - 1;
  };

  const closeOpening = (openingIndex: number, closingOffset: number) => {
    const openingOffset = openingOffsets[openingIndex];
    if (openingOffset === undefined) return;
    openingMatches[openingIndex] = closingOffset;
    closingOffsets.push(closingOffset);
    closingMatches.push(openingOffset);
  };

  let offset = 0;
  while (offset < content.length) {
    const character = content[offset];

    if ((character === '"' || character === "'") && !(character === "'" && isLikelyApostrophe(content, offset))) {
      const closingOffset = findClosingQuote(content, offset, character);
      if (closingOffset !== -1) {
        closeOpening(addOpening(offset), closingOffset);
        offset = closingOffset + 1;
        continue;
      }
    }

    if (openingBrackets.has(character as OpeningBracket)) {
      bracketStack.push({
        character: character as OpeningBracket,
        openingIndex: addOpening(offset)
      });
      offset += 1;
      continue;
    }

    const expectedOpening = closingBrackets[character];
    const stackTop = bracketStack[bracketStack.length - 1];
    if (expectedOpening && stackTop?.character === expectedOpening) {
      bracketStack.pop();
      closeOpening(stackTop.openingIndex, offset);
    } else if (expectedOpening && bracketStack.length > 0) {
      bracketStack.length = 0;
    }

    offset += 1;
  }

  return { openingOffsets, openingMatches, closingOffsets, closingMatches };
}

export function getPairedDelimiterHighlightAtCaret(
  content: string,
  caret: number,
  index: PairedDelimiterIndex
): PairedDelimiterHighlight | null {
  if (!Number.isInteger(caret) || caret < 0 || caret > content.length) return null;

  const getOpeningHighlight = (candidate: number): PairedDelimiterHighlight | null => {
    if (candidate < 0 || candidate >= content.length) return null;

    const openingIndex = findExactOffset(index.openingOffsets, candidate);
    const closing = openingIndex === -1 ? -1 : (index.openingMatches[openingIndex] ?? -1);
    if (closing >= 0) {
      return {
        opening: candidate,
        closing,
        kind: getDelimiterKind(content[candidate])
      };
    }

    return null;
  };

  const getClosingHighlight = (candidate: number): PairedDelimiterHighlight | null => {
    if (candidate < 0 || candidate >= content.length) return null;
    const closingIndex = findExactOffset(index.closingOffsets, candidate);
    const opening = closingIndex === -1 ? -1 : (index.closingMatches[closingIndex] ?? -1);
    if (opening >= 0) {
      return {
        opening,
        closing: candidate,
        kind: getDelimiterKind(content[opening])
      };
    }

    return null;
  };

  const left = caret - 1;
  const right = caret;
  return getOpeningHighlight(left)
    ?? getClosingHighlight(right)
    ?? getClosingHighlight(left)
    ?? getOpeningHighlight(right);
}
