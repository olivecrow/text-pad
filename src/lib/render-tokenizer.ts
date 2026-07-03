export interface Token {
  type:
    | 'text'
    | 'string'
    | 'code'
    | 'number'
    | 'list-marker'
    | 'comment'
    | 'color'
    | 'paren'
    | 'bracket'
    | 'brace'
    | 'key'
    | 'boolean'
    | 'literal'
    | 'punctuation'
    | 'invalid';
  text?: string;
  children?: Token[];
  depth?: number;
  start?: number;
  end?: number;
}

export interface LineCommentRule {
  marker: string;
  anchored?: boolean;
  caseInsensitive?: boolean;
  requiresWordBoundaryAfter?: boolean;
}

export interface BlockCommentRule {
  start: string;
  end: string;
  caseInsensitive?: boolean;
}

export interface CommentSyntax {
  line?: LineCommentRule[];
  block?: BlockCommentRule[];
}

export interface TokenizeState {
  blockCommentEnd: string;
  blockCommentCaseInsensitive?: boolean;
}

export interface TokenizeLineResult {
  tokens: Token[];
  state: TokenizeState | null;
}

const hexColorAtStartRegex = /^#[0-9a-fA-F]{6}$/;
const listMarkerAtStartRegex = /^([ \t]*)([A-Za-z]+|\d+)(\.\s+)/;
const romanNumeralRegex = /^(?=[mdclxvi]+$)m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;
const wordLikeCharRegex = /[\p{L}\p{M}\p{N}]/u;
const whitespaceRegex = /\s/u;
const depthTrackedTypes = new Set<Token['type']>(['string', 'code', 'paren', 'bracket', 'brace']);

function hasWhitespaceWordBoundary(text: string, start: number, end: number): boolean {
  const previousChar = text[start - 1];
  const nextChar = text[end];

  return (!previousChar || isWhitespaceChar(previousChar)) && (!nextChar || isWhitespaceChar(nextChar));
}

function getHexColorAt(text: string, index: number): string | null {
  const candidate = text.slice(index, index + 7);
  if (!hexColorAtStartRegex.test(candidate)) return null;
  if (!hasWhitespaceWordBoundary(text, index, index + candidate.length)) return null;

  return candidate;
}

function isListMarkerLabel(label: string): boolean {
  if (/^\d+$/.test(label)) return true;
  if (/^[A-Za-z]$/.test(label)) return true;
  return romanNumeralRegex.test(label);
}

function getListMarkerAtStart(text: string): { indent: string; marker: string } | null {
  const match = text.match(listMarkerAtStartRegex);
  if (!match) return null;

  const label = match[2] || '';
  if (!isListMarkerLabel(label)) return null;

  return {
    indent: match[1] || '',
    marker: `${label}${match[3] || ''}`
  };
}

function parseInlineText(text: string, includeNumbers = true): Token[] {
  const tokens: Token[] = [];
  const inlineRegex = includeNumbers
    ? /#[0-9a-fA-F]{6}(?![0-9a-zA-Z_])|\b\d+(?:\.\d+)?\b/g
    : /#[0-9a-fA-F]{6}(?![0-9a-zA-Z_])/g;
  let lastIndex = 0;
  let match;

  while ((match = inlineRegex.exec(text)) !== null) {
    const matchIndex = match.index;
    const matchText = match[0];
    const isColorMatch = matchText.startsWith('#');
    if (isColorMatch && !hasWhitespaceWordBoundary(text, matchIndex, matchIndex + matchText.length)) {
      continue;
    }

    if (matchIndex > lastIndex) {
      tokens.push({ type: 'text', text: text.substring(lastIndex, matchIndex) });
    }

    tokens.push({ type: isColorMatch ? 'color' : 'number', text: matchText });
    lastIndex = inlineRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', text: text.substring(lastIndex) });
  }

  return tokens;
}

function processInlineTextInTree(tokens: Token[]) {
  for (let j = 0; j < tokens.length; j++) {
    const token = tokens[j];
    if (token.type === 'text' && token.text) {
      const parsed = parseInlineText(token.text);
      if (parsed.length > 1 || (parsed.length === 1 && parsed[0].type !== 'text')) {
        tokens.splice(j, 1, ...parsed);
        j += parsed.length - 1;
      }
    } else if (token.type === 'comment' && token.text) {
      const parsed = parseInlineText(token.text, false);
      if (parsed.some((child) => child.type === 'color')) {
        token.children = parsed;
        delete token.text;
      }
    } else if (token.children && token.children.length > 0) {
      processInlineTextInTree(token.children);
    }
  }
}

function isWordLikeChar(char: string | undefined): boolean {
  return !!char && wordLikeCharRegex.test(char);
}

function isWhitespaceChar(char: string | undefined): boolean {
  return !!char && whitespaceRegex.test(char);
}

function getNextNonWhitespaceIndex(text: string, startIndex: number): number {
  for (let j = startIndex; j < text.length; j++) {
    if (!isWhitespaceChar(text[j])) return j;
  }
  return -1;
}

function isEscapedAt(text: string, index: number): boolean {
  let slashCount = 0;
  for (let j = index - 1; j >= 0 && text[j] === '\\'; j--) {
    slashCount++;
  }
  return slashCount % 2 === 1;
}

function isLikelyApostrophe(text: string, index: number): boolean {
  const prevChar = text[index - 1];
  const nextChar = text[index + 1];

  if (!isWordLikeChar(prevChar)) return false;
  if (isWordLikeChar(nextChar)) return true;
  if (!nextChar || isWhitespaceChar(nextChar)) return true;

  return /[.,;:!?…)\]}]/u.test(nextChar);
}

function isSingleQuoteCloseCandidate(text: string, index: number, allowFallback: boolean): boolean {
  if (isEscapedAt(text, index)) return false;

  const prevChar = text[index - 1];
  const nextChar = text[index + 1];

  if (!prevChar || isWhitespaceChar(prevChar)) return false;
  if (isWordLikeChar(prevChar) && isWordLikeChar(nextChar)) return false;

  if (!allowFallback && isWordLikeChar(prevChar) && isWhitespaceChar(nextChar)) {
    const nextNonWhitespaceIndex = getNextNonWhitespaceIndex(text, index + 1);
    if (nextNonWhitespaceIndex !== -1 && isWordLikeChar(text[nextNonWhitespaceIndex])) {
      return false;
    }
  }

  return true;
}

function findClosingQuote(text: string, openIndex: number, quoteChar: '"' | "'" | '`'): number {
  let fallbackIndex = -1;

  for (let j = openIndex + 1; j < text.length; j++) {
    if (text[j] !== quoteChar || isEscapedAt(text, j)) continue;

    if (quoteChar !== "'") return j;
    if (isSingleQuoteCloseCandidate(text, j, false)) return j;
    if (isSingleQuoteCloseCandidate(text, j, true)) {
      fallbackIndex = j;
    }
  }

  return fallbackIndex;
}

function assignDepths(tokens: Token[], parentDepth = -1) {
  for (const token of tokens) {
    if (depthTrackedTypes.has(token.type)) {
      token.depth = parentDepth + 1;
      if (token.children) {
        assignDepths(token.children, token.depth);
      }
    } else {
      if (parentDepth >= 0) {
        token.depth = parentDepth;
      } else {
        delete token.depth;
      }

      if (token.children) {
        assignDepths(token.children, parentDepth);
      }
    }
  }
}

function startsWithMarker(line: string, index: number, marker: string, caseInsensitive?: boolean): boolean {
  const segment = line.slice(index, index + marker.length);
  return caseInsensitive
    ? segment.toLowerCase() === marker.toLowerCase()
    : segment === marker;
}

function indexOfMarker(line: string, marker: string, startIndex: number, caseInsensitive?: boolean): number {
  if (caseInsensitive) {
    return line.toLowerCase().indexOf(marker.toLowerCase(), startIndex);
  }

  return line.indexOf(marker, startIndex);
}

function findLineCommentRule(
  line: string,
  index: number,
  rules: LineCommentRule[] | undefined,
  firstNonWhitespaceIndex: number
): LineCommentRule | null {
  if (!rules) return null;

  for (const rule of rules) {
    if (rule.anchored && index !== firstNonWhitespaceIndex) continue;
    if (!startsWithMarker(line, index, rule.marker, rule.caseInsensitive)) continue;

    if (rule.requiresWordBoundaryAfter) {
      const nextChar = line[index + rule.marker.length];
      if (nextChar && !isWhitespaceChar(nextChar)) continue;
    }

    return rule;
  }

  return null;
}

function findBlockCommentRule(line: string, index: number, rules: BlockCommentRule[] | undefined): BlockCommentRule | null {
  if (!rules) return null;

  for (const rule of rules) {
    if (startsWithMarker(line, index, rule.start, rule.caseInsensitive)) {
      return rule;
    }
  }

  return null;
}

function finalizeTokens(root: Token): Token[] {
  const finalTokens = root.children || [];
  processInlineTextInTree(finalTokens);
  assignDepths(finalTokens);

  return finalTokens;
}

export function tokenizeLineWithState(line: string, options: TokenizeLineOptions = {}): TokenizeLineResult {
  const root: Token = { type: 'text', children: [] };
  const stack: { token: Token; openChar?: string; closeIndex?: number }[] = [{ token: root }];
  const commentSyntax = options.comments || null;
  const firstNonWhitespaceIndex = getNextNonWhitespaceIndex(line, 0);
  let nextState: TokenizeState | null = options.state || null;
  let i = 0;
  const len = line.length;

  function getTop() {
    return stack[stack.length - 1];
  }

  function appendChild(parent: Token, child: Token) {
    if (!parent.children) parent.children = [];
    const lastChild = parent.children[parent.children.length - 1];
    if (child.type === 'text' && !child.children && lastChild && lastChild.type === 'text' && !lastChild.children) {
      lastChild.text = (lastChild.text || '') + (child.text || '');
    } else {
      parent.children.push(child);
    }
  }

  function addChar(char: string) {
    appendChild(getTop().token, { type: 'text', text: char });
  }

  function addComment(text: string) {
    appendChild(getTop().token, { type: 'comment', text });
  }

  function pushContainer(type: Token['type'], openChar: string, closeIndex?: number) {
    stack.push({
      token: { type, children: [{ type: 'text', text: openChar }] },
      openChar,
      closeIndex
    });
  }

  function closeTopContainer(closingChar: string) {
    addChar(closingChar);
    const closedFrame = stack.pop();
    if (closedFrame) {
      appendChild(getTop().token, closedFrame.token);
    }
  }

  function closeContainerAt(stackIndex: number, closingChar: string) {
    while (stack.length - 1 > stackIndex) {
      const unclosedFrame = stack.pop();
      if (!unclosedFrame) break;
      for (const child of unclosedFrame.token.children || []) {
        appendChild(getTop().token, child);
      }
    }

    closeTopContainer(closingChar);
  }

  function flattenUnclosedContainers() {
    while (stack.length > 1) {
      const unclosedFrame = stack.pop();
      if (!unclosedFrame) break;
      for (const child of unclosedFrame.token.children || []) {
        appendChild(getTop().token, child);
      }
    }
  }

  function getActiveQuoteFrameIndex(): number {
    for (let j = stack.length - 1; j > 0; j--) {
      const openChar = stack[j].openChar;
      if (openChar === '"' || openChar === "'" || openChar === '`') {
        return j;
      }
    }
    return -1;
  }

  const listMarker = nextState ? null : getListMarkerAtStart(line);
  if (listMarker) {
    if (listMarker.indent) {
      appendChild(getTop().token, { type: 'text', text: listMarker.indent });
    }
    appendChild(getTop().token, { type: 'list-marker', text: listMarker.marker });
    i = listMarker.indent.length + listMarker.marker.length;
  }

  while (i < len) {
    if (nextState) {
      const endIndex = indexOfMarker(line, nextState.blockCommentEnd, i, nextState.blockCommentCaseInsensitive);

      if (endIndex === -1) {
        addComment(line.substring(i));
        i = len;
        break;
      }

      addComment(line.substring(i, endIndex + nextState.blockCommentEnd.length));
      i = endIndex + nextState.blockCommentEnd.length;
      nextState = null;
      continue;
    }

    const char = line[i];
    const nextChar = line[i + 1];
    const top = getTop();
    const quoteFrameIndex = getActiveQuoteFrameIndex();
    const activeQuoteFrame = quoteFrameIndex === -1 ? null : stack[quoteFrameIndex];

    if (activeQuoteFrame && char === '\\') {
      addChar(char);
      if (i + 1 < len) {
        addChar(line[i + 1]);
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    if (activeQuoteFrame && char === activeQuoteFrame.openChar) {
      if (i === activeQuoteFrame.closeIndex) {
        closeContainerAt(quoteFrameIndex, char);
        i++;
      } else {
        addChar(char);
        i++;
      }
      continue;
    }

    const hexColor = getHexColorAt(line, i);
    if (hexColor) {
      appendChild(top.token, { type: 'color', text: hexColor });
      i += hexColor.length;
      continue;
    }

    if (!activeQuoteFrame) {
      const blockRule = findBlockCommentRule(line, i, commentSyntax?.block);
      if (blockRule) {
        const endSearchIndex = i + blockRule.start.length;
        const endIndex = indexOfMarker(line, blockRule.end, endSearchIndex, blockRule.caseInsensitive);

        if (endIndex === -1) {
          addComment(line.substring(i));
          nextState = {
            blockCommentEnd: blockRule.end,
            blockCommentCaseInsensitive: blockRule.caseInsensitive
          };
          i = len;
          break;
        }

        addComment(line.substring(i, endIndex + blockRule.end.length));
        i = endIndex + blockRule.end.length;
        continue;
      }

      const lineRule = findLineCommentRule(line, i, commentSyntax?.line, firstNonWhitespaceIndex);
      if (lineRule) {
        addComment(line.substring(i));
        i = len;
        break;
      }
    }

    if (char === '"' || char === "'" || char === '`') {
      if (char === "'" && isLikelyApostrophe(line, i)) {
        addChar(char);
        i++;
        continue;
      }

      const closeIndex = findClosingQuote(line, i, char);
      if (closeIndex !== -1) {
        const type = char === '`' ? 'code' : 'string';
        pushContainer(type, char, closeIndex);
      } else {
        addChar(char);
      }
      i++;
      continue;
    }

    if (char === '(') {
      pushContainer('paren', char);
      i++;
    } else if (char === '[') {
      pushContainer('bracket', char);
      i++;
    } else if (char === '{') {
      pushContainer('brace', char);
      i++;
    } else if (char === ')') {
      if (top.openChar === '(') {
        closeTopContainer(char);
      } else {
        addChar(char);
      }
      i++;
    } else if (char === ']') {
      if (top.openChar === '[') {
        closeTopContainer(char);
      } else {
        addChar(char);
      }
      i++;
    } else if (char === '}') {
      if (top.openChar === '{') {
        closeTopContainer(char);
      } else {
        addChar(char);
      }
      i++;
    } else {
      addChar(char);
      i++;
    }
  }

  flattenUnclosedContainers();

  return {
    tokens: finalizeTokens(root),
    state: nextState
  };
}

export interface TokenizeLineOptions {
  comments?: CommentSyntax | null;
  state?: TokenizeState | null;
}

export function tokenizeLine(line: string, options: TokenizeLineOptions = {}): Token[] {
  return tokenizeLineWithState(line, options).tokens;
}
