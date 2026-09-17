import { expect, test } from '@playwright/test';

const longValue = '긴 내용은 셀 너비에 맞춰 자동으로 줄바꿈되어야 합니다. '.repeat(12)
  + 'LongUnbrokenText'.repeat(12);

for (const format of ['Markdown', 'CSV', 'TSV']) {
  test(`${format} tables fill available width, wrap cells and share the tallest row height`, async ({ page }) => {
    await page.goto('/');
    if (format === 'Markdown') {
      await page.getByTestId('editor-textarea').fill('before\n\n| Name | Description |\n| --- | --- |\n| short | value |\n\nafter');
    } else {
      await page.locator('.new-document-format-trigger').click();
      await page.locator('.new-document-format-button').filter({ hasText: new RegExp(`^${format}$`) }).click();
    }
    const surface = page.locator('.table-editor');
    const table = surface.locator('.data-table');
    await surface.locator('[data-table-row="0"][data-table-column="0"]').fill('긴 머리글도 너비에 맞춰 줄바꿈합니다. '.repeat(5));
    const longCell = surface.locator('[data-table-row="1"][data-table-column="0"]');
    const shortCell = surface.locator('[data-table-row="1"][data-table-column="1"]');
    await longCell.fill(longValue);
    await shortCell.fill('short\n\n');

    const layout = () => surface.evaluate((element) => {
      const region = element.querySelector('.table-scroll-region');
      const table = element.querySelector('.data-table');
      if (!region || !table) throw new Error('표 배치 요소를 찾을 수 없습니다.');
      const style = getComputedStyle(region);
      return {
        width: table.getBoundingClientRect().width,
        available: region.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        overflow: region.scrollWidth - region.clientWidth
      };
    });
    const cellsFit = () => surface.locator('.table-cell-editor').evaluateAll((elements) => elements.every((cell) => {
      const row = cell.closest('tr');
      return row !== null && cell.scrollWidth <= cell.clientWidth + 1
        && cell.scrollHeight <= cell.clientHeight + 1
        && Math.abs(cell.getBoundingClientRect().height - row.getBoundingClientRect().height) <= 2;
    }));

    for (const width of [1200, 700]) {
      await page.setViewportSize({ width, height: 850 });
      await expect.poll(async () => {
        const measured = await layout();
        return Math.abs(measured.width - measured.available);
      }).toBeLessThan(1);
      await expect.poll(cellsFit).toBe(true);
      await expect.poll(async () => (await layout()).overflow).toBe(0);
    }
    const wideHeight = await longCell.evaluate((cell) => cell.getBoundingClientRect().height);
    await page.setViewportSize({ width: 460, height: 850 });
    await expect.poll(async () => (await layout()).width).toBe(500);
    await expect.poll(async () => (await layout()).overflow).toBeGreaterThan(0);
    await expect.poll(cellsFit).toBe(true);
    await expect.poll(() => longCell.evaluate((cell) => cell.getBoundingClientRect().height)).toBeGreaterThan(wideHeight);
    await expect(longCell).toHaveValue(longValue);

    await page.setViewportSize({ width: 1200, height: 850 });
    await expect.poll(async () => Math.abs((await layout()).width - (await layout()).available)).toBeLessThan(1);
    const widthBefore = await longCell.evaluate((cell) => cell.getBoundingClientRect().width);
    await surface.locator('.column-resize-handle').first().press('Shift+ArrowRight');
    await expect.poll(async () => (await longCell.evaluate((cell) => cell.getBoundingClientRect().width)) - widthBefore)
      .toBeCloseTo(32, 0);
    await expect.poll(cellsFit).toBe(true);
    await expect.poll(async () => Math.abs((await layout()).width - (await layout()).available)).toBeLessThan(1);

    const tallHeight = await longCell.evaluate((cell) => cell.getBoundingClientRect().height);
    await longCell.fill('short');
    await expect.poll(cellsFit).toBe(true);
    await expect.poll(() => longCell.evaluate((cell) => cell.getBoundingClientRect().height)).toBeLessThan(tallHeight);
    await expect(shortCell).toHaveValue('short\n\n');
    await longCell.press('Control+z');
    await expect(longCell).toHaveValue(longValue);
    await expect.poll(cellsFit).toBe(true);
    await expect(table).toBeVisible();
    await page.locator('.render-mode-toggle').click();
    await expect.poll(() => page.getByTestId('editor-textarea').inputValue()).toContain(longValue);
  });
}
