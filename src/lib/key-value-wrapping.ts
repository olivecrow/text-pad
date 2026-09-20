import { tick } from 'svelte';
import type { Token } from './render-tokenizer';
import { createRenderedTextBoundaryIndex } from './rendered-text-geometry';

/** 강조 파서가 확인한 키와 구분자만 사용한다. 값 속의 =, :는 다시 해석하지 않는다. */
export function getKeyValueStart(tokens: Token[]): number | null {
  let index = 0;
  const skipSpaces = () => {
    while (index < tokens.length && /^[ \t]*$/.test(tokens[index].text ?? '') && !tokens[index].children) index += 1;
  };
  skipSpaces();
  if ((tokens[index]?.type === 'keyword' && /^export[ \t]+$/.test(tokens[index].text ?? ''))
    || tokens[index]?.type === 'list-marker') {
    index += 1;
    skipSpaces();
  }
  const key = tokens[index];
  if (!key || !['key', 'directive'].includes(key.type) || !key.text?.trim()
    || /^[{\[]/.test(key.text.trimStart())) return null;
  index += 1;
  // Properties의 공백 구분자는 operator이므로 건너뛰지 않는다.
  while (tokens[index]?.type === 'text' && /^[ \t]*$/.test(tokens[index].text ?? '')) index += 1;
  const separator = tokens[index];
  if (!separator || !['operator', 'punctuation'].includes(separator.type)
    || !/^(?:[ \t]*[=:][ \t]*|[ \t]+)$/.test(separator.text ?? '')) return null;
  index += 1;
  skipSpaces();
  const value = tokens[index];
  if (!value || value.type === 'comment' || value.children || value.start === undefined) return null;
  const spacing = value.text?.match(/^[ \t]*/)?.[0].length ?? 0;
  return value.text && spacing < value.text.length ? value.start + spacing : null;
}

interface WrappingOptions {
  tokens: Token[];
  /** 글꼴, 크기, 탭 폭, 렌더 설정이 바뀌면 같은 원문도 다시 측정한다. */
  context: string;
}

const targets = new Map<HTMLElement, WrappingOptions>();
let observer: ResizeObserver | null = null;

function measureValueIndent(node: HTMLElement) {
  const options = targets.get(node);
  if (!options || !node.isConnected) return;
  const valueStart = getKeyValueStart(options.tokens);
  const sourceStart = options.tokens[0]?.start;
  let indent = 0;
  if (valueStart !== null && sourceStart !== undefined) {
    const length = node.textContent?.length ?? 0;
    const boundaries = createRenderedTextBoundaryIndex(node, length);
    const characterRect = (offset: number) => {
      const start = boundaries.getBoundary(offset);
      const end = boundaries.getBoundary(offset + 1);
      if (!start || !end) return undefined;
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      return Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0).at(-1);
    };
    const first = characterRect(0);
    const value = characterRect(valueStart - sourceStart);
    if (first && value && first.top < value.bottom && value.top < first.bottom) {
      const width = value.left - first.left;
      // 키가 창 너비 대부분을 차지하면 값을 좁은 세로 띠에 가두지 않는다.
      if (width > 0 && width <= node.clientWidth * 0.8) indent = width;
    }
  }
  const next = `${indent}px`;
  if (node.style.getPropertyValue('--key-value-indent') !== next) {
    node.style.setProperty('--key-value-indent', next);
  }
  node.classList.toggle('key-value-wrapping', indent > 0);
}

/** 원문 노드를 유지하고 첫 줄만 내어써 후속 표시 줄을 값 시작점에 맞춘다. */
export function alignKeyValue(node: HTMLElement, options: WrappingOptions) {
  let disposed = false;
  const update = (next: WrappingOptions) => {
    if (getKeyValueStart(next.tokens) === null) {
      targets.delete(node);
      observer?.unobserve(node);
      node.style.removeProperty('--key-value-indent');
      node.classList.remove('key-value-wrapping');
      return;
    }
    targets.set(node, next);
    observer ??= new ResizeObserver(entries => {
      for (const entry of entries) measureValueIndent(entry.target as HTMLElement);
    });
    observer.observe(node);
    void tick().then(() => { if (!disposed) measureValueIndent(node); });
  };
  update(options);
  return {
    update,
    destroy() {
      disposed = true;
      observer?.unobserve(node);
      targets.delete(node);
      if (targets.size === 0) {
        observer?.disconnect();
        observer = null;
      }
    }
  };
}
