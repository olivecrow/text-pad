import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import { renderMappedMarkdown, markdownHtmlTags, markdownContainerTags, type MappedMarkdown } from './markdown-source-renderer';

// Markdown 문법은 공용 해석기에 맡기고, 문서가 앱 DOM에 넣을 수 있는 것은
// 아래 표시 전용 태그와 속성으로 제한한다. 원문은 절대로 직렬화하지 않는다.
const markdown = new MarkdownIt({ html: true, linkify: true, maxNesting: 32 });
const tags = markdownHtmlTags;
const containers = markdownContainerTags;

export interface MarkdownRichBlock {
  startLine: number;
  endLine: number;
  start: number;
  end: number;
  source: string;
  environment: Record<string, unknown>;
  listChunk?: { listStart: number; listEnd: number; orderedStart?: number };
}

const maxRichBlockCharacters = 128 * 1024;
const listChunkLines = 16;

export function parseMarkdownRichBlocks(content: string, lineStarts: number[], environment: Record<string, unknown> = {},
  regions?: MarkdownRichBlock[], localLists?: MarkdownRichBlock[]): MarkdownRichBlock[] {
  // 웹 주소의 스킴(:)도 자동 링크 해석 후보에 포함한다.
  if (!/[<!&\[*_~@:]|^ {0,3}(?:[>\-#+]|\d+[.)][ \t])/mu.test(content)) return [];
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
  const lists: Array<[number, number]> = [];
  for (const token of tokens) {
    if (['bullet_list_open', 'ordered_list_open'].includes(token.type) && token.map) lists.push(token.map);
    if (['bullet_list_close', 'ordered_list_close'].includes(token.type)) lists.pop();
    if (['hr', 'blockquote_open'].includes(token.type) && token.map) ranges.push([token.map[0], token.map[1]]);
    if (token.type !== 'inline' || !token.map) continue;
    if (!token.children?.some((child) => ['html_inline', 'image', 'link_open'].includes(child.type))
      && !/&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/iu.test(token.content)
      && !(token.map[1] - token.map[0] > 1 && token.children?.some((child) => ['em_open', 'strong_open', 's_open'].includes(child.type)))) continue;
    // 하위 항목만 잘라 다시 해석하면 들여쓰기를 코드 블록으로 오인한다.
    ranges.push(lists.length ? [...lists[0]] : [token.map[0], token.map[1]]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range[0] < previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
  }
  const toBlock = ([startLine, endLine]: [number, number]): MarkdownRichBlock => {
    const start = lineStarts[startLine];
    // The final newline belongs to the following source line, not the preview.
    let end = lineStarts[endLine] ?? content.length;
    if (content[end - 1] === '\n') end -= content[end - 2] === '\r' ? 2 : 1;
    return { startLine, endLine: endLine - 1, start, end, source: content.slice(start, end), environment };
  };
  // 화면 밖의 수천 항목을 한 HTML 덩어리로 만들면 한 글자를 바꿔도 전체 DOM이 교체된다.
  // 빈 줄로 본문 문단을 나누지 않는 최상위 목록은 항목 사이에서 나눌 수 있다.
  type SplitList = { start: number; end: number; nextLine: number; items: number[]; orderedStart?: number; splittable: boolean };
  const splitLists = new Map<number, SplitList>();
  let list: SplitList | undefined;
  for (const token of tokens) {
    if (token.level === 0 && token.map && (token.type === 'bullet_list_open' || token.type === 'ordered_list_open')) {
      list = { start: token.map[0], end: token.map[1], nextLine: token.map[0], items: [], splittable: true,
        orderedStart: token.type === 'ordered_list_open' ? Number(token.attrGet('start') ?? 1) : undefined };
    } else if (list) {
      if (token.type === 'list_item_open' && token.level === 1) {
        if (!token.map || token.map[0] !== list.nextLine) list.splittable = false;
        else {
          list.items.push(token.map[0]);
          list.nextLine = token.map[1];
        }
      } else if (token.level === 0) {
        if (list.splittable && list.items.length > 1 && list.end - list.start > listChunkLines && list.nextLine === list.end) {
          splitLists.set(list.start, list);
        }
        list = undefined;
      } else if (token.type === 'html_block' || token.type === 'heading_open'
        || (token.type === 'paragraph_open' && !token.hidden)
        || token.children?.some(child => child.type === 'html_inline')) {
        list.splittable = false;
      }
    }
  }
  const blocks = merged.slice(0, 500).flatMap((range) => {
    const block = toBlock(range);
    if (block.source.length > maxRichBlockCharacters) return [];
    const split = splitLists.get(range[0]);
    if (!split || split.end !== range[1]) return [block];
    const chunks: MarkdownRichBlock[] = [];
    for (let itemIndex = 0; itemIndex < split.items.length;) {
      const line = split.items[itemIndex];
      let endItem = itemIndex + 1;
      while (endItem < split.items.length && (split.items[endItem + 1] ?? split.end) - line <= listChunkLines) endItem++;
      const chunk = toBlock([line, split.items[endItem] ?? split.end]);
      chunk.listChunk = { listStart: block.start, listEnd: block.end,
        orderedStart: split.orderedStart === undefined ? undefined : split.orderedStart + itemIndex };
      chunks.push(chunk);
      itemIndex = endItem;
    }
    return chunks;
  });
  if (regions || localLists) {
    regions?.push(...blocks);
    let rangeIndex = 0;
    for (const token of tokens) {
      if (token.level !== 0 || !token.map) continue;
      const output = token.type === 'paragraph_open' || token.type === 'heading_open' ? regions
        : token.type === 'bullet_list_open' || token.type === 'ordered_list_open' ? localLists : undefined;
      if (!output) continue;
      while (rangeIndex < merged.length && merged[rangeIndex][1] <= token.map[0]) rangeIndex++;
      if (rangeIndex < merged.length && merged[rangeIndex][0] < token.map[1]) continue;
      output.push(toBlock([token.map[0], token.map[1]]));
    }
    regions?.sort((a, b) => a.start - b.start);
  }
  return blocks;
}

export function renderMarkdownRichText(source: string, environment: Record<string, unknown> = {}, inline = false, editable = false, showHeadingMarkers = false, orderedListStart?: number): string {
  if (typeof window === 'undefined') return '';
  let mapped: MappedMarkdown | undefined;
  if (editable || inline) {
    try { mapped = renderMappedMarkdown(source, environment, { inline, showHeadingMarkers, orderedListStart }); }
    catch {
      // 해석기가 제공하지 못한 경계를 추측하지 않는다. 이 블록만 편집 가능한 원문으로 표시한다.
      mapped = { html: '', attribute: `data-rich-${crypto.randomUUID()}`, maps: [Array.from({ length: source.length + 1 }, (_, i) => i)], texts: [source] };
      mapped.html = `<pre><span ${mapped.attribute}="0">${markdown.utils.escapeHtml(source)}</span></pre>`;
    }
  }
  const fragment = DOMPurify.sanitize(mapped?.html ?? (inline ? markdown.renderInline(source, environment) : markdown.render(source, environment)), {
    ALLOWED_TAGS: tags,
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'width', 'height', 'align', 'dir', 'lang', 'open', 'start', 'reversed', 'value', 'colspan', 'rowspan', 'scope', 'datetime'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    // 호출마다 생성한 속성 하나만 허용한다. 사용자 원문은 편집 위치 속성을 주입할 수 없다.
    ADD_ATTR: mapped ? [mapped.attribute] : [],
    RETURN_DOM_FRAGMENT: true
  });
  for (const element of fragment.querySelectorAll('*')) {
    if (mapped && element.hasAttribute(mapped.attribute)) {
      const spanIndex = Number(element.getAttribute(mapped.attribute));
      const offsets = mapped.maps[spanIndex];
      element.removeAttribute(mapped.attribute);
      if (offsets) {
        element.setAttribute('data-rich-offsets', offsets.join(','));
        if (mapped.trailingWhitespaceSpans?.has(spanIndex)) element.classList.add('rich-trailing-whitespace');
      }
    }
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
