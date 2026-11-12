import MarkdownIt, { type Token } from 'markdown-it';

// 표시 문자열을 원문에서 재검색하지 않고 해석기가 소비한 범위를 기록한다.
// 이 해석기는 편집 가능한 복합 블록에만 사용한다. 원문은 재직렬화하지 않는다.
const parser = new MarkdownIt({ html: true, linkify: true, maxNesting: 32 });
// 편집 가능한 주소는 %20과 국제화 도메인까지 원문 그대로 표시한다.
// 링크 대상의 정규화·검증은 해석기의 기본 동작을 유지한다.
parser.normalizeLinkText = text => text;
export const markdownHtmlTags = 'a abbr b bdi bdo blockquote br caption center cite code col colgroup dd del details dfn div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p pre q rp rt ruby s samp small span strong sub summary sup table tbody td th thead tfoot time tr u ul var wbr'.split(' ');
export const markdownContainerTags = new Set(markdownHtmlTags.filter(tag => !['br', 'hr', 'img', 'wbr', 'col'].includes(tag)));
type Position = { start: number; end: number };
const positions = new WeakMap<Token, Position>();
const pendingStarts = new WeakMap<object, number>();
const BaseState = parser.inline.State;
parser.inline.State = class extends BaseState {
  pushPending() {
    const start = pendingStarts.get(this) ?? this.pos - this.pending.length;
    const length = this.pending.length;
    const token = super.pushPending();
    positions.set(token, { start, end: start + length });
    return token;
  }
};
// 보류 중인 일반 문자의 시작을 확정할 수 있게 기본 마지막 분기도 규칙으로 둔다.
parser.inline.ruler.push('source_character', (state, silent) => {
  if (!silent) state.pending += state.src[state.pos];
  state.pos += 1;
  return true;
});
for (const { name, fn } of [...parser.inline.ruler.__rules__]) {
  parser.inline.ruler.at(name, (state, silent) => {
    if (silent) return fn(state, true);
    const start = state.pos;
    const count = state.tokens.length;
    pendingStarts.set(state, start - state.pending.length);
    const matched = fn(state, false);
    if (!matched) return false;
    let marker = start;
    for (const token of state.tokens.slice(count)) {
      if (positions.has(token)) continue;
      let from = start;
      let end = state.pos;
      if (name === 'emphasis' || name === 'strikethrough') {
        from = marker; end = marker += token.content.length;
      } else if (name === 'backticks' && token.type === 'code_inline') {
        from += token.markup.length;
        end -= token.markup.length;
        const raw = state.src.slice(from, end).replace(/\n/gu, ' ');
        if (raw.length !== token.content.length) { from += 1; end -= 1; }
      } else if (name === 'autolink' && token.type === 'text') {
        from += 1; end -= 1;
      } else if (name === 'linkify' && token.type === 'text') {
        from = end - token.content.length;
      } else if (name === 'newline' && token.type === 'hardbreak') {
        while (from > 0 && state.src[from - 1] === ' ') from -= 1;
      }
      positions.set(token, { start: from, end });
    }
    return true;
  });
}
// 강조 판정 뒤에 남은 밑줄 등은 일반 문자와 합쳐야 이메일 전체를 인식한다.
const joinFragments = parser.inline.ruler2.__rules__.find(rule => rule.name === 'fragments_join')!.fn;
parser.inline.ruler2.at('fragments_join', state => {
  let joined: Position | undefined;
  for (const token of state.tokens) {
    if (token.type !== 'text') { joined = undefined; continue; }
    const part = positions.get(token);
    if (part && token.content) joined = { start: joined?.start ?? part.start, end: part.end };
    if (joined) positions.set(token, joined);
  }
  joinFragments(state);
});
// 문자 참조와 이스케이프는 일반 문자와 별도로 원문 경계를 유지한다.
parser.core.ruler.disable('text_join');
// 자동 링크가 나눈 텍스트는 주소 검출기의 원문 범위에 연결한다.
const linkify = parser.core.ruler.__rules__.find(rule => rule.name === 'linkify')!.fn;
parser.core.ruler.at('linkify', state => {
  const originals = state.tokens.map(token => token.children);
  linkify(state);
  state.tokens.forEach((block, index) => {
    const before = originals[index];
    const after = block.children;
    if (!before || !after || before === after) return;
    let cursor = 0;
    for (const [i, original] of before.entries()) {
      if (after[cursor] === original) { cursor += 1; continue; }
      const position = positions.get(original)!;
      let consumed = 0;
      for (const match of state.md.linkify.match(original.content) ?? []) {
        // 기본 연결 규칙과 같은 순서로 새 일반 텍스트와 링크 토큰을 소비한다.
        if (match.index === 0 && before[i - 1]?.type === 'text_special') continue;
        if (!state.md.validateLink(state.md.normalizeLink(match.url))) continue;
        if (consumed < match.index) {
          positions.set(after[cursor++], { start: position.start + consumed, end: position.start + match.index });
        }
        const label = after[cursor + 1];
        positions.set(label, { start: position.start + match.index, end: position.start + match.lastIndex });
        cursor += 3;
        consumed = match.lastIndex;
      }
      if (consumed < original.content.length) {
        positions.set(after[cursor++], { start: position.start + consumed, end: position.end });
      }
    }
  });
});

// 목록·인용 접두부가 제거된 해석기 상태에서 표 셀의 실제 원문 경계를 기록한다.
// 표 해석기가 먼저 제거하는 \|의 역슬래시도 표시 문자 하나의 범위에 포함한다.
const tableCellOffsets = new WeakMap<Token, number[]>();
const tableRule = parser.block.ruler.__rules__.find(rule => rule.name === 'table')!;
const parseTable = tableRule.fn;
parser.block.ruler.at('table', (state, startLine, endLine, silent) => {
  const count = state.tokens.length;
  if (!parseTable(state, startLine, endLine, silent)) return false;
  if (silent) return true;
  let cells: Array<{ text: string; offsets: number[] }> = [];
  let column = 0;
  let rowEnd = 0;
  for (const token of state.tokens.slice(count)) {
    if (token.type === 'tr_open' && token.map) {
      const row = token.map[0];
      const begin = state.bMarks[row] + state.tShift[row];
      rowEnd = state.eMarks[row];
      const raw = state.src.slice(begin, rowEnd);
      const start = begin + raw.length - raw.trimStart().length;
      const line = raw.trim();
      cells = [];
      column = 0;
      let text = '';
      let offsets: number[] = [];
      for (let i = 0; i <= line.length; i++) {
        if (i === line.length || line[i] === '|' && line[i - 1] !== '\\') {
          cells.push({ text, offsets: [...offsets, start + i] });
          text = ''; offsets = [];
        } else {
          if (line[i] === '|' && line[i - 1] === '\\') {
            text = text.slice(0, -1);
            offsets.pop();
            offsets.push(start + i - 1);
          } else offsets.push(start + i);
          text += line[i];
        }
      }
      if (cells[0]?.text === '') cells.shift();
      if (cells.at(-1)?.text === '') cells.pop();
    } else if (token.type === 'inline') {
      const cell = cells[column++];
      if (!cell) { tableCellOffsets.set(token, [rowEnd]); continue; }
      if (cell.text.trim() !== token.content) throw new Error('Unmapped nested table cell');
      const leading = cell.text.length - cell.text.trimStart().length;
      tableCellOffsets.set(token, cell.offsets.slice(leading, leading + token.content.length + 1));
    }
  }
  return true;
}, { alt: tableRule.alt });

export interface MappedMarkdown {
  html: string;
  attribute: string;
  maps: number[][];
  texts: string[];
  codeRanges?: Array<{ start: number; end: number }>;
  disclosures?: Array<{ bodyStart: number; end: number; open: boolean }>;
}

export function renderMappedMarkdown(source: string, environment: Record<string, unknown>, options: { inline?: boolean; showHeadingMarkers?: boolean } = {}): MappedMarkdown {
  const normalized = source.replace(/\r\n?/gu, '\n');
  const originalOffsets: number[] = [];
  for (let pos = 0; pos < source.length; pos += 1) {
    originalOffsets.push(pos);
    if (source[pos] === '\r' && source[pos + 1] === '\n') pos += 1;
  }
  originalOffsets.push(source.length);
  const lines = normalized.split('\n');
  const starts: number[] = [];
  let length = 0;
  for (const line of lines) { starts.push(length); length += line.length + 1; }
  const maps: number[][] = [];
  const texts: string[] = [];
  const codeRanges: Array<{ start: number; end: number }> = [];
  let codeDepth = 0;
  const disclosures: NonNullable<MappedMarkdown['disclosures']> = [];
  const disclosureStack: number[] = [];
  const attribute = `data-rich-${crypto.randomUUID()}`;
  const escape = parser.utils.escapeHtml;
  function mapped(text: string, offsets: number[]): string {
    if (!text) return '';
    if (offsets.length !== text.length + 1 || offsets.some(pos => !Number.isFinite(pos))) {
      throw new Error('Markdown source boundary mismatch');
    }
    const id = maps.push(offsets.map(pos => originalOffsets[Math.min(pos, normalized.length)])) - 1;
    texts.push(text);
    if (codeDepth > 0) codeRanges.push({ start: maps[id][0], end: maps[id].at(-1)! });
    return `<span ${attribute}="${id}">${escape(text)}</span>`;
  }
  // 블록 해석기가 제거한 인용·목록 접두부와 들여쓰기를 줄 단위로 복원한다.
  function blockOffsets(token: Token): number[] {
    if (!token.map) throw new Error('Missing Markdown block map');
    const result: number[] = [];
    let lineIndex = token.map[0] + (token.type === 'fence' ? 1 : 0);
    const parts = token.content.split('\n');
    parts.forEach((part, index) => {
      if (index === parts.length - 1 && part === '') return;
      const line = lines[lineIndex] ?? '';
      const column = line.lastIndexOf(part);
      if (column < 0) throw new Error('Unmapped Markdown indentation');
      const begin = starts[lineIndex] + column;
      for (let i = 0; i < part.length; i++) result.push(begin + i);
      result.push(begin + part.length);
      lineIndex += 1;
      if (index < parts.length - 1) {
        // 줄바꿈 뒤 경계는 다음 줄의 첫 글자 경계로 연결한다.
        if (index < parts.length - 2 || parts[index + 1] !== '') result.pop();
        if (index < parts.length - 2 || parts[index + 1] !== '') result.push(starts[lineIndex] - 1);
      }
    });
    if (result.length === token.content.length) result.push((result.at(-1) ?? starts[lineIndex] ?? normalized.length) + 1);
    return result;
  }
  function htmlWithPositions(html: string, offsets: number[]): string {
    // 속성 따옴표 안의 >, 주석과 script/style 본문을 표시 문자와 혼동하지 않는다.
    const chunks = /<!--[\s\S]*?-->|<(script|style|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/?[a-z!][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>|[^<]+|</giu;
    return html.replace(chunks, (chunk: string, _raw: string, offset: number) => {
      if (chunk.startsWith('<') && chunk !== '<') {
        if (literalTags.has(offsets[offset])) {
          return mapped(chunk, offsets.slice(offset, offset + chunk.length + 1));
        }
        if (/^<pre\b/iu.test(chunk)) codeDepth++;
        if (/^<\/pre\b/iu.test(chunk)) codeDepth = Math.max(0, codeDepth - 1);
        if (/^<details\b/iu.test(chunk)) {
          disclosureStack.push(disclosures.length);
          disclosures.push({ bodyStart: offsets[offset + chunk.length], end: normalized.length,
            open: /\sopen(?=[\s=>])/iu.test(chunk.replace(/"[^"]*"|'[^']*'/gu, '""')) });
        }
        const disclosure = disclosures[disclosureStack.at(-1) ?? -1];
        if (disclosure && /^<\/summary\b/iu.test(chunk)) disclosure.bodyStart = offsets[offset + chunk.length];
        if (disclosure && /^<\/details\b/iu.test(chunk)) {
          disclosure.end = offsets[offset + chunk.length];
          disclosureStack.pop();
        }
        // 글자가 없는 줄과 이미지 양옆에도 원문 경계를 둔다.
        if (/^<(?:br|hr|img)\b/iu.test(chunk)) {
          return mapped('\u200b', [offsets[offset], offsets[offset]]) + chunk
            + mapped('\u200b', [offsets[offset], offsets[offset + chunk.length]]);
        }
        if (/^<\/(?:p|div|summary|td|th|li|h[1-6])\b/iu.test(chunk)) {
          return mapped('\u200b', [offsets[offset], offsets[offset]]) + chunk;
        }
        return chunk;
      }
      let value = '';
      const bounds: number[] = [];
      for (const match of chunk.matchAll(/&(?:#x[\da-f]+|#\d+|[a-z][\da-z]+);|[\s\S]/giu)) {
        const decoded = parser.utils.unescapeAll(match[0]);
        const start = offset + match.index!;
        for (let i = 0; i < decoded.length; i++) bounds.push(offsets[start]);
        value += decoded;
        // 문자 참조의 내부에는 캐럿을 놓지 않고 전체 원문 범위를 유지한다.
      }
      bounds.push(offsets[offset + chunk.length]);
      return mapped(value, bounds);
    });
  }
  const tokens = options.inline ? parser.parseInline(normalized, { ...environment }) : parser.parse(normalized, { ...environment });
  if (options.inline && tokens[0]) tokens[0].map = [0, lines.length];
  // 실제 HTML 토큰만 검사한다. 코드/이스케이프 안의 태그는 후보가 아니다.
  // 비어 있는 쌍과 아직 닫지 않은 태그를 원문으로 보여 입력 위치를 유지한다.
  const htmlTags: Array<{ name: string; start: number; end: number; closing: boolean }> = [];
  for (const token of tokens) {
    const parts = token.type === 'html_block' ? [token] : (token.children ?? []).filter(child => child.type === 'html_inline');
    const base = token.type === 'html_block' || token.type === 'inline' && token.map ? blockOffsets(token) : null;
    if (!base) continue;
    for (const part of parts) {
      const pos = part === token ? 0 : positions.get(part)?.start;
      if (pos === undefined) continue;
      for (const match of part.content.matchAll(/<!--[\s\S]*?-->|<\/?([a-z][a-z\d]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/giu)) {
        const name = match[1]?.toLowerCase();
        if (!name || !markdownContainerTags.has(name) || /\/\s*>$/u.test(match[0])) continue;
        htmlTags.push({ name, start: base[pos + match.index!], end: base[pos + match.index! + match[0].length], closing: match[0].startsWith('</') });
      }
    }
  }
  const literalTags = new Set<number>();
  const stack: typeof htmlTags = [];
  for (const tag of htmlTags) {
    if (!tag.closing) { stack.push(tag); continue; }
    const opening = stack.at(-1);
    if (!opening || opening.name !== tag.name) { literalTags.add(tag.start); continue; }
    stack.pop();
    const inside = normalized.slice(opening.end, tag.start);
    // 공백도 내용이다. 중첩된 빈 태그만 있는 경우에는 바깥 태그도 드러낸다.
    if (inside.replace(/<\/?[a-z][a-z\d]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/giu, '') === ''
      && !/<(?:img|br|hr|wbr)\b/iu.test(inside)) {
      literalTags.add(opening.start); literalTags.add(tag.start);
    }
  }
  for (const tag of stack) literalTags.add(tag.start);
  // 렌더 함수는 호출별로 구성해 다른 블록의 환경이나 지도에 의존하지 않는다.
  const Renderer = parser.renderer.constructor as new () => typeof parser.renderer;
  const renderer = new Renderer();
  renderer.rules = { ...parser.renderer.rules };
  let inlineOffsets: number[] = [];
  const textRule = (items: Token[], index: number) => {
    const token = items[index];
    const pos = positions.get(token);
    if (!pos) { if (!token.content) return ''; throw new Error('Missing inline source position'); }
    const slice = inlineOffsets.slice(pos.start, pos.end + 1);
    const boundaries = slice.length === token.content.length + 1 ? slice
      : [slice[0], ...Array(Math.max(0, token.content.length - 1)).fill(slice[0]), slice.at(-1)!];
    const text = mapped(token.content, boundaries);
    return token.type === 'code_inline' ? `<code>${text}</code>` : text;
  };
  for (const type of ['text', 'text_special', 'code_inline']) renderer.rules[type] = textRule;
  renderer.rules.link_open = (items, index, options) => {
    if (items[index + 1]?.type !== 'link_close') return renderer.renderToken(items, index, options);
    const pos = positions.get(items[index]);
    if (!pos) throw new Error('Missing empty link source position');
    const offsets = inlineOffsets.slice(pos.start, pos.end + 1);
    return mapped(normalized.slice(offsets[0], offsets.at(-1)), offsets);
  };
  renderer.rules.link_close = (items, index, options) => items[index - 1]?.type === 'link_open'
    ? '' : renderer.renderToken(items, index, options);
  const imageRule = renderer.rules.image;
  renderer.rules.image = (items, index, options, env, self) => {
    const position = positions.get(items[index]);
    const image = imageRule(items, index, options, env, self);
    if (!position) return image;
    const before = inlineOffsets[position.start];
    const after = inlineOffsets[position.end];
    return mapped('\u200b', [before, before]) + image + mapped('\u200b', [before, after]);
  };
  renderer.rules.hardbreak = (items, index) => {
    const pos = positions.get(items[index])!;
    const before = inlineOffsets[pos.start];
    const after = inlineOffsets[pos.end];
    return mapped('\u200b', [before, before]) + '<br>' + mapped('\u200b', [before, after]);
  };
  // 본문의 원문 개행도 화면에서 줄을 나누고 앞뒤 편집 위치를 유지한다.
  renderer.rules.softbreak = renderer.rules.hardbreak;
  renderer.rules.html_inline = (items, index) => {
    const token = items[index];
    const pos = positions.get(token)!;
    return htmlWithPositions(token.content, inlineOffsets.slice(pos.start, pos.end + 1));
  };
  renderer.rules.html_block = (items, index) => htmlWithPositions(items[index].content, blockOffsets(items[index]));
  for (const type of ['fence', 'code_block']) renderer.rules[type] = (items, index) => {
    const token = items[index];
    const offsets = blockOffsets(token);
    // 마지막 코드 개행도 텍스트 경계를 하나 가진다.
    if (offsets.length === token.content.length) offsets.push(offsets.at(-1)! + 1);
    codeDepth++;
    const code = mapped(token.content, offsets);
    codeDepth--;
    return `<pre><code>${code}</code></pre>\n`;
  };
  let html = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'inline') {
      if (token.map) inlineOffsets = blockOffsets(token);
      else {
        const offsets = tableCellOffsets.get(token);
        if (!offsets) throw new Error('Missing table cell source positions');
        inlineOffsets = offsets;
      }
      html += token.content ? renderer.renderInline(token.children ?? [], parser.options, environment)
        : mapped('\u200b', [inlineOffsets[0], inlineOffsets[0]]);
    } else if (token.type === 'hr' && token.map) {
      const start = starts[token.map[0]];
      const end = start + (lines[token.map[0]] ?? '').length;
      html += mapped('\u200b', [start, end]) + renderer.renderToken(tokens, i, parser.options);
    } else if (renderer.rules[token.type]) html += renderer.rules[token.type](tokens, i, parser.options, environment, renderer);
    else {
      html += renderer.renderToken(tokens, i, parser.options);
      if (token.type === 'heading_open' && token.map && options.showHeadingMarkers && token.markup.startsWith('#')) {
        const line = lines[token.map[0]];
        const marker = line.match(/^(?: {0,3}>[ \t]?)* {0,3}(#{1,6}[ \t]+)/u);
        if (marker) {
          const start = starts[token.map[0]] + marker[0].length - marker[1].length;
          html += mapped(marker[1], Array.from({ length: marker[1].length + 1 }, (_, n) => start + n));
        }
      }
    }
  }
  return { html, attribute, maps, texts, codeRanges,
    disclosures: disclosures.map(range => ({ ...range,
      bodyStart: originalOffsets[range.bodyStart], end: originalOffsets[range.end] })) };
}
