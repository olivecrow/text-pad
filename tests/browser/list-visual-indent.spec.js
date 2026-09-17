import { expect, test } from '@playwright/test';

const markers = ['1. ', '009. ', '1) ', '(1) ', 'A. ', 'a) ', '(a) ', 'II. ', 'iv. ', '- ', '* ', '+ ', '• ', '    1. ', '\t+ '];

for (const sample of [
  { format: 'Text', fontFamily: 'nanum-gothic', fontSize: 16, indentWidth: 8 },
  { format: 'Markdown', fontFamily: 'consolas', fontSize: 12, indentWidth: 4 }
]) {
  test(`${sample.format} lists use four rendered spaces without changing source`, async ({ page }) => {
    await page.addInitScript((render) => localStorage.setItem('text-pad.settings', JSON.stringify({
      format: 'text-pad-settings', schemaVersion: 1, settings: { render }
    })), { fontFamily: sample.fontFamily, fontSize: sample.fontSize, indentWidth: sample.indentWidth });
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('.new-document-format-trigger').click();
    await page.locator('.new-document-format-button').filter({ hasText: new RegExp(`^${sample.format}$`) }).click();
    const textarea = page.getByTestId('editor-textarea');
    const referenceIndent = ' '.repeat(sample.indentWidth);
    const source = [`${referenceIndent}reference`, ...markers.map(marker => `${marker}본문 body`), referenceIndent, 'ordinary'].join('\n');
    await textarea.fill(source);
    await textarea.press('Control+Home');
    await expect(page.locator('.list-item-content')).toHaveCount(markers.length);

    for (const width of [1000, 520]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.locator('.backdrop-line').evaluateAll(lines => {
        const reference = lines[0].querySelector('.line-content');
        const node = reference ? document.createTreeWalker(reference, NodeFilter.SHOW_TEXT).nextNode() : null;
        if (!reference || !node) return Infinity;
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, 4);
        const inset = range.getBoundingClientRect().width;
        const left = reference.getBoundingClientRect().left;
        return Math.max(...lines.flatMap(line => {
          const prefix = line.querySelector('.list-item-prefix');
          const body = line.querySelector('.list-item-body');
          if (!prefix || !body) return [];
          const prefixRect = prefix.getBoundingClientRect();
          const bodyRect = body.getBoundingClientRect();
          const contentRight = line.querySelector('.line-content')?.getBoundingClientRect().right ?? 0;
          return [Math.abs(prefixRect.left - left - inset), Math.abs(bodyRect.left - prefixRect.right), Math.abs(bodyRect.right - contentRight)];
        }));
      })).toBeLessThanOrEqual(0.1);
      await expect(textarea).toHaveValue(source);
    }

    const bodyStarts = await page.locator('.list-item-content').evaluateAll(lines => lines.map(line => Number(/** @type {HTMLElement} */ (line).dataset.listBodyStart)));
    expect(bodyStarts).toEqual(markers.map(marker => marker.length));
    // 독립 목록은 자체 안내선을 숨기고 일반 텍스트와 빈 줄은 기존 안내선을 옅게 그린다.
    const guides = await page.locator('.backdrop-line').evaluateAll((lines, markerCount) => (
      [lines[0], lines[markerCount], lines[markerCount + 1]].map(line => (
        Array.from(line.querySelectorAll('.guide-line')).map(guide => {
          const rect = guide.getBoundingClientRect();
          const style = getComputedStyle(guide);
          return { left: rect.left, width: rect.width, color: style.backgroundColor, opacity: style.opacity, transform: style.transform };
        })
      ))
    ), markers.length);
    expect(guides.map(lineGuides => lineGuides.length)).toEqual([1, 0, 1]);
    expect(guides[2]).toEqual(guides[0]);
    expect(guides[0][0].opacity).toBe('0.5');
    await expect(page.locator('.backdrop-line[data-line-index="1"] .guide-line')).toHaveCount(0);
    await page.locator('.render-mode-toggle').click();
    await expect(page.locator('.list-item-content')).toHaveCount(0);
    await expect(textarea).toHaveValue(source);
    await page.locator('.render-mode-toggle').click();
    await expect(page.locator('.list-item-content')).toHaveCount(markers.length);
    await expect(textarea).toHaveValue(source);
    await textarea.press('Control+z');
    await expect(textarea).toHaveValue('');
  });
}

test('lists inherit only outer paragraph guides and update them after ancestor edits', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const textarea = page.getByTestId('editor-textarea');
  const source = ['plain', '    parent', '        1. item', '            a) nested', '',
    '1. root', '    A. nested', '', '        normal', '            - first',
    '    * outdent', '            + deeper'].join('\n');
  await textarea.fill(source);
  const guideCounts = () => page.locator('.list-item-line').evaluateAll(lines => lines.map(line => line.querySelectorAll('.guide-line').length));
  await expect.poll(guideCounts).toEqual([1, 1, 0, 0, 2, 1, 1]);
  // 일반 부모 줄만 편집해도 아래 목록의 캐시된 안내선이 끝까지 갱신되어야 한다.
  await textarea.press('Control+Home');
  await textarea.press('ArrowDown');
  await textarea.press('Tab');
  await expect.poll(guideCounts).toEqual([2, 2, 0, 0, 2, 1, 1]);
  await textarea.press('Control+z');
  await expect(textarea).toHaveValue(source);
  await expect.poll(guideCounts).toEqual([1, 1, 0, 0, 2, 1, 1]);
  await textarea.press('Control+y');
  await expect.poll(guideCounts).toEqual([2, 2, 0, 0, 2, 1, 1]);

  await textarea.fill('    parent\n        1. item');
  await textarea.press('Control+End');
  await textarea.press('Shift+Enter');
  await textarea.pressSequentially('continuation');
  await expect.poll(guideCounts).toEqual([1, 1]);
  const guides = await page.locator('.backdrop-line').evaluateAll(lines => lines.map(line => Array.from(line.querySelectorAll('.guide-line')).map(guide => ({
    left: guide.getBoundingClientRect().left, opacity: getComputedStyle(guide).opacity
  }))));
  expect(guides[1]).toEqual(guides[0]);
  expect(guides[2]).toEqual(guides[0]);
});

test('list inset follows wrapping, continuation, clicks and source editing', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const textarea = page.getByTestId('editor-textarea');
  const first = `1. ${'한글 alpha-beta '.repeat(12)}`;
  await textarea.fill(first);
  await textarea.press('Control+End');
  await textarea.press('Shift+Enter');
  await textarea.pressSequentially('continuation');
  const continued = await textarea.inputValue();
  const second = continued.split('\n')[1];
  expect(second.trimStart()).toBe('continuation');
  // 네 칸의 표시 여백은 Shift+Enter가 만드는 기존 구조 공백에 더해지지 않는다.
  const prefix = await page.locator('.list-item-prefix').first().boundingBox();
  const continuationSpaces = await page.locator('.backdrop-line').first().evaluate(line => {
    const prefix = line.querySelector('.list-item-prefix');
    const style = getComputedStyle(line);
    const context = document.createElement('canvas').getContext('2d');
    if (!prefix || !context) throw new Error('글머리 측정 실패');
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return Math.max(1, Math.round(prefix.getBoundingClientRect().width / context.measureText(' ').width));
  });
  expect(second).toBe(`${' '.repeat(continuationSpaces)}continuation`);
  expect(prefix).not.toBeNull();

  const bodies = page.locator('.list-item-body');
  await expect(bodies).toHaveCount(2);
  await expect.poll(() => bodies.evaluateAll(nodes => Math.abs(nodes[0].getBoundingClientRect().left - nodes[1].getBoundingClientRect().left))).toBeLessThanOrEqual(0.1);
  await expect.poll(() => page.locator('.backdrop-line').evaluateAll(lines => Math.abs(lines[0].getBoundingClientRect().bottom - lines[1].getBoundingClientRect().top))).toBeLessThanOrEqual(0.5);

  // 자동 줄바꿈 경계는 앞줄 끝과 같은 원문 위치이지만 여백 클릭은 다음 표시 줄 시작을 가리킨다.
  const wrappedStart = await bodies.first().evaluate(root => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let offset = 0;
    let firstTop = null;
    while (node) {
      for (let index = 0; index < (node.textContent ?? '').length; index += 1) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect = range.getBoundingClientRect();
        firstTop ??= rect.top;
        if (rect.top > firstTop + 1 && rect.width > 0) {
          return { offset: offset + index, x: rect.left, y: rect.top + rect.height / 2, top: rect.top };
        }
      }
      offset += (node.textContent ?? '').length;
      node = walker.nextNode();
    }
    throw new Error('검증할 자동 줄바꿈 경계 없음');
  });
  const firstContent = await page.locator('.list-item-content').first().boundingBox();
  if (!firstContent) throw new Error('글머리 영역 없음');
  await page.mouse.click(firstContent.x + 2, wrappedStart.y);
  await expect.poll(() => textarea.evaluate(e => /** @type {HTMLTextAreaElement} */ (e).selectionStart)).toBe(3 + wrappedStart.offset);
  await expect.poll(async () => {
    const caret = await page.locator('.steady-editor-caret').boundingBox();
    return caret ? Math.max(Math.abs(caret.x - wrappedStart.x), Math.abs(caret.y - wrappedStart.top)) : Infinity;
  }).toBeLessThanOrEqual(1);

  /** @param {number} lineIndex @param {number} offset */
  const pointAt = (lineIndex, offset) => page.locator(`.backdrop-line[data-line-index="${lineIndex}"] .list-item-body`).evaluate((root, offset) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && offset >= (node.textContent ?? '').length) {
      offset -= (node.textContent ?? '').length;
      node = walker.nextNode();
    }
    if (!node) throw new Error('검증할 본문 글자가 없음');
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + 1);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + 0.5, y: rect.top + rect.height / 2, top: rect.top, height: rect.height };
  }, offset);
  const point = await pointAt(0, 80);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => textarea.evaluate(e => /** @type {HTMLTextAreaElement} */ (e).selectionStart)).toBe(83);
  await expect.poll(async () => {
    const caret = await page.locator('.steady-editor-caret').boundingBox();
    return caret ? Math.max(Math.abs(caret.x - (point.x - 0.5)), Math.abs(caret.y - point.top)) : Infinity;
  }).toBeLessThanOrEqual(1);
  const end = await pointAt(1, 5);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await expect.poll(() => textarea.evaluate(e => {
    const input = /** @type {HTMLTextAreaElement} */ (e);
    return [input.selectionStart, input.selectionEnd];
  })).toEqual([83, first.length + 1 + continuationSpaces + 5]);
  await expect(page.locator('.editor-area')).toHaveClass(/render-custom-selection/);
  await page.mouse.up();
  await expect(textarea).toHaveValue(continued);

  // 표시 여백의 클릭은 원문 공백을 거치지 않고 연속 줄 본문으로 연결한다.
  const continuationPoint = await pointAt(1, 0);
  const content = await page.locator('.list-item-content').nth(1).boundingBox();
  if (!content) throw new Error('연속 줄 영역 없음');
  await page.mouse.click(content.x + 2, continuationPoint.y);
  await expect.poll(() => textarea.evaluate(e => /** @type {HTMLTextAreaElement} */ (e).selectionStart)).toBe(first.length + 1 + continuationSpaces);
  await textarea.press('ArrowLeft');
  await expect.poll(() => textarea.evaluate(e => /** @type {HTMLTextAreaElement} */ (e).selectionStart)).toBe(first.length);
  await page.mouse.click(content.x + 2, continuationPoint.y);
  await textarea.press('Backspace');
  await expect(textarea).toHaveValue(`${first}continuation`);
  await textarea.press('Control+z');
  await expect(textarea).toHaveValue(continued);
  await textarea.press('Control+End');
  await textarea.press('Enter');
  await expect(textarea).toHaveValue(`${continued}\n2. `);
  await textarea.press('Control+z');
  await expect(textarea).toHaveValue(continued);

  // 표식을 완성하는 순간 여백이 생기며 Backspace와 실행 취소는 원문만 편집한다.
  await textarea.fill('-');
  await textarea.press('End');
  await textarea.press('Space');
  await expect(bodies).toHaveCount(1);
  await expect(textarea).toHaveValue('- ');
  await textarea.press('Backspace');
  await expect(textarea).toHaveValue('');
  await expect(bodies).toHaveCount(0);
  await textarea.press('Control+z');
  await expect(textarea).toHaveValue('- ');
  await expect(bodies).toHaveCount(1);
});
