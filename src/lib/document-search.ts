export interface SearchMatch { start: number; end: number }
export interface SearchRect { left: number; top: number; width: number; height: number }

export function getSearchClipRect(element: Element): SearchRect {
  const bounds = element.getBoundingClientRect();
  return { left: bounds.left + element.clientLeft, top: bounds.top + element.clientTop,
    width: element.clientWidth, height: element.clientHeight };
}

/** 정규식 문법을 해석하지 않으며 대소문자 변환으로 원문 위치가 달라지지 않는다. */
export function findDocumentMatches(content: string, query: string): SearchMatch[] {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  return Array.from(content.matchAll(pattern), match => ({ start: match.index, end: match.index + match[0].length }));
}

export function findMatchFromOffset(matches: SearchMatch[], offset: number): number {
  let low = 0;
  let high = matches.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (matches[middle].start < offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function clipSearchRect(rect: SearchRect, clip: SearchRect): SearchRect | null {
  const left = Math.max(rect.left, clip.left);
  const top = Math.max(rect.top, clip.top);
  const right = Math.min(rect.left + rect.width, clip.left + clip.width);
  const bottom = Math.min(rect.top + rect.height, clip.top + clip.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

/** Range가 포함하는 요소의 여백 대신 실제 텍스트 조각만 강조한다. */
export function getSearchRangeRects(range: Range): DOMRect[] {
  const root = range.commonAncestorContainer;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const rects: DOMRect[] = [];
  for (let node = root instanceof Text ? root : walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text) || !range.intersectsNode(node)) continue;
    if (node.parentElement?.closest('.hl-syntax-hidden')) continue;
    if (node.parentElement && getComputedStyle(node.parentElement).visibility === 'hidden') continue;
    const part = document.createRange();
    part.setStart(node, node === range.startContainer ? range.startOffset : 0);
    part.setEnd(node, node === range.endContainer ? range.endOffset : node.length);
    rects.push(...Array.from(part.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0));
  }
  return rects;
}

/** 입력 요소의 글꼴·폭·여백과 스크롤을 그대로 사용한다. 렌더 모드의 투명 입력층에는 쓰지 않는다. */
export function measureTextareaMatches(input: HTMLTextAreaElement, matches: SearchMatch[]): SearchRect[][] {
  if (!matches.length) return [];
  const style = getComputedStyle(input);
  const mirror = document.createElement('div');
  for (const property of ['font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
    'font-feature-settings', 'font-variant-ligatures', 'line-height', 'letter-spacing', 'word-spacing',
    'text-indent', 'text-align', 'text-transform', 'tab-size', 'white-space', 'word-break', 'overflow-wrap',
    'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'direction']) {
    mirror.style.setProperty(property, style.getPropertyValue(property));
  }
  Object.assign(mirror.style, { position: 'fixed', left: '0', top: '0', width: `${input.clientWidth}px`,
    boxSizing: 'border-box', visibility: 'hidden', pointerEvents: 'none' });
  mirror.textContent = input.value + '\u200b';
  mirror.setAttribute('aria-hidden', 'true');
  document.body.append(mirror);
  try {
    const bounds = input.getBoundingClientRect();
    const origin = mirror.getBoundingClientRect();
    const node = mirror.firstChild!;
    return matches.map(match => {
      const range = document.createRange();
      range.setStart(node, Math.min(match.start, input.value.length));
      range.setEnd(node, Math.min(match.end, input.value.length));
      return Array.from(range.getClientRects(), rect => ({
        left: rect.left - origin.left + bounds.left + input.clientLeft - input.scrollLeft,
        top: rect.top - origin.top + bounds.top + input.clientTop - input.scrollTop,
        width: rect.width, height: rect.height
      }));
    });
  } finally { mirror.remove(); }
}

/** CSV/TSV의 따옴표와 CRLF를 보존해 셀 표시 경계를 원문에 연결한다. */
export function getDelimitedSearchCells(content: string, separator: string) {
  const cells: Array<{ row: number; column: number; offsets: number[] }> = [];
  let row = 0, column = 0, index = 0;
  while (index <= content.length) {
    const quoted = content[index] === '"';
    if (quoted) index++;
    const offsets = [index];
    while (index < content.length) {
      if (quoted && content[index] === '"') {
        if (content[index + 1] !== '"') { index++; break; }
        index += 2;
      } else if (!quoted && (content[index] === separator || /[\r\n]/.test(content[index]))) break;
      else if (content[index] === '\r' && content[index + 1] === '\n') index += 2;
      else index++;
      offsets.push(index);
    }
    cells.push({ row, column, offsets });
    if (index >= content.length) break;
    if (content[index] === separator) { index++; column++; }
    else { index += content[index] === '\r' && content[index + 1] === '\n' ? 2 : 1; row++; column = 0; }
  }
  return cells;
}
