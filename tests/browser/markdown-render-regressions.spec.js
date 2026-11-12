import { expect, test } from '@playwright/test';

/** @param {import('@playwright/test').Page} page @param {string} text @param {number} offset */
async function clickText(page, text, offset) {
  const point = await page.locator('.rich-content [data-rich-offsets]').evaluateAll((elements, target) => {
    const element = elements.find(el => el.textContent === target.text);
    if (!element?.firstChild) throw new Error(`Missing text: ${target.text}`);
    const range = document.createRange();
    range.setStart(element.firstChild, target.offset);
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    return { x: rect.x, y: rect.y + rect.height / 2 };
  }, { text, offset });
  await page.mouse.click(point.x, point.y);
}

test('standalone web addresses become links without unrelated formatting', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  for (const address of ['https://example.com', 'http://example.com']) {
    await editor.fill(address);
    await expect(page.locator('.rich-content a')).toHaveText(address);
    await expect(page.locator('.rich-content a')).toHaveAttribute('href', /https?:\/\//);
    await expect(editor).toHaveValue(address);
  }
  await editor.fill('`https://example.com`');
  await expect(page.locator('.rich-content a')).toHaveCount(0);
});

test('encoded and international web addresses keep exact pointer and Home editing positions', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  for (const address of ['https://example.com/foo%20bar', 'https://xn--exmple-cua.com/path', 'https://예제.com/경로']) {
    for (const angled of [false, true]) {
      const source = '> ' + (angled ? `<${address}>` : address);
      await editor.fill(source);
      await expect(page.locator('.rich-content a')).toHaveText(address);
      await clickText(page, address, 8);
      const expected = source.indexOf(address) + 8;
      await expect.poll(() => editor.evaluate(el => /** @type {HTMLTextAreaElement} */ (el).selectionStart)).toBe(expected);
      await page.keyboard.insertText('x');
      await expect(editor).toHaveValue(source.slice(0, expected) + 'x' + source.slice(expected));
      await page.keyboard.press('Control+z');
      await expect(editor).toHaveValue(source);
      await clickText(page, address, 8);
      await page.keyboard.press('Home');
      await expect.poll(() => editor.evaluate(el => /** @type {HTMLTextAreaElement} */ (el).selectionStart)).toBe(source.indexOf(address));
      await page.keyboard.insertText('X');
      await expect(editor).toHaveValue(source.replace(address, 'X' + address));
      await page.keyboard.press('Control+z');
      await expect(editor).toHaveValue(source);
    }
  }
});

test('escaped pipes in quoted tables retain formatting and delete as one visible character', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const source = '> **인용문**\n>\n> | A | B |\n> | --- | --- |\n> | x\\|y | `c\\|d` |';
  await editor.fill(source);
  await expect(page.locator('.rich-content blockquote strong')).toHaveText('인용문');
  await expect(page.locator('.rich-content td')).toHaveText(['x|y', 'c|d']);
  await expect(page.locator('.rich-content td code')).toHaveText('c|d');
  await clickText(page, 'x|y', 2);
  await page.keyboard.press('Backspace');
  await expect(editor).toHaveValue(source.replace('x\\|y', 'xy'));
  await expect(page.locator('.rich-content table')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(editor).toHaveValue(source);
  await clickText(page, 'c|d', 2);
  await page.keyboard.insertText('Z');
  await expect(editor).toHaveValue(source.replace('c\\|d', 'c\\|Zd'));
  await page.keyboard.press('Control+z');
  await expect(editor).toHaveValue(source);
  await editor.fill('> - | A | B |\n>   | --- | --- |\n>   | x\\|y | z |');
  await expect(page.locator('.rich-content li table td')).toHaveText(['x|y', 'z']);
});

test('rich nested list items retain their parent structure and source editing positions', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const source = '- parent\n    - nested first@example.com\n    - [link](https://example.com)\n- end';
  await editor.fill(source);
  const rich = page.locator('.rich-content');
  await expect(rich.locator('ul ul')).toHaveCount(1);
  await expect(rich.locator('ul ul a')).toHaveText(['first@example.com', 'link']);
  await expect(rich.locator('pre')).toHaveCount(0);
  await clickText(page, 'first@example.com', 5);
  await page.keyboard.insertText('x');
  await expect(editor).toHaveValue(source.replace('first@', 'firstx@'));
  await expect(rich.locator('ul ul')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(editor).toHaveValue(source);
  await page.setViewportSize({ width: 460, height: 650 });
  await expect(rich.locator('ul ul a')).toHaveText(['first@example.com', 'link']);
  await page.screenshot({ path: 'output/markdown-render-fixes.png' });
});
