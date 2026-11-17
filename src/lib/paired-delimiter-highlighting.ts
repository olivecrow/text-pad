import { canOpenQuoteAt, findClosingQuote } from './quote-boundaries';

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

    if (character === '\n' || character === '\r') {
      bracketStack.length = 0;
      offset += 1;
      continue;
    }

    if ((character === '"' || character === "'") && canOpenQuoteAt(content, offset)) {
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

/** 짝 기호는 줄을 넘지 않는다. 캐럿 옆에 후보가 있을 때만 해당 줄을 해석한다. */
export function getLocalPairedDelimiterHighlight(content: string, caret: number): PairedDelimiterHighlight | null {
  if (!Number.isInteger(caret) || caret < 0 || caret > content.length) return null;
  const left = content[caret - 1] ?? '';
  const right = content[caret] ?? '';
  const isDelimiter = (character: string) => character !== '' && `()[]{}"'`.includes(character);
  if (!isDelimiter(left) && !isDelimiter(right)) return null;

  const candidate = isDelimiter(left) ? caret - 1 : caret;
  const start = Math.max(content.lastIndexOf('\n', candidate), content.lastIndexOf('\r', candidate)) + 1;
  let end = candidate + 1;
  while (end < content.length && content[end] !== '\n' && content[end] !== '\r') end += 1;
  const line = content.slice(start, end);
  const match = getPairedDelimiterHighlightAtCaret(line, caret - start, createPairedDelimiterIndex(line));
  return match && { kind: match.kind, opening: start + match.opening, closing: start + match.closing };
}
