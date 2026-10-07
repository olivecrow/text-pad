// @ts-expect-error 브라우저 테스트는 Node에서 실행되지만 앱의 타입 환경에는 Node 선언을 포함하지 않는다.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const sample = readFileSync(new URL('../../samples/large-markdown-tables.md', import.meta.url), 'utf8');

for (const width of [900, 460]) {
  test(`the large Markdown sample preserves manual scrolling at ${width}px`, async ({ page }) => {
    // 이동 왕복 중 매 중간 스크롤 위치를 검사하므로 느린 실행 환경에서도 전체 조작을 마친다.
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 650 });
    await page.goto('/');
    const editor = page.getByTestId('editor-textarea');
    const viewport = page.getByTestId('editor-viewport');
    await editor.fill(sample);
    await editor.press('Control+Home');
    await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeLessThan(25);
    await page.waitForTimeout(300);
    const readSelection = (/** @type {HTMLElement | SVGElement} */ element) => {
      const input = /** @type {HTMLTextAreaElement} */ (element);
      return [input.selectionStart, input.selectionEnd];
    };
    const initialSelection = await editor.evaluate(readSelection);
    const bounds = await viewport.boundingBox();
    if (!bounds) throw new Error('Missing editor viewport');
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);

    for (const direction of [1, -1]) {
      let reachedEnd = false;
      for (let step = 0; step < 150; step += 1) {
        const before = await viewport.evaluate(el => el.scrollTop);
        await page.mouse.wheel(0, direction * (step < 5 ? 400 : 1200));
        await page.waitForTimeout(70);
        const after = await viewport.evaluate(el => ({
          top: el.scrollTop, maximum: el.scrollHeight - el.clientHeight
        }));
        const context = JSON.stringify({ width, direction, step, before, after });
        if (direction === 1) expect(after.top, context).toBeGreaterThanOrEqual(before - 1);
        else expect(after.top, context).toBeLessThanOrEqual(before + 1);
        if (Math.abs(after.top - (direction === 1 ? after.maximum : 0)) <= 1) {
          reachedEnd = true;
          break;
        }
      }
      expect(reachedEnd).toBe(true);
    }
    await expect(editor).toHaveValue(sample);
    expect(await editor.evaluate(readSelection)).toEqual(initialSelection);

    // 수동 스크롤 뒤에도 실제 키보드 이동은 화면 밖 입력 위치를 다시 표시한다.
    await page.mouse.wheel(0, 2400);
    await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeGreaterThan(1000);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeLessThan(25);
  });
}

test('wheel input over a table cancels a pending caret reveal after editing', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const viewport = page.getByTestId('editor-viewport');
  const content = ['heading', '', '| A | B |', '| --- | --- |',
    ...Array.from({ length: 80 }, (_, index) => `| row ${index} | value |`), '', 'end'].join('\n');
  await editor.fill(content);
  await editor.press('Control+Home');
  await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeLessThan(25);
  await page.waitForTimeout(300);
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('Missing editor viewport');
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  expect(await page.evaluate(({ x, y }) => Boolean(
    document.elementFromPoint(x, y)?.closest('[data-markdown-table]')
  ), point)).toBe(true);
  await page.mouse.move(point.x, point.y);
  await editor.press('a');
  await page.mouse.wheel(0, 400);
  await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeGreaterThan(300);
  await page.waitForTimeout(350);
  expect(await viewport.evaluate(el => el.scrollTop)).toBeGreaterThan(300);
  await expect(editor).toHaveValue(`a${content}`);
});
