import { expect, test } from '@playwright/test';

/** @param {import('@playwright/test').Page} page @param {string} format @param {string} source */
async function openData(page, format, source) {
  await page.goto('/');
  await page.locator('.new-document-format-trigger').click();
  await page.locator('.new-document-format-button').filter({ hasText: new RegExp(`^${format}$`) }).click();
  await page.getByTestId('editor-textarea').fill(source);
}

const samples = [
  { format: 'JSON', source: '{"name":"한글😀","items":[1,2],"id":9007199254740993,"empty":{}}' },
  { format: 'JSONC', source: '{/* {,} */"items":[1,2,],"url":"https://test.invalid/a,b",}' },
  { format: 'JSON Lines', source: '{"items":[1,2]}\n{"items":[3,4]}' },
  { format: 'XML', source: '<root><item key="a>b">한글 &amp; value</item><p>Hello <b>world</b>!</p><end/></root>' },
  { format: 'YAML', source: '{name: 한글, items: [one,two], text: "[a,b]"}' },
  { format: 'TOML', source: 'items = [{name="한글",id=1},{name="b",id=2}]' }
];

for (const { format, source } of samples) {
  test(`${format} pretty rows preserve every source character and switch back intact`, async ({ page }) => {
    await openData(page, format, source);
    const textarea = page.getByTestId('editor-textarea');
    const rows = page.locator('.pretty-print-row');
    await expect.poll(() => rows.count()).toBeGreaterThan(2);
    await expect(textarea).toHaveValue(source);
    expect((await rows.allTextContents()).join('')).toBe(source.replaceAll('\n', ''));
    const metrics = await rows.evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, indent: parseFloat(getComputedStyle(element).paddingLeft) };
    }));
    expect(metrics.some(metric => metric.indent > 0)).toBe(true);
    for (let index = 1; index < metrics.length; index += 1) {
      expect(metrics[index].top).toBeGreaterThanOrEqual(metrics[index - 1].bottom - 0.5);
    }
    await page.locator('.render-mode-toggle').click();
    await expect(rows).toHaveCount(0);
    await expect(textarea).toHaveValue(source);
    await page.locator('.render-mode-toggle').click();
    await expect.poll(() => rows.count()).toBeGreaterThan(2);
    await expect(textarea).toHaveValue(source);
  });
}

/** @param {import('@playwright/test').Page} page */
const selection = page => page.getByTestId('editor-textarea').evaluate(element => {
  const input = /** @type {HTMLTextAreaElement} */ (element);
  return { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection };
});

/** @param {import('@playwright/test').Page} page @param {number} offset */
async function sourcePoint(page, offset) {
  return page.locator('.pretty-print-content').first().evaluate((element, offset) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let remaining = offset;
    while (node) {
      if (remaining < (node.textContent?.length ?? 0)) {
        const range = document.createRange();
        range.setStart(node, remaining);
        range.setEnd(node, remaining + 1);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + 0.25, y: rect.top + rect.height / 2 };
      }
      remaining -= node.textContent?.length ?? 0;
      node = walker.nextNode();
    }
    throw new Error('source offset missing');
  }, offset);
}

test('pretty rows share pointer, keyboard, selection, editing and undo source offsets', async ({ page }) => {
  const source = '{"alpha":1,"beta":2,"gamma":3}';
  await openData(page, 'JSON', source);
  const textarea = page.getByTestId('editor-textarea');
  await textarea.press('Control+Home');
  await textarea.press('ArrowDown');
  expect((await selection(page)).start).toBe(source.indexOf('"alpha"'));
  await textarea.press('ArrowDown');
  expect((await selection(page)).start).toBe(source.indexOf('"beta"'));
  await textarea.press('End');
  const end = source.indexOf('"gamma"');
  expect((await selection(page)).start).toBe(end);
  // 원문 위치가 다음 표시 줄 시작과 같아도 End 캐럿은 현재 표시 줄 끝에 남는다.
  const rowBox = await page.locator('.pretty-print-row').nth(2).boundingBox();
  const caretBox = await page.locator('.steady-editor-caret').boundingBox();
  expect(rowBox).not.toBeNull();
  expect(caretBox).not.toBeNull();
  if (rowBox && caretBox) expect(Math.abs(rowBox.y - caretBox.y)).toBeLessThan(rowBox.height);
  await textarea.press('Home');
  expect((await selection(page)).start).toBe(source.indexOf('"beta"'));
  await textarea.press('Shift+ArrowDown');
  expect(await selection(page)).toMatchObject({ start: source.indexOf('"beta"'), end, direction: 'forward' });

  const first = await sourcePoint(page, source.indexOf('alpha'));
  const last = await sourcePoint(page, source.indexOf('gamma'));
  await page.mouse.move(last.x, last.y);
  await page.mouse.down();
  await page.mouse.move(first.x, first.y, { steps: 6 });
  await page.mouse.up();
  expect(await selection(page)).toEqual({ start: source.indexOf('alpha'), end: source.indexOf('gamma'), direction: 'backward' });
  await expect(textarea).toHaveValue(source);

  const digit = source.indexOf('2');
  const point = await sourcePoint(page, digit);
  await page.mouse.click(point.x, point.y);
  expect((await selection(page)).start).toBe(digit);
  await textarea.press('Delete');
  await textarea.press('9');
  await expect(textarea).toHaveValue(source.slice(0, digit) + '9' + source.slice(digit + 1));
  await textarea.press('Control+z');
  await textarea.press('Control+z');
  await expect(textarea).toHaveValue(source);
  await expect(page.locator('.pretty-print-row')).toHaveCount(5);
});

test('long pretty data measures scroll extent and wraps at a narrow viewport', async ({ page }) => {
  const source = JSON.stringify({ items: Array.from({ length: 70 }, (_, id) => ({ id, text: '한글😀abcdef'.repeat(6) })), end: 'LAST_VALUE' });
  await openData(page, 'JSON', source);
  await page.setViewportSize({ width: 460, height: 580 });
  const textarea = page.getByTestId('editor-textarea');
  const viewport = page.getByTestId('editor-viewport');
  await textarea.press('Control+End');
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(1000);
  await expect(page.locator('.pretty-print-row').filter({ hasText: 'LAST_VALUE' })).toBeInViewport();
  await expect.poll(() => viewport.evaluate(element => Math.abs(element.scrollHeight - element.scrollTop - element.clientHeight))).toBeLessThanOrEqual(1);
  await expect(textarea).toHaveValue(source);
  const bottom = await viewport.evaluate(element => element.scrollTop);
  await viewport.hover();
  await page.mouse.wheel(0, -600);
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeLessThan(bottom - 100);
  await expect(textarea).toHaveValue(source);
});

test('arrows cross from existing source lines into adjacent expanded display rows', async ({ page }) => {
  const source = '<root>\n<a><b/><c/></a>\n</root>';
  await openData(page, 'XML', source);
  const textarea = page.getByTestId('editor-textarea');
  await textarea.press('Control+End');
  await textarea.press('Home');
  await textarea.press('ArrowUp');
  expect((await selection(page)).start).toBe(source.indexOf('</a>'));
  await textarea.press('ArrowUp');
  expect((await selection(page)).start).toBe(source.indexOf('<c/>'));
  await expect(textarea).toHaveValue(source);
});
