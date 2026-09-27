export type QuoteCharacter = '"' | "'" | '`';

const wordCharacter = /[\p{L}\p{M}\p{N}]/u;
const whitespace = /\s/u;
// 문장 전체의 언어를 추측하지 않고 흔한 생략형만 보호한다.
const elisionPrefixes = new Set([
  'c', 'd', 'j', 'l', 'm', 'n', 's', 't', 'qu', 'jusqu', 'lorsqu', 'puisqu', 'quoiqu',
  'presqu', 'quelqu', 'entr', 'aujourd',
  'un', 'all', 'dall', 'dell', 'nell', 'sull', 'coll', 'quest', 'quell', 'sant', 'bell', 'buon',
  'o'
]);
const contractionSuffixes = new Set(['s', 'd', 'm', 're', 've', 'll']);
const leadingElisions = new Set(['tis', 'twas', 'twere', 'twill', 'cause', 'em', 'til', 'bout', 'round', 's', 't', 'k', 'n']);
const trailingElisions = new Set(['po', 'mo', 'be', 'va', 'fa', 'sta', 'da', 'di']);
const turkishSuffix = /^(?:[aeıiuü]|[yn][aeıiuü]|n?[ıiuü]n|[dt][ae]n?|[y]?[ln][ae]|[ıiuü]m|[ıiuü]m[ıiuü]z|[ıiuü]n[ıiuü]z|[dt][ıiuü]r|m[ıiuü]ş|[dt][ae]ki)$/u;
const cyrillicElisionLeft = /[бпвмфркґгдзнстцчшжх]$/iu;
const cyrillicElisionRight = /^[яюєїёі]/iu;

function characterBefore(text: string, offset: number): string {
  if (offset <= 0) return '';
  const last = text.charCodeAt(offset - 1);
  const width = last >= 0xdc00 && last <= 0xdfff && offset > 1 ? 2 : 1;
  return text.slice(offset - width, offset);
}

function characterAt(text: string, offset: number): string {
  const point = text.codePointAt(offset);
  return point === undefined ? '' : String.fromCodePoint(point);
}

export function hasWordCharacterBefore(text: string, offset: number): boolean {
  return wordCharacter.test(characterBefore(text, offset));
}

export function isEscapedAt(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

function wordAfter(text: string, offset: number): { text: string; end: number } {
  let end = offset;
  for (let character = characterAt(text, end); wordCharacter.test(character); character = characterAt(text, end)) {
    end += character.length;
  }
  return { text: text.slice(offset, end), end };
}

function wordBefore(text: string, offset: number): { text: string; start: number } {
  let start = offset;
  for (let character = characterBefore(text, start); wordCharacter.test(character); character = characterBefore(text, start)) {
    start -= character.length;
  }
  return { text: text.slice(start, offset), start };
}

function isLeadingElision(text: string, index: number): boolean {
  const right = wordAfter(text, index + 1);
  // 's' 같은 완성된 짧은 인용은 생략형으로 보지 않는다.
  if (text[right.end] === "'") return false;
  return leadingElisions.has(right.text.toLowerCase()) || /^\d{2}s?$/iu.test(right.text);
}

export function canOpenQuoteAt(text: string, index: number): boolean {
  if (isEscapedAt(text, index)) return false;
  if (text[index] !== "'") return true;
  // 인용이 열리지 않은 곳의 단어 내부·끝 아포스트로피는 새 인용을 열지 않는다.
  return !hasWordCharacterBefore(text, index) && !isLeadingElision(text, index);
}

function isInternalApostrophe(text: string, index: number, opening: number): boolean {
  const left = wordBefore(text, index);
  const right = wordAfter(text, index + 1);
  if (!left.text || !right.text) return false;

  // 'Sa'ad'처럼 한 단어 안에 아포스트로피와 닫는 따옴표가 함께 있는 경우.
  if (text[right.end] === "'" && !isEscapedAt(text, right.end)) return true;
  const suffix = right.text.toLowerCase();
  if (contractionSuffixes.has(suffix) || (suffix === 't' && /n$/iu.test(left.text))) return true;

  // 앞선 아포스트로피 뒤의 조각을 새로운 생략 접두사로 잘못 읽지 않는다.
  const beginsWord = left.start === opening + 1 || !/[’'ʼ]/u.test(characterBefore(text, left.start));
  if (beginsWord && elisionPrefixes.has(left.text.toLowerCase())) return true;
  if (cyrillicElisionLeft.test(left.text) && cyrillicElisionRight.test(right.text)) return true;
  if (/^[\p{Lu}\p{N}]/u.test(left.text) && turkishSuffix.test(suffix)) return true;
  return false;
}

function hasLaterClosingQuote(text: string, start: number, opening: number): boolean {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '\r' || text[index] === '\n') return false;
    if (text[index] !== "'" || isEscapedAt(text, index)) continue;
    if (canOpenQuoteAt(text, index)) return false;
    if (!isInternalApostrophe(text, index, opening)) return true;
  }
  return false;
}

export function findClosingQuote(text: string, opening: number, quote: QuoteCharacter): number {
  for (let index = opening + 1; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\r' || character === '\n') break;
    if (character !== quote || isEscapedAt(text, index)) continue;
    if (quote !== "'") return index;

    const previous = characterBefore(text, index);
    if (!wordCharacter.test(previous) && isLeadingElision(text, index)) continue;
    if (isInternalApostrophe(text, index, opening)) continue;
    // 'dogs' collars'의 소유 표기는 보존하되 'cats' and 'dogs'는 각각 닫는다.
    if (whitespace.test(characterAt(text, index + 1))
      && (/[sxz]$/iu.test(previous) || trailingElisions.has(wordBefore(text, index).text.toLowerCase()))
      && hasLaterClosingQuote(text, index + 1, opening)) continue;
    return index;
  }
  return -1;
}
