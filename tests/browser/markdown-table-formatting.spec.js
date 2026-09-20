import { expect, test } from '@playwright/test';

test('table cells render Markdown and safe HTML, edit source on focus and preserve it through undo and column moves', async ({ page }) => {
  await page.goto('/');
  const source = 'Before\n\n| **Title** | Detail |\n| :--- | ---: |\n| **bold *italic*** <kbd>Ctrl</kbd> | ~~old~~ H<sub>2</sub>O x<sup>2</sup> |\n| &lt;kbd&gt;literal&lt;/kbd&gt; | `<br>` and \\*literal\\* |\n\nAfter';
  const editor = page.getByTestId('editor-textarea');
  await editor.fill(source);
  const table = page.locator('[data-markdown-table]');
  const preview = table.locator('.table-cell-preview');
  await expect(preview.locator('strong').first()).toHaveText('Title');
  await expect(preview.locator('strong em')).toHaveText('italic');
  await expect(preview.locator('kbd')).toHaveText('Ctrl');
  await expect(preview.locator('s')).toHaveText('old');
  await expect(preview.locator('sub')).toHaveText('2');
  await expect(preview.locator('sup')).toHaveText('2');
  await expect(preview.locator('code')).toHaveText('<br>');
  await expect(preview).toContainText(['Title', 'Detail', 'bold italic Ctrl', 'old H2O x2', '<kbd>literal</kbd>', '<br> and *literal*']);
  await expect(editor).toHaveValue(source);
  const cell = table.locator('[data-table-row="1"][data-table-column="0"]');
  await cell.click();
  await expect(cell).toHaveCSS('opacity', '1');
  await expect(cell).toHaveValue('**bold *italic*** <kbd>Ctrl</kbd>');
  expect(await cell.evaluate(el => {
    const input = /** @type {HTMLTextAreaElement} */ (el);
    return input.value.slice(input.selectionStart, input.selectionEnd);
  })).toBe('**bold *italic*** <kbd>Ctrl</kbd>');
  await cell.fill('<kbd>Alt</kbd> **new** &lt;b&gt;');
  await cell.press('Tab');
  await expect(preview.locator('kbd')).toHaveText('Alt');
  await expect(editor).toHaveValue(source.replace('**bold *italic*** <kbd>Ctrl</kbd>', '<kbd>Alt</kbd> **new** &lt;b&gt;'));
  await page.keyboard.press('Control+z');
  await expect(editor).toHaveValue(source);
  await table.locator('.column-drag-handle').first().press('Alt+ArrowRight');
  await expect(preview.locator('kbd')).toHaveText('Ctrl');
  await expect(preview.locator('code')).toHaveText('<br>');
  await expect(preview.locator('strong em')).toHaveText('italic');
  await page.keyboard.press('Control+z');
  await expect(editor).toHaveValue(source);
});

test('table previews retain reference links, sanitize tags and resize after images load', async ({ page }) => {
  await page.route('https://example.com/cell.svg', route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="180"><rect width="400" height="180" fill="teal"/></svg>'
  }));
  await page.goto('/');
  const source = '| Name | Content |\n| --- | --- |\n| [reference][home] | ![image](https://example.com/cell.svg) |\n| <span onclick="alert(1)" style="position:fixed">safe</span> | <a href="javascript:alert(1)">bad</a> |\n\nAfter\n\n[home]: https://example.com';
  const editor = page.getByTestId('editor-textarea');
  await editor.fill(source);
  const preview = page.locator('.table-cell-preview');
  await expect(preview.locator('a').filter({ hasText: 'reference' })).toHaveAttribute('href', 'https://example.com');
  await expect(preview.locator('a').filter({ hasText: 'bad' })).not.toHaveAttribute('href');
  await expect(preview.locator('.rich-content [onclick], .rich-content [style], .rich-content script')).toHaveCount(0);
  await expect.poll(() => preview.locator('img').evaluate(el => /** @type {HTMLImageElement} */ (el).naturalHeight)).toBe(180);
  for (const width of [900, 460]) {
    await page.setViewportSize({ width, height: 700 });
    await expect.poll(() => page.locator('.backdrop-line').evaluateAll(elements => {
      const rects = elements.map(el => el.getBoundingClientRect()).sort((a, b) => a.top - b.top);
      return rects.slice(1).every((rect, index) => rect.top >= rects[index].bottom - 1);
    })).toBe(true);
  }
  await expect(editor).toHaveValue(source);
  await page.screenshot({ path: 'output/markdown-table-formatting.png' });
});
