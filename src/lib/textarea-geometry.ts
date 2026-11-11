import { findClosestRenderedTextOffset } from './rendered-text-geometry';

/** 한 번의 측정 동안 원문 입력창과 같은 줄바꿈을 갖는 숨은 표시층을 공유한다. */
export function createTextareaGeometry(input: HTMLTextAreaElement) {
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
  const bounds = input.getBoundingClientRect();
  const origin = mirror.getBoundingClientRect();
  const node = mirror.firstChild!;
  const translate = (rect: DOMRect) => new DOMRect(
    rect.left - origin.left + bounds.left + input.clientLeft - input.scrollLeft,
    rect.top - origin.top + bounds.top + input.clientTop - input.scrollTop, rect.width, rect.height);
  const rangeAt = (start: number, end: number) => {
    const range = document.createRange();
    range.setStart(node, Math.max(0, Math.min(input.value.length, start)));
    range.setEnd(node, Math.max(0, Math.min(input.value.length, end)));
    return range;
  };
  const rectAt = (offset: number) => {
    const rect = rangeAt(offset, offset).getBoundingClientRect();
    const next = rangeAt(offset, offset + 1).getBoundingClientRect();
    const chosen = next.height > 0 && next.top > rect.top + 0.5 ? next : rect;
    return translate(chosen);
  };
  return {
    rectAt,
    offsetAt: (x: number, y: number) => findClosestRenderedTextOffset(input.value.length, x, y, Math.max(1, input.clientWidth), rectAt),
    selectionRects: (start: number, end: number) => Array.from(rangeAt(start, end).getClientRects(), translate),
    dispose: () => mirror.remove()
  };
}
