import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

// Markdown 문법은 공용 해석기에 맡기고, 문서가 앱 DOM에 넣을 수 있는 것은
// 아래 표시 전용 태그와 속성으로 제한한다. 원문은 절대로 직렬화하지 않는다.
const markdown = new MarkdownIt({ html: true, linkify: true, maxNesting: 32 });
const tags = 'a abbr b bdi bdo blockquote br caption center cite code col colgroup dd del details dfn div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p pre q rp rt ruby s samp small span strong sub summary sup table tbody td th thead tfoot time tr u ul var wbr'.split(' ');
const containers = new Set(tags.filter((tag) => !['br', 'hr', 'img', 'wbr', 'col'].includes(tag)));

export interface MarkdownRichBlock {
  startLine: number;
  endLine: number;
  start: number;
  end: number;
  source: string;
  environment: Record<string, unknown>;
}

export function parseMarkdownRichBlocks(content: string, lineStarts: number[]): MarkdownRichBlock[] {
  if (!/[<!&\[]|^ {0,3}[-*_]/mu.test(content)) return [];
  const environment: Record<string, unknown> = {};
  const tokens = markdown.parse(content, environment);
  const ranges: Array<[number, number]> = [];
  const htmlParts = tokens.filter((token) => token.type === 'html_block' && token.map);
  const closingLines = new Map<string, number>();
  const openings = new Map<string, number[]>();
  for (const part of htmlParts) {
    const pattern = /<!--[\s\S]*?-->|<\/?([a-z][a-z\d-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/giu;
    let line = part.map![0];
    let cursor = 0;
    for (const match of part.content.matchAll(pattern)) {
      line += part.content.slice(cursor, match.index).split('\n').length - 1;
      const startLine = line;
      line += match[0].split('\n').length - 1;
      cursor = match.index! + match[0].length;
      const name = match[1]?.toLowerCase();
      if (!name || !containers.has(name)) continue;
      const stack = openings.get(name) ?? [];
      if (match[0].startsWith('</')) {
        const openingLine = stack.pop();
        if (openingLine !== undefined) closingLines.set(`${name}:${openingLine}`, line + 1);
      } else if (!/\/\s*>$/u.test(match[0])) stack.push(startLine);
      openings.set(name, stack);
    }
  }
  // HTML 토큰만 훑으면 코드 울타리나 인라인 코드의 가짜 닫는 태그는
  // details/div의 끝으로 오인하지 않는다. 빈 줄을 넘는 중첩 컨테이너도 묶는다.
  let coveredUntil = 0;
  for (const token of htmlParts) {
    const map = token.map!;
    if (map[0] < coveredUntil) continue;
    const opening = token.content.match(/^ {0,3}<([a-z][a-z\d-]*)\b/iu)?.[1]?.toLowerCase();
    const endLine = Math.max(map[1], closingLines.get(`${opening}:${map[0]}`) ?? map[1]);
    ranges.push([map[0], Math.min(endLine, lineStarts.length)]);
    coveredUntil = endLine;
  }
  for (const token of tokens) {
    if (token.type === 'hr' && token.map) ranges.push([token.map[0], token.map[1]]);
    if (token.type !== 'inline' || !token.map) continue;
    if (!token.children?.some((child) => ['html_inline', 'image', 'link_open'].includes(child.type))
      && !/&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/iu.test(token.content)) continue;
    ranges.push([token.map[0], token.map[1]]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range[0] < previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
  }
  return merged.slice(0, 500).map(([startLine, endLine]) => {
    const start = lineStarts[startLine];
    // The final newline belongs to the following source line, not the preview.
    let end = lineStarts[endLine] ?? content.length;
    if (content[end - 1] === '\n') end -= content[end - 2] === '\r' ? 2 : 1;
    return { startLine, endLine: endLine - 1, start, end, source: content.slice(start, end), environment };
  }).filter((block) => block.source.length <= 128 * 1024);
}

export function renderMarkdownRichText(source: string, environment: Record<string, unknown> = {}): string {
  if (typeof window === 'undefined') return '';
  const fragment = DOMPurify.sanitize(markdown.render(source, environment), {
    ALLOWED_TAGS: tags,
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'width', 'height', 'align', 'dir', 'lang', 'open', 'start', 'reversed', 'value', 'colspan', 'rowspan', 'scope', 'datetime'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true
  });
  for (const element of fragment.querySelectorAll('*')) {
    for (const name of ['width', 'height', 'colspan', 'rowspan']) {
      const value = element.getAttribute(name);
      if (value && !/^\d{1,4}%?$/u.test(value)) element.removeAttribute(name);
    }
    const align = element.getAttribute('align');
    if (align && !/^(left|center|right|justify)$/u.test(align)) element.removeAttribute('align');
    for (const attribute of ['href', 'src']) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      // No file:, data:, custom protocols, protocol-relative URLs or controls.
      const safe = !/[\u0000-\u0020\u007f\\]/u.test(value)
        && (attribute === 'href' ? /^(https?:\/\/|mailto:|#)/iu.test(value) : /^https?:\/\//iu.test(value));
      if (!safe) {
        element.removeAttribute(attribute);
        if (attribute === 'src') {
          element.setAttribute('title', value);
          if (!/^[/\\]|[\u0000-\u001f\u007f]|^[a-z][a-z\d+.-]*:/iu.test(value)) {
            element.setAttribute('data-local-image', value);
          }
        }
      }
    }
    if (element.tagName === 'IMG') {
      element.setAttribute('loading', 'lazy');
      element.setAttribute('referrerpolicy', 'no-referrer');
      element.setAttribute('draggable', 'false');
    }
  }
  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML;
}

export function findMarkdownAnchorLine(content: string, fragment: string): number | null {
  let id: string;
  try { id = decodeURIComponent(fragment.replace(/^#/u, '')); } catch { return null; }
  const counts = new Map<string, number>();
  const tokens = markdown.parse(content, {});
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== 'heading_open' || !token.map) continue;
    const inline = tokens[index + 1];
    const text = inline?.children?.filter((child) => ['text', 'code_inline'].includes(child.type)).map((child) => child.content).join('') ?? '';
    const base = text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/gu, '-');
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    if ((count ? `${base}-${count}` : base) === id) return token.map[0];
  }
  return null;
}
