import { expect, test } from '@playwright/test';

/** @param {import('@playwright/test').Page} page @param {string} format @param {string} source */
async function openData(page, format, source) {
  await page.goto('/');
  await page.locator('.new-document-format-trigger').click();
  await page.locator('.new-document-format-button').filter({ hasText: new RegExp(`^${format}$`) }).click();
  await page.getByTestId('editor-textarea').fill(source);
}

/** @param {import('@playwright/test').Locator} locator */
async function characters(locator) {
  return locator.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const result = [];
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? '';
      for (let index = 0; index < text.length; index++) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const box = range.getBoundingClientRect();
        result.push({ char: text[index], x: box.x, y: box.y, width: box.width, height: box.height });
      }
    }
    return result;
  });
}

for (const [format, prefix, suffix] of [
  ['ENV', 'export API_URL = ', ''], ['ENV', '\tAPI_URL\t=\t', ''],
  ['INI/CFG', 'endpoint = ', ''], ['Properties', 'endpoint: ', ''],
  ['TOML', 'endpoint = "', '"'], ['YAML', 'endpoint: ', ''],
  ['JSON', '{"endpoint":"', '"}']
]) {
  test(`${format} ${JSON.stringify(prefix)} aligns wrapped values without changing source`, async ({ page }) => {
    await page.setViewportSize({ width: 460, height: 650 });
    const source = prefix + 'abcdefghij '.repeat(18).trimEnd() + suffix;
    await openData(page, format, source);
    const content = page.locator('.key-value-wrapping').first();
    await expect(content).toBeVisible();
    await expect.poll(async () => new Set((await characters(content)).map(char => char.y)).size).toBeGreaterThan(2);
    const chars = await characters(content);
    const valueIndex = chars.findIndex(char => char.char === 'a');
    const value = chars[prefix.endsWith('"') ? valueIndex - 1 : valueIndex];
    const rows = [...new Set(chars.map(char => char.y))];
    for (const y of rows.slice(1)) {
      const first = chars.find(char => char.y === y);
      if (!first) throw new Error('display row missing');
      expect(Math.abs(first.x - value.x)).toBeLessThan(1);
    }
    await expect(page.getByTestId('editor-textarea')).toHaveValue(source);
    await page.locator('.render-mode-toggle').click();
    await expect(page.getByTestId('editor-textarea')).toHaveValue(source);
  });
}

test('spaces occupy wrapped rows and support pointer editing and undo', async ({ page }) => {
  await page.setViewportSize({ width: 460, height: 650 });
  const source = 'KEY=value' + ' '.repeat(200) + 'end';
  await openData(page, 'ENV', source);
  const content = page.locator('.key-value-wrapping').first();
  await expect(content).toBeVisible();
  const chars = await characters(content);
  const spaces = chars.filter(char => char.char === ' ');
  expect(new Set(spaces.map(char => char.y)).size).toBeGreaterThan(2);
  const box = await content.boundingBox();
  if (!box) throw new Error('content box missing');
  for (const char of spaces) {
    expect(char.width).toBeGreaterThan(0);
    expect(char.x + char.width).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  const index = chars.findIndex(char => char.y > chars[0].y);
  await page.mouse.click(chars[index].x + 0.1, chars[index].y + chars[index].height / 2);
  const input = page.getByTestId('editor-textarea');
  await expect.poll(() => input.evaluate(el => /** @type {HTMLTextAreaElement} */ (el).selectionStart)).toBe(index);
  await page.keyboard.type('Z');
  await expect(input).toHaveValue(source.slice(0, index) + 'Z' + source.slice(index));
  await page.keyboard.press('Control+z');
  await expect(input).toHaveValue(source);
});

test('wrapped value keyboard navigation and resize use rendered rows', async ({ page }) => {
  await page.setViewportSize({ width: 460, height: 650 });
  const source = 'LONG_SETTING_NAME=' + 'abcdefghij '.repeat(25).trimEnd();
  await openData(page, 'ENV', source);
  const content = page.locator('.key-value-wrapping').first();
  await expect(content).toBeVisible();
  const chars = await characters(content);
  const second = chars.findIndex(char => char.y > chars[0].y);
  await page.mouse.click(chars[second + 3].x + 0.1, chars[second + 3].y + chars[second + 3].height / 2);
  const input = page.getByTestId('editor-textarea');
  await page.keyboard.press('Home');
  await expect.poll(() => input.evaluate(el => /** @type {HTMLTextAreaElement} */ (el).selectionStart)).toBe(second);
  await page.keyboard.press('ArrowDown');
  const third = chars.findIndex(char => char.y > chars[second].y);
  await expect.poll(() => input.evaluate(el => /** @type {HTMLTextAreaElement} */ (el).selectionStart)).toBe(third);
  await page.keyboard.press('Shift+End');
  expect(await input.evaluate(el => {
    const textarea = /** @type {HTMLTextAreaElement} */ (el);
    return textarea.selectionEnd - textarea.selectionStart;
  })).toBeGreaterThan(1);
  await page.setViewportSize({ width: 900, height: 650 });
  await expect.poll(async () => new Set((await characters(content)).map(char => char.y)).size).toBeLessThan(new Set(chars.map(char => char.y)).size);
  await expect(input).toHaveValue(source);
});
