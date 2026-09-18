import MarkdownIt, { type Token as MarkdownToken } from 'markdown-it';
import type { Token } from './render-tokenizer';

// 원문 편집에는 문자 참조나 링크의 HTML 변환 없이 강조 쌍의 판정만 필요하다.
// escape의 원문 markup도 유지하도록 core의 text_join을 거치지 않는다.
const markdown = new MarkdownIt('zero').enable(['emphasis', 'strikethrough', 'backticks', 'escape']);
const formats: Record<string, Token['type']> = { em: 'emphasis', strong: 'strong', s: 'strike' };

export function getMarkdownInlineSpans(source: string): Map<number, { token: Token; end: number }> {
  const spans = new Map<number, { token: Token; end: number }>();
  if (!/[*_~]/u.test(source)) return spans;
  const parsed: MarkdownToken[] = [];
  markdown.inline.parse(source, markdown, {}, parsed);
  const stack: Array<{ token: Token; start: number }> = [];
  let cursor = 0;
  function append(token: Token, start: number) {
    const parent = stack.at(-1);
    if (parent) parent.token.children!.push(token);
    else if (token.type !== 'text' || token.children) spans.set(start, { token, end: cursor });
  }
  for (const part of parsed) {
    const start = cursor;
    const format = formats[part.tag];
    if (format && part.nesting) {
      cursor += part.markup.length;
      const marker: Token = { type: 'text', text: source.slice(start, cursor), hiddenSyntax: true };
      if (part.nesting === 1) {
        stack.push({ token: { type: format, children: [marker] }, start });
      } else {
        const frame = stack.pop();
        if (!frame) return new Map();
        frame.token.children!.push(marker);
        append(frame.token, frame.start);
      }
    } else if (part.type === 'code_inline') {
      // 코드의 공백을 정규화한 content 대신 원문에서 같은 길이의 닫는 백틱을 찾는다.
      const runs = /`+/gu;
      runs.lastIndex = cursor + part.markup.length;
      let closing: RegExpExecArray | null;
      do { closing = runs.exec(source); } while (closing && closing[0].length !== part.markup.length);
      if (!closing) return new Map();
      cursor = runs.lastIndex;
      append({ type: 'code', children: [
        { type: 'text', text: part.markup, hiddenSyntax: true },
        { type: 'text', text: source.slice(start + part.markup.length, closing.index) },
        { type: 'text', text: part.markup, hiddenSyntax: true }
      ] }, start);
    } else if (part.type === 'text_special') {
      cursor += part.markup.length;
      // 이스케이프된 별표/백틱이 아래의 일반 토큰화에서 다시 문법이 되지 않는다.
      append({ type: 'text', children: [{ type: 'text', text: part.markup }] }, start);
    } else {
      cursor += part.content.length;
      if (part.content) append({ type: 'text', text: source.slice(start, cursor) }, start);
    }
  }
  // 해석기에서 원문 길이를 바꾸는 규칙이 추가돼도 잘못된 편집 위치를 만들지 않는다.
  return cursor === source.length && stack.length === 0 ? spans : new Map();
}
