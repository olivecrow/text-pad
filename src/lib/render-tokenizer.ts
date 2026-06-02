export interface Token {
  type: 'text' | 'string' | 'code' | 'number' | 'comment' | 'paren' | 'bracket' | 'brace';
  text?: string;
  children?: Token[];
  depth?: number;
}

function parseNumbers(text: string): Token[] {
  const tokens: Token[] = [];
  const numRegex = /\b\d+(?:\.\d+)?\b/g;
  let lastIndex = 0;
  let match;

  while ((match = numRegex.exec(text)) !== null) {
    const matchIndex = match.index;
    const matchText = match[0];

    if (matchIndex > lastIndex) {
      tokens.push({ type: 'text', text: text.substring(lastIndex, matchIndex) });
    }

    tokens.push({ type: 'number', text: matchText });
    lastIndex = numRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', text: text.substring(lastIndex) });
  }

  return tokens;
}

function processNumbersInTree(tokens: Token[]) {
  for (let j = 0; j < tokens.length; j++) {
    const token = tokens[j];
    if (token.type === 'text' && token.text) {
      const parsed = parseNumbers(token.text);
      if (parsed.length > 1 || (parsed.length === 1 && parsed[0].type === 'number')) {
        tokens.splice(j, 1, ...parsed);
        j += parsed.length - 1;
      }
    } else if (token.children && token.children.length > 0) {
      processNumbersInTree(token.children);
    }
  }
}

const wordLikeCharRegex = /[\p{L}\p{M}\p{N}]/u;
const whitespaceRegex = /\s/u;
const depthTrackedTypes = new Set<Token['type']>(['string', 'code', 'paren', 'bracket', 'brace']);

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

export function tokenizeLine(line: string): Token[] {
  const root: Token = { type: 'text', children: [] };
  const stack: { token: Token; openChar?: string; closeIndex?: number }[] = [{ token: root }];

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

  while (i < len) {
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

    if (!activeQuoteFrame && ((char === '/' && nextChar === '/') || char === '#')) {
      appendChild(top.token, { type: 'comment', text: line.substring(i) });
      i = len;
      break;
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
  const finalTokens = root.children || [];
  processNumbersInTree(finalTokens);
  assignDepths(finalTokens);

  return finalTokens;
}
