import { getListMarkerAtStart } from './list-markers';
import { getCheckboxMarkerAtStart } from './checkbox-markers';
import type { MarkdownHeadingLevel } from './markdown-settings';

export interface Token {
  type:
    | 'text'
    | 'string'
    | 'code'
    | 'number'
    | 'list-marker'
    | 'checkbox'
    | 'heading-marker'
    | 'quote-marker'
    | 'strong'
    | 'emphasis'
    | 'strike'
    | 'comment'
    | 'color'
    | 'paren'
    | 'bracket'
    | 'brace'
    | 'key'
    | 'boolean'
    | 'literal'
    | 'punctuation'
    | 'operator'
    | 'section'
    | 'timestamp'
    | 'keyword'
    | 'link'
    | 'pattern'
    | 'attribute'
    | 'owner'
    | 'tag'
    | 'directive'
    | 'hash'
    | 'host'
    | 'invalid';
  text?: string;
  children?: Token[];
  depth?: number;
  start?: number;
  end?: number;
  hiddenSyntax?: boolean;
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
  blockCommentEnd?: string;
  blockCommentCaseInsensitive?: boolean;
  codeFenceLength?: number;
}

export type FencedCodeLinePosition = 'start' | 'middle' | 'end';

export interface TokenizeLineResult {
  tokens: Token[];
  state: TokenizeState | null;
  fencedCodePosition?: FencedCodeLinePosition;
  headingLevel?: MarkdownHeadingLevel;
}

const hexColorAtStartRegex = /^#[0-9a-fA-F]{6}$/;
const wordLikeCharRegex = /[\p{L}\p{M}\p{N}]/u;
const whitespaceRegex = /\s/u;
const depthTrackedTypes = new Set<Token['type']>(['string', 'paren', 'bracket', 'brace']);

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

function parseInlineText(text: string, includeNumbers = true): Token[] {
  const tokens: Token[] = [];
  const inlineRegex = includeNumbers
    ? /#[0-9a-fA-F]{6}(?![0-9a-zA-Z_])|\d+(?:\.\d+)?/g
    : /#[0-9a-fA-F]{6}(?![0-9a-zA-Z_])/g;
  let lastIndex = 0;
  let match;

  while ((match = inlineRegex.exec(text)) !== null) {
    const matchIndex = match.index;
    const matchText = match[0];
    const isColorMatch = matchText.startsWith('#');
    if (isColorMatch && !hasWhitespaceWordBoundary(text, matchIndex, matchIndex + matchText.length)) {
      // 색상 코드가 아니면 # 다음의 숫자도 일반 텍스트 규칙으로 다시 확인한다.
      inlineRegex.lastIndex = matchIndex + 1;
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

function getCodeFenceLengthAtLineStart(line: string): number | null {
  const match = line.match(/^[ \t]*(`{3,})/);
  return match?.[1]?.length ?? null;
}

function isClosingCodeFence(line: string, openingFenceLength: number): boolean {
  const match = line.match(/^[ \t]*(`{3,})([ \t]*)$/);
  return !!match?.[1] && match[1].length >= openingFenceLength;
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

function getMarkdownInlineTokenAt(line: string, index: number): Token | null {
  if (isEscapedAt(line, index)) return null;
  const firstChar = line[index];
  if (firstChar === '[') {
    const link = line.slice(index).match(/^\[[^\]\r\n]+\]\([^)\r\n]+\)/u)?.[0];
    return link ? { type: 'link', text: link } : null;
  }

  if (firstChar === '~') {
    const strike = line.slice(index).match(/^~~(?=\S)(.+?\S|\S)~~/u)?.[0];
    if (strike) return markdownDelimitedToken('strike', strike, 2);
  }
  if (firstChar !== '*' && firstChar !== '_') return null;
  if (firstChar === '_' && isWordLikeChar(line[index - 1])) return null;
  const remaining = line.slice(index);
  const triple = remaining.match(firstChar === '*' ? /^\*\*\*(?=\S)(.+?\S|\S)\*\*\*/u : /^___(?=\S)(.+?\S|\S)___/u)?.[0];
  if (triple) return { type: 'strong', text: triple, children: [markdownDelimitedToken('emphasis', triple, 3)] };
  const strongPattern = firstChar === '*'
    ? /^\*\*[^*\r\n]+\*\*/u
    : /^__[^_\r\n]+__/u;
  const strong = remaining.match(strongPattern)?.[0];
  if (strong) return markdownDelimitedToken('strong', strong, 2);

  const emphasisPattern = firstChar === '*'
    ? /^\*[^*\r\n]+\*/u
    : /^_[^_\r\n]+_/u;
  const emphasis = remaining.match(emphasisPattern)?.[0];
  return emphasis ? markdownDelimitedToken('emphasis', emphasis, 1) : null;
}

function markdownDelimitedToken(type: Token['type'], text: string, width: number): Token {
  return { type, text, children: [
    { type: 'text', text: text.slice(0, width), hiddenSyntax: true },
    ...tokenizeLineWithState(text.slice(width, -width), { markdown: { hideHeadingMarkers: true }, suppressCodeFence: true }).tokens,
    { type: 'text', text: text.slice(-width), hiddenSyntax: true }
  ] };
}

export function tokenizeLineWithState(line: string, options: TokenizeLineOptions = {}): TokenizeLineResult {
  const root: Token = { type: 'text', children: [] };
  const stack: { token: Token; openChar?: string; closeIndex?: number; hideSyntax?: boolean }[] = [{ token: root }];
  const commentSyntax = options.comments || null;
  const firstNonWhitespaceIndex = getNextNonWhitespaceIndex(line, 0);
  let nextState: TokenizeState | null = options.state || null;
  let headingLevel: MarkdownHeadingLevel | undefined;
  let i = 0;
  const len = line.length;

  function getTop() {
    return stack[stack.length - 1];
  }

  function appendChild(parent: Token, child: Token) {
    if (!parent.children) parent.children = [];
    const lastChild = parent.children[parent.children.length - 1];
    if (
      child.type === 'text'
      && !child.children
      && lastChild
      && lastChild.type === 'text'
      && !lastChild.children
      && lastChild.hiddenSyntax === child.hiddenSyntax
    ) {
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

  function pushContainer(
    type: Token['type'],
    openChar: string,
    closeIndex?: number,
    hideSyntax = false
  ) {
    stack.push({
      token: {
        type,
        children: [{ type: 'text', text: openChar, hiddenSyntax: hideSyntax || undefined }]
      },
      openChar,
      closeIndex,
      hideSyntax
    });
  }

  function closeTopContainer(closingChar: string) {
    const closingFrame = getTop();
    if (closingFrame.token.type === 'code') {
      appendChild(closingFrame.token, { type: 'text', text: closingChar, hiddenSyntax: closingFrame.hideSyntax || undefined });
    } else {
      addChar(closingChar);
    }
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

  if (nextState?.codeFenceLength) {
    const closesCodeFence = isClosingCodeFence(line, nextState.codeFenceLength);
    if (closesCodeFence) {
      appendChild(root, { type: 'code', text: line, hiddenSyntax: true });
    } else {
      const contentTokens = tokenizeLineWithState(line, {
        comments: commentSyntax,
        state: null,
        suppressCodeFence: true
      }).tokens;
      appendChild(root, { type: 'code', children: contentTokens });
    }
    if (closesCodeFence) {
      nextState = null;
    }
    return {
      tokens: finalizeTokens(root),
      state: nextState,
      fencedCodePosition: closesCodeFence ? 'end' : 'middle'
    };
  }

  if (!nextState && !options.suppressCodeFence) {
    const codeFenceLength = getCodeFenceLengthAtLineStart(line);
    if (codeFenceLength !== null) {
      appendChild(root, { type: 'code', text: line, hiddenSyntax: true });
      return {
        tokens: finalizeTokens(root),
        state: { codeFenceLength },
        fencedCodePosition: 'start'
      };
    }
  }

  if (!nextState && options.lineCheckboxes) {
    const checkbox = getCheckboxMarkerAtStart(line);
    if (checkbox) {
      if (checkbox.indent) appendChild(root, { type: 'text', text: checkbox.indent });
      appendChild(root, { type: 'checkbox', text: checkbox.marker });
      i = checkbox.indent.length + checkbox.marker.length;
    }
  }

  if (!nextState && options.markdown) {
    const headingMatch = line.match(/^([ \t]{0,3})(#{1,6})([ \t]+)/u);
    const hashes = headingMatch?.[2];
    if (headingMatch && hashes) {
      const indent = headingMatch[1] || '';
      const spacing = headingMatch[3] || '';
      if (indent) appendChild(root, { type: 'text', text: indent });
      appendChild(root, {
        type: 'heading-marker',
        text: `${hashes}${spacing}`,
        hiddenSyntax: options.markdown.hideHeadingMarkers || undefined
      });
      headingLevel = hashes.length as MarkdownHeadingLevel;
      i = indent.length + hashes.length + spacing.length;
    }
  }

  if (!nextState && options.markdown && headingLevel === undefined) {
    const quoteMatch = line.match(/^([ \t]{0,3})(>[ \t]?)/u);
    if (quoteMatch) {
      const indent = quoteMatch[1] || '';
      const marker = quoteMatch[2] || '';
      if (indent) appendChild(root, { type: 'text', text: indent });
      appendChild(root, { type: 'quote-marker', text: marker });
      i = indent.length + marker.length;
    }
  }

  const listMarker = nextState || headingLevel !== undefined || i > 0
    ? null
    : getListMarkerAtStart(line);

  if (listMarker) {
    if (listMarker.indent) {
      appendChild(getTop().token, { type: 'text', text: listMarker.indent });
    }
    appendChild(getTop().token, { type: 'list-marker', text: listMarker.marker });
    i = listMarker.indent.length + listMarker.marker.length;
  }

  while (i < len) {
    if (nextState?.blockCommentEnd) {
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
      const markdownInlineToken = options.markdown
        ? getMarkdownInlineTokenAt(line, i)
        : null;
      if (markdownInlineToken) {
        appendChild(top.token, markdownInlineToken);
        i += markdownInlineToken.text?.length ?? 0;
        continue;
      }

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
        const hideSyntax = type === 'code' && /\S/u.test(line.slice(i + 1, closeIndex));
        pushContainer(type, char, closeIndex, hideSyntax);
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
    state: nextState,
    headingLevel
  };
}

export interface MarkdownTokenizeOptions {
  hideHeadingMarkers: boolean;
}

export interface TokenizeLineOptions {
  comments?: CommentSyntax | null;
  state?: TokenizeState | null;
  suppressCodeFence?: boolean;
  lineCheckboxes?: boolean;
  markdown?: MarkdownTokenizeOptions;
}

export function tokenizeLine(line: string, options: TokenizeLineOptions = {}): Token[] {
  return tokenizeLineWithState(line, options).tokens;
}
