import MarkdownIt, { type Token } from 'markdown-it';

// 표시 문자열을 원문에서 재검색하지 않고 해석기가 소비한 범위를 기록한다.
// 이 해석기는 편집 가능한 복합 블록에만 사용한다. 원문은 재직렬화하지 않는다.
const parser = new MarkdownIt({ html: true, linkify: true, maxNesting: 32 });
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
// 연결 규칙이 문자 참조와 텍스트의 원문 경계를 지우지 않게 한다.
parser.inline.ruler2.disable('fragments_join');
parser.core.ruler.disable('text_join');
// 자동 링크가 나눈 텍스트도 분할 전 토큰의 범위 안에서만 연결한다.
const linkify = parser.core.ruler.__rules__.find(rule => rule.name === 'linkify')!.fn;
parser.core.ruler.at('linkify', state => {
  const originals = state.tokens.map(token => token.children?.slice());
  linkify(state);
  state.tokens.forEach((block, index) => {
    const before = originals[index];
    if (!before || !block.children) return;
    let cursor = 0;
    for (const old of before) {
      if (block.children[cursor] === old) { cursor += 1; continue; }
      const position = positions.get(old);
      let consumed = 0;
      while (cursor < block.children.length && consumed < old.content.length) {
        const token = block.children[cursor++];
        if (token.type !== 'text') continue;
        if (position && old.content.slice(consumed, consumed + token.content.length) === token.content) {
          positions.set(token, { start: position.start + consumed, end: position.start + consumed + token.content.length });
        }
        consumed += token.content.length;
      }
      while (block.children[cursor]?.type === 'link_close' && !before.includes(block.children[cursor])) cursor += 1;
    }
  });
});

export interface MappedMarkdown {
  html: string;
  attribute: string;
  maps: number[][];
}

export function renderMappedMarkdown(source: string, environment: Record<string, unknown>): MappedMarkdown {
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
  const attribute = `data-rich-${crypto.randomUUID()}`;
  const escape = parser.utils.escapeHtml;
  function mapped(text: string, offsets: number[]): string {
    if (!text) return '';
    if (offsets.length !== text.length + 1 || offsets.some(pos => !Number.isFinite(pos))) {
      throw new Error('Markdown source boundary mismatch');
    }
    const id = maps.push(offsets.map(pos => originalOffsets[Math.min(pos, normalized.length)])) - 1;
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
  const tokens = parser.parse(normalized, { ...environment });
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
    return `<pre><code>${mapped(token.content, offsets)}</code></pre>\n`;
  };
  let html = '';
  let tableLine = 0;
  let tableColumn = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'table_open') tableLine = token.map?.[0] ?? 0;
    if (token.type === 'tr_open') {
      tableLine = token.map?.[0] ?? tableLine;
      tableColumn = lines[tableLine]?.match(/^(?: {0,3}>[ \t]?)*[ \t]*\|?/u)?.[0].length ?? 0;
    }
    if (token.type === 'inline') {
      if (token.map) inlineOffsets = blockOffsets(token);
      else {
        // 표 셀 토큰에는 map이 없다. 현재 행과 왼쪽에서 소비한 셀 범위로 한정한다.
        const line = lines[tableLine] ?? '';
        let end = tableColumn;
        while (end < line.length) {
          if (line[end] === '|' && line[end - 1] !== '\\') break;
          end += 1;
        }
        const raw = line.slice(tableColumn, end);
        if (raw.trim() !== token.content) throw new Error('Unmapped nested table cell');
        const column = tableColumn + raw.length - raw.trimStart().length;
        inlineOffsets = Array.from({ length: token.content.length + 1 }, (_, n) => starts[tableLine] + column + n);
        tableColumn = end + 1;
      }
      html += token.content ? renderer.renderInline(token.children ?? [], parser.options, environment)
        : mapped('\u200b', [inlineOffsets[0], inlineOffsets[0]]);
    } else if (token.type === 'hr' && token.map) {
      const start = starts[token.map[0]];
      html += mapped('\u200b', [start, start]) + renderer.renderToken(tokens, i, parser.options);
    } else if (renderer.rules[token.type]) html += renderer.rules[token.type](tokens, i, parser.options, environment, renderer);
    else html += renderer.renderToken(tokens, i, parser.options);
  }
  return { html, attribute, maps };
}
